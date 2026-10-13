import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type { ChangeTarget, CheckState, DiffFile, DiffScope, GitHost, PrCheck, PrInfo, WorktreeOptions } from '../../src/host/types/git.ts';
import { parseDiff, parseStatus, parseWorktrees } from '../../src/git/parse.ts';
import { applyFiles, changedPaths, checkpointRef, resolveCommit, restore, snapshot, snapshotCommit } from '../git/checkpoints.ts';
import { inside, mainRepo, run, runGit, topLevel } from '../git/run.ts';
import { assertFreeBranch, baseRef, branchNameError, listBranches, localName } from '../git/branches.ts';
import { prDrafts, worktreeRoot, worktreeRoots } from '../agents/config.ts';
import { ghAccounts, githubAccount, pushAs, runGh } from '../git/gh.ts';
import { GITHUB_COM, parseRemote, type GithubAccountRef } from '../../src/git/github.ts';
import { parseRefs, refsQuery, validRef } from '../../src/git/githubRefs.ts';
import { integer, record, string, type Handlers } from './handlers.ts';
import { runCheck } from '../git/check.ts';

const DIFF_FLAGS = ['--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '-M'];
const SCOPES = ['branch', 'uncommitted'] satisfies DiffScope[];
// ponytail: untracked files diff one process each; capped so a missing .gitignore can't fork thousands.
const MAX_UNTRACKED = 200;
const MAX_PATCH = 8 * 1024 * 1024;
// Enough to hold a stack trace and the failing assertion, small enough to send as one message.
const CI_LOG_LINES = 150;

// ponytail: one query per batch; GitHub's GraphQL node limit is far above this.
const MAX_REFS = 50;

export const git = {
  async status(_sender, cwd) {
    const top = await topLevel(string(cwd, 'cwd'));
    const [branch, porcelain] = await Promise.all([currentBranch(top), runGit(top, ['status', '--porcelain=v1', '-z'])]);
    return { branch, files: parseStatus(porcelain) };
  },

  async diff(_sender, cwd, scope, chosenBase) {
    const top = await topLevel(string(cwd, 'cwd'));
    const which = oneOf(scope, SCOPES, 'scope');
    const [branch, base] = await Promise.all([currentBranch(top), chosenBase === undefined ? baseRef(top) : string(chosenBase, 'base', 255)]);
    const untracked = await untrackedDiffs(top);
    if (which === 'uncommitted') {
      const [staged, unstaged] = await Promise.all([runGit(top, ['diff', '--cached', ...DIFF_FLAGS]), runGit(top, ['diff', ...DIFF_FLAGS])]);
      return { branch, base, files: [...parseDiff(staged, true), ...parseDiff(unstaged, false), ...untracked] };
    }
    const mergeBase = await runGit(top, ['merge-base', 'HEAD', base]).then((s) => s.trim(), () => 'HEAD');
    return { branch, base, files: [...parseDiff(await runGit(top, ['diff', mergeBase, ...DIFF_FLAGS]), false), ...untracked] };
  },

  async stage(_sender, cwd, value) {
    const { top, target } = await change(cwd, value);
    if (target.patch) await runGit(top, ['apply', '--cached', '--whitespace=nowarn'], { input: target.patch });
    else await runGit(top, ['add', '-A', '--', target.path]);
  },

  async unstage(_sender, cwd, value) {
    const { top, target } = await change(cwd, value);
    if (target.patch) await runGit(top, ['apply', '--cached', '-R', '--whitespace=nowarn'], { input: target.patch });
    else await runGit(top, ['restore', '--staged', '--', target.path]);
  },

  async revert(_sender, cwd, value) {
    const { top, target } = await change(cwd, value);
    if (target.staged) throw new Error('Unstage the change before reverting it');
    if (target.patch) await runGit(top, ['apply', '-R', '--whitespace=nowarn'], { input: target.patch });
    else if (target.untracked) await runGit(top, ['clean', '-f', '--', target.path]);
    else await runGit(top, ['restore', '--', target.path]);
  },

  async commit(_sender, cwd, message) {
    const top = await topLevel(string(cwd, 'cwd'));
    const text = string(message, 'message', 10_000).trim();
    if (!text) throw new Error('Commit message is empty');
    await runGit(top, ['commit', '-m', text]);
    return (await runGit(top, ['rev-parse', '--short', 'HEAD'])).trim();
  },

  async push(_sender, cwd, user) {
    await pushAs(await topLevel(string(cwd, 'cwd')), githubAccount(user));
  },

  async createPr(_sender, cwd, value, user) {
    const top = await topLevel(string(cwd, 'cwd'));
    const pr = record(value, 'pr');
    const title = string(pr.title, 'pr.title', 256).trim();
    if (!title) throw new Error('PR title is empty');
    const args = ['pr', 'create', '--title', title, '--body', string(pr.body, 'pr.body', 65_536), ...(prDrafts() ? ['--draft'] : [])];
    return (await runGh(top, args, githubAccount(user))).trim();
  },

  async pr(_sender, cwd, user) {
    return readPr(string(cwd, 'cwd'), githubAccount(user));
  },

  async ciLog(_sender, cwd, link, user) {
    const top = await topLevel(string(cwd, 'cwd'));
    const job = /\/actions\/runs\/(\d+)(?:\/job\/(\d+))?/.exec(string(link, 'checkLink', 2048));
    if (!job) throw new Error("This check doesn't run on GitHub Actions, so there's no log to fetch. Open it on GitHub instead.");
    const [, runId, jobId] = job;
    const log = await runGh(top, ['run', 'view', runId, ...(jobId ? ['--job', jobId] : []), '--log-failed'], githubAccount(user));
    return log.split('\n').slice(-CI_LOG_LINES).join('\n');
  },

  async ghAccounts() {
    return ghAccounts();
  },

  async repoSlug(_sender, cwd) {
    const url = await runGit(string(cwd, 'cwd'), ['remote', 'get-url', 'origin']).catch(() => '');
    const remote = parseRemote(url);
    if (!remote || remote.host !== GITHUB_COM) return null;
    const [owner, repo] = remote.path.split('/');
    return { owner, repo };
  },

  async refStates(_sender, cwd, value, user) {
    if (!Array.isArray(value)) throw new TypeError('refs must be an array');
    const refs = value.slice(0, MAX_REFS).map(validRef).filter((r) => r !== null);
    if (refs.length === 0) return {};
    const dir = cwd === null ? homedir() : string(cwd, 'cwd');
    const account = cwd === null ? undefined : githubAccount(user);
    // gh exits 1 when any ref doesn't resolve and still prints the others; no gh, no login or offline leaves every ref unknown.
    const json = await runGh(dir, refsQuery(refs), account, { okCodes: [0, 1] }).catch(() => '');
    try {
      return parseRefs(json, refs);
    } catch {
      return {};
    }
  },

  async sync(_sender, cwd, chosenBase) {
    const top = await topLevel(string(cwd, 'cwd'));
    const base = chosenBase === undefined ? await baseRef(top) : string(chosenBase, 'base', 255);
    if (base.startsWith('origin/')) await runGit(top, ['fetch', 'origin', base.slice('origin/'.length)]);
    try {
      await runGit(top, ['merge', '--no-edit', base]);
      return { base, conflicts: [] };
    } catch (error) {
      const conflicts = (await runGit(top, ['diff', '--name-only', '--diff-filter=U'])).split('\n').filter(Boolean);
      if (conflicts.length === 0) throw error;
      return { base, conflicts };
    }
  },

  async addWorktree(_sender, root, threadId, branch, options) {
    return addWorktree(string(root, 'root'), string(threadId, 'threadId', 64), string(branch, 'branch', 255), worktreeOptions(options));
  },

  async branches(_sender, root) {
    return listBranches(await topLevel(string(root, 'root')));
  },

  async branchNameError(_sender, root, name) {
    return branchNameError(await topLevel(string(root, 'root')), string(name, 'name', 255));
  },

  async worktrees(_sender, root) {
    const top = await mainRepo(string(root, 'root'));
    return parseWorktrees(await runGit(top, ['worktree', 'list', '--porcelain'])).filter((w) => isUnderWorktreeRoot(w.path));
  },

  async removeWorktree(_sender, path) {
    const dir = insideWorktreeRoot(string(path, 'path'));
    await runGit(await mainRepo(dir), ['worktree', 'remove', dir]);
  },

  async diskUsage(_sender, path) {
    const top = await topLevel(string(path, 'path'));
    return Number((await run('du', top, ['-sk', top])).split('\t')[0]) * 1024;
  },

  // Checkpoints and rewind only run in a Mochi worktree: resetting a branch is never done to the user's own checkout.
  async checkpoint(_sender, cwd, threadId, n) {
    const top = insideWorktreeRoot(await topLevel(string(cwd, 'cwd')));
    const ref = checkpointRef(string(threadId, 'threadId', 64), n === 'turn' || n === 'undo' ? n : integer(n, 'n', 0, 1_000_000));
    return snapshot(top, ref, `harness checkpoint ${ref.split('/').pop()}`);
  },

  async restoreCheckpoint(_sender, cwd, threadId, n, hasUndo) {
    const top = insideWorktreeRoot(await topLevel(string(cwd, 'cwd')));
    const id = string(threadId, 'threadId', 64);
    const which = n === 'undo' ? 'undo' : integer(n, 'n', 0, 1_000_000);
    const commit = await resolveCommit(top, checkpointRef(id, which));
    if (!commit) throw new Error(`Checkpoint ${which} does not exist`);
    if (which !== 'undo' && hasUndo !== true) await snapshot(top, checkpointRef(id, 'undo'), 'harness checkpoint before rewind');
    await restore(top, commit);
    // The restored files are the agent's baseline now, so the next rewind doesn't count them as someone else's changes.
    await snapshot(top, checkpointRef(id, 'turn'), 'harness checkpoint after rewind');
  },

  async rewindPreview(_sender, cwd, threadId, n) {
    const top = insideWorktreeRoot(await topLevel(string(cwd, 'cwd')));
    const id = string(threadId, 'threadId', 64);
    const index = integer(n, 'n', 0, 1_000_000);
    const commit = await resolveCommit(top, checkpointRef(id, index));
    if (!commit) throw new Error(`Checkpoint ${index} has no saved files`);
    const now = await snapshotCommit(top, 'harness rewind preview');
    const turn = await resolveCommit(top, checkpointRef(id, 'turn'));
    // GAP: no turn snapshot yet (the thread's first turn hasn't ended this launch) reads as no outside changes.
    return { files: await changedPaths(top, commit, now), outside: turn ? await changedPaths(top, turn, now) : [] };
  },

  async checkpointDiff(_sender, cwd, threadId, n) {
    const top = await topLevel(string(cwd, 'cwd'));
    const index = integer(n, 'n', 0, 1_000_000);
    const commit = await resolveCommit(top, checkpointRef(string(threadId, 'threadId', 64), index));
    if (!commit) throw new Error(`Checkpoint ${index} has no saved files`);
    const [branch, base] = await Promise.all([currentBranch(top), baseRef(top)]);
    const from = await runGit(top, ['merge-base', commit, base]).then((s) => s.trim(), () => `${commit}^`);
    return { branch, base, files: parseDiff(await runGit(top, ['diff', from, commit, ...DIFF_FLAGS]), false) };
  },

  async runCheck(_sender, cwd, command) {
    const top = await topLevel(string(cwd, 'cwd'));
    return runCheck(top, string(command, 'command', 2000));
  },

  async forkWorktree(_sender, cwd, threadId, branch, from) {
    const source = await topLevel(string(cwd, 'cwd'));
    const top = await mainRepo(source);
    const id = string(threadId, 'threadId', 64);
    if (!/^[\w-]+$/.test(id)) throw new Error('threadId must be letters, digits, - or _');
    const name = (await runGit(top, ['check-ref-format', '--branch', string(branch, 'branch', 255)])).trim();
    const point = from === undefined ? null : record(from, 'from');
    const commit = point ? await resolveCommit(source, checkpointRef(string(point.threadId, 'from.threadId', 64), integer(point.n, 'from.n', 0, 1_000_000))) : '';
    if (point && !commit) throw new Error('That checkpoint has no saved files');
    const dir = join(worktreeRoot(), basename(top), id);
    if (existsSync(dir)) throw new Error(`${dir} already exists`);
    await mkdir(dirname(dir), { recursive: true });
    await runGit(top, ['worktree', 'add', '-b', name, dir, commit ? `${commit}^` : (await runGit(source, ['rev-parse', 'HEAD'])).trim()]);
    if (commit) await applyFiles(dir, commit);
    return dir;
  },
} satisfies Handlers<GitHost>;

/**
 * The thread's worktree of the repo at `root` on `branch`, made on first call; agent.start also uses it. A new branch starts at
 * `base` (the default branch when unset); one that already exists (a restart after cleanup, or `isExisting`) is checked out,
 * refused when another worktree has it.
 */
export async function addWorktree(root: string, threadId: string, branch: string, options: WorktreeOptions = {}) {
  return (await createWorktree(root, threadId, branch, options)).dir;
}

/** As `addWorktree`; `isNew` says this call made it, so it still needs its setup. */
export async function createWorktree(root: string, threadId: string, branch: string, { base, isExisting }: WorktreeOptions = {}) {
  const top = await mainRepo(root);
  if (!/^[\w-]+$/.test(threadId)) throw new Error('threadId must be letters, digits, - or _');
  const dir = join(worktreeRoot(), basename(top), threadId);
  if (existsSync(dir)) return { dir, isNew: false };
  const name = (await runGit(top, ['check-ref-format', '--branch', isExisting ? await localName(top, branch) : branch])).trim();
  const exists = await runGit(top, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], { okCodes: [1] }).then((s) => !!s.trim());
  if (exists || isExisting) await assertFreeBranch(top, name);
  await mkdir(dirname(dir), { recursive: true });
  // An existing remote-only branch: `worktree add <dir> <name>` makes the local tracking branch itself.
  await runGit(top, exists || isExisting ? ['worktree', 'add', dir, name] : ['worktree', 'add', '-b', name, dir, base ?? (await baseRef(top))]);
  return { dir, isNew: true };
}

