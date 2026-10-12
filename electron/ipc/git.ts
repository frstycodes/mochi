import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type { ChangeTarget, CheckState, DiffFile, DiffScope, GitHost, PrCheck } from '../../src/host/types/git.ts';
import { parseDiff, parseStatus, parseWorktrees } from '../../src/git/parse.ts';
import { applyFiles, checkpointRef, resolveCommit, restore, snapshot } from '../git/checkpoints.ts';
import { inside, run, runGit, topLevel } from '../git/run.ts';
import { prDrafts, worktreeRoot, worktreeRoots } from '../agents/config.ts';
import { ghAccounts, runGh } from '../git/gh.ts';
import { integer, record, string, type Handlers } from './handlers.ts';

const DIFF_FLAGS = ['--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '-M'];
const SCOPES = ['branch', 'uncommitted'] satisfies DiffScope[];
// ponytail: untracked files diff one process each; capped so a missing .gitignore can't fork thousands.
const MAX_UNTRACKED = 200;
const MAX_PATCH = 8 * 1024 * 1024;

export const git = {
  async status(_sender, cwd) {
    const top = await topLevel(string(cwd, 'cwd'));
    const [branch, porcelain] = await Promise.all([currentBranch(top), runGit(top, ['status', '--porcelain=v1', '-z'])]);
    return { branch, files: parseStatus(porcelain) };
  },

  async diff(_sender, cwd, scope) {
    const top = await topLevel(string(cwd, 'cwd'));
    const which = oneOf(scope, SCOPES, 'scope');
    const [branch, base] = await Promise.all([currentBranch(top), baseRef(top)]);
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

  async push(_sender, cwd) {
    const top = await topLevel(string(cwd, 'cwd'));
    await runGit(top, ['push', '-u', 'origin', 'HEAD']);
  },

  async createPr(_sender, cwd, value, user) {
    const top = await topLevel(string(cwd, 'cwd'));
    const pr = record(value, 'pr');
    const title = string(pr.title, 'pr.title', 256).trim();
    if (!title) throw new Error('PR title is empty');
    const args = ['pr', 'create', '--title', title, '--body', string(pr.body, 'pr.body', 65_536), ...(prDrafts() ? ['--draft'] : [])];
    return (await runGh(top, args, githubUser(user))).trim();
  },

  async pr(_sender, cwd, user) {
    const top = await topLevel(string(cwd, 'cwd'));
    const login = githubUser(user);
    const view = await runGh(top, ['pr', 'view', '--json', 'number,url,state'], login).catch((error: Error) => {
      if (/no (open )?pull requests? found|no git remotes/i.test(error.message)) return null;
      throw error;
    });
    if (!view) return null;
    // gh exits 8 while checks are pending and 1 when one failed or none are reported; stdout still holds the JSON.
    const checks = await runGh(top, ['pr', 'checks', '--json', 'name,bucket,link'], login, { okCodes: [0, 1, 8] }).catch(() => '');
    return { ...(JSON.parse(view) as { number: number; url: string; state: string }), checks: parseChecks(checks) };
  },

  async ghAccounts() {
    return ghAccounts();
  },

  async sync(_sender, cwd) {
    const top = await topLevel(string(cwd, 'cwd'));
    const base = await baseRef(top);
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

  async addWorktree(_sender, root, threadId, branch) {
    const top = await mainRepo(string(root, 'root'));
    const id = string(threadId, 'threadId', 64);
    if (!/^[\w-]+$/.test(id)) throw new Error('threadId must be letters, digits, - or _');
    const name = (await runGit(top, ['check-ref-format', '--branch', string(branch, 'branch', 255)])).trim();
    const dir = join(worktreeRoot(), basename(top), id);
    if (existsSync(dir)) return dir;
    await mkdir(dirname(dir), { recursive: true });
    const exists = await runGit(top, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], { okCodes: [1] }).then((s) => !!s.trim());
    await runGit(top, exists ? ['worktree', 'add', dir, name] : ['worktree', 'add', '-b', name, dir, await baseRef(top)]);
    return dir;
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
    const ref = checkpointRef(string(threadId, 'threadId', 64), integer(n, 'n', 0, 1_000_000));
    return snapshot(top, ref, `harness checkpoint ${n}`);
  },

  async restoreCheckpoint(_sender, cwd, threadId, n) {
    const top = insideWorktreeRoot(await topLevel(string(cwd, 'cwd')));
    const id = string(threadId, 'threadId', 64);
    const which = n === 'undo' ? 'undo' : integer(n, 'n', 0, 1_000_000);
    const commit = await resolveCommit(top, checkpointRef(id, which));
    if (!commit) throw new Error(`Checkpoint ${which} does not exist`);
    if (which !== 'undo') await snapshot(top, checkpointRef(id, 'undo'), 'harness checkpoint before rewind');
    await restore(top, commit);
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

/** origin's default branch, else a local main or master, else HEAD. */
async function baseRef(top: string) {
  const remote = await runGit(top, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).catch(() => '');
  if (remote.trim()) return remote.trim();
  for (const name of ['main', 'master']) {
    const found = await runGit(top, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], { okCodes: [1] });
    if (found.trim()) return name;
  }
  return 'HEAD';
}

// Worktrees share the main repo's common dir; worktree commands run from the main checkout.
async function mainRepo(path: string) {
  const common = (await runGit(await topLevel(path), ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim();
  return dirname(common);
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

/** A GitHub login (letters, digits, - and _ for managed users), or undefined for gh's active account. */
function githubUser(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  const login = string(value, 'githubUser', 64);
  if (!/^[\w-]+$/.test(login)) throw new TypeError('githubUser must be a GitHub login');
  return login;
}