export function worktreeOptions(value: unknown): WorktreeOptions {
  if (value === undefined) return {};
  const o = record(value, 'options');
  if (o.isExisting !== undefined && typeof o.isExisting !== 'boolean') throw new TypeError('options.isExisting must be a boolean');
  return { base: o.base === undefined ? undefined : string(o.base, 'options.base', 255), isExisting: o.isExisting as boolean | undefined };
}

async function change(cwd: unknown, value: unknown) {
  const top = await topLevel(string(cwd, 'cwd'));
  const raw = record(value, 'target');
  const target: ChangeTarget = {
    path: inside(top, string(raw.path, 'target.path')),
    staged: raw.staged === true,
    untracked: raw.untracked === true,
    patch: raw.patch === undefined ? undefined : string(raw.patch, 'target.patch', MAX_PATCH),
  };
  if (target.patch) checkPatch(top, target.patch, target.path);
  return { top, target };
}

// A hunk patch must touch exactly the file it claims, inside this worktree.
function checkPatch(top: string, patch: string, path: string) {
  const files = parseDiff(patch, false);
  if (files.length !== 1 || files[0].path !== path) throw new Error('Patch does not match its file');
  if (files[0].oldPath) inside(top, files[0].oldPath);
}

async function untrackedDiffs(top: string): Promise<DiffFile[]> {
  const paths = (await runGit(top, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean).slice(0, MAX_UNTRACKED);
  const patches = await Promise.all(paths.map((p) => runGit(top, ['diff', '--no-index', ...DIFF_FLAGS, '--', '/dev/null', p], { okCodes: [1] })));
  return patches.flatMap((p) => parseDiff(p, false)).map((f) => ({ ...f, kind: 'untracked' as const }));
}

async function currentBranch(top: string) {
  return (await runGit(top, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'HEAD')).trim();
}


/** The branch's PR and its checks, or null when the branch has none. */
export async function readPr(cwd: string, account: GithubAccountRef | undefined): Promise<PrInfo | null> {
  const top = await topLevel(cwd);
  const view = await runGh(top, ['pr', 'view', '--json', 'number,url,state,title'], account).catch((error: Error) => {
    if (/no (open )?pull requests? found|no git remotes/i.test(error.message)) return null;
    throw error;
  });
  if (!view) return null;
  // gh exits 8 while checks are pending and 1 when one failed or none are reported; stdout still holds the JSON.
  const checks = await runGh(top, ['pr', 'checks', '--json', 'name,bucket,link'], account, { okCodes: [0, 1, 8] }).catch(() => '');
  return { ...(JSON.parse(view) as { number: number; url: string; state: string; title: string }), checks: parseChecks(checks) };
}

const BUCKETS = ['pass', 'fail', 'pending', 'skipping', 'cancel'] satisfies CheckState[];

function parseChecks(json: string): PrCheck[] {
  if (!json.trim()) return [];
  return (JSON.parse(json) as { name: string; bucket: string; link?: string }[]).map((c) => ({
    name: c.name,
    state: (BUCKETS as string[]).includes(c.bucket) ? (c.bucket as CheckState) : 'pending',
    link: c.link || undefined,
  }));
}

function oneOf<T extends string>(value: unknown, options: readonly T[], name: string): T {
  if (!options.includes(value as T)) throw new TypeError(`${name} must be one of ${options.join(', ')}`);
  return value as T;
}

/** Thread worktrees live under the worktree root (Settings › Git), never inside the project, so its own `git status` stays clean. */
function insideWorktreeRoot(path: string) {
  const abs = resolve(path);
  if (!isUnderWorktreeRoot(abs)) throw new Error(`${path} is not a Mochi worktree`);
  return abs;
}

function isUnderWorktreeRoot(path: string) {
  return worktreeRoots().some((root) => path.startsWith(root + sep));
}
