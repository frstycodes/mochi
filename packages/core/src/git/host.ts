import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type {
  ChangeTarget,
  DiffFile,
  GitHost,
  WorktreeOptions,
} from '../../../../apps/desktop/src/host/types/git.ts';
import {
  parseDiff,
  parseStatus,
} from '../../../../apps/desktop/src/git/parse.ts';
import {
  applyFiles,
  changedPaths,
  checkpointRef,
  resolveCommit,
  restore,
  restorePaths,
  snapshot,
  snapshotCommit,
} from './checkpoints.ts';
import {
  inside,
  listWorktrees,
  mainRepo,
  run,
  runGit,
  topLevel,
} from './run.ts';
import {
  addBranchWorktree,
  baseRef,
  branchNameError,
  headOf,
  listBranches,
  renameAutoBranch,
  switchBranch,
} from './branches.ts';
import { prDrafts, worktreeRoot, worktreeRoots } from '../agents/config.ts';
import { ghAccounts, githubAccount, pushAs, runGh } from './gh.ts';
import {
  GITHUB_COM,
  parseRemote,
  type GithubAccountRef,
} from '../../../../apps/desktop/src/git/github.ts';
import type { HostMethods } from '../hostMethods.ts';
import { runCheck } from './check.ts';
import { conflictedPaths } from './conflicts.ts';
import {
  autoMergeArgs,
  mergeArgs,
  type MergeMethods,
} from '../../../../apps/desktop/src/git/prs.ts';
import {
  parsePrReview,
  prReviewQuery,
  replyThreadArgs,
  resolveThreadArgs,
  reviewArgs,
} from '../../../../apps/desktop/src/git/prReview.ts';

const DIFF_FLAGS = [
  '--no-color',
  '--no-ext-diff',
  '--src-prefix=a/',
  '--dst-prefix=b/',
  '-M',
];
// ponytail: untracked files diff one process each; capped so a missing .gitignore can't fork thousands.
const MAX_UNTRACKED = 200;
// Enough to hold a stack trace and the failing assertion, small enough to send as one message.
const CI_LOG_LINES = 150;

export const git = {
  async status(_caller, cwd) {
    const top = await topLevel(cwd);
    const [branch, porcelain] = await Promise.all([
      currentBranch(top),
      runGit(top, ['status', '--porcelain=v1', '-z']),
    ]);
    return { branch, files: parseStatus(porcelain) };
  },

  async diff(_caller, cwd, scope, chosenBase) {
    const top = await topLevel(cwd);
    const [branch, base] = await Promise.all([
      currentBranch(top),
      chosenBase === undefined ? baseRef(top) : chosenBase,
    ]);
    const untracked = await untrackedDiffs(top);
    if (scope === 'uncommitted') {
      const [staged, unstaged] = await Promise.all([
        runGit(top, ['diff', '--cached', ...DIFF_FLAGS]),
        runGit(top, ['diff', ...DIFF_FLAGS]),
      ]);
      return {
        branch,
        base,
        files: [
          ...parseDiff(staged, true),
          ...parseDiff(unstaged, false),
          ...untracked,
        ],
      };
    }
    const mergeBase = await runGit(top, ['merge-base', 'HEAD', base]).then(
      (s) => s.trim(),
      () => headOrEmptyTree(top),
    );
    return {
      branch,
      base,
      files: [
        ...parseDiff(
          await runGit(top, ['diff', mergeBase, ...DIFF_FLAGS]),
          false,
        ),
        ...untracked,
      ],
    };
  },

  async stage(_caller, cwd, value) {
    const { top, target } = await change(cwd, value);
    if (target.patch)
      await runGit(top, ['apply', '--cached', '--whitespace=nowarn'], {
        input: target.patch,
      });
    else await runGit(top, ['add', '-A', '--', target.path]);
  },

  async unstage(_caller, cwd, value) {
    const { top, target } = await change(cwd, value);
    if (target.patch)
      await runGit(top, ['apply', '--cached', '-R', '--whitespace=nowarn'], {
        input: target.patch,
      });
    else await runGit(top, ['restore', '--staged', '--', target.path]);
  },

  async revert(_caller, cwd, value) {
    const { top, target } = await change(cwd, value);
    if (target.staged)
      throw new Error('Unstage the change before reverting it');
    if (target.patch)
      await runGit(top, ['apply', '-R', '--whitespace=nowarn'], {
        input: target.patch,
      });
    else if (target.untracked)
      await runGit(top, ['clean', '-f', '--', target.path]);
    else await runGit(top, ['restore', '--', target.path]);
  },

  async commit(_caller, cwd, message) {
    const top = await topLevel(cwd);
    await runGit(top, ['commit', '-m', message.trim()]);
    return (await runGit(top, ['rev-parse', '--short', 'HEAD'])).trim();
  },

  async push(_caller, cwd, user) {
    await pushAs(await topLevel(cwd), githubAccount(user));
  },

  async createPr(_caller, cwd, value, user) {
    const top = await topLevel(cwd);
    const base = value.base === undefined ? [] : ['--base', value.base];
    const args = [
      'pr',
      'create',
      '--title',
      value.title.trim(),
      '--body',
      value.body,
      ...base,
      ...(prDrafts() ? ['--draft'] : []),
    ];
    return (await runGh(top, args, githubAccount(user))).trim();
  },

  async setAutoMerge(_caller, cwd, pr, isOn, user) {
    const top = await topLevel(cwd);
    const account = githubAccount(user);
    const allowed = isOn
      ? (JSON.parse(
          await runGh(
            top,
            [
              'repo',
              'view',
              '--json',
              'squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed',
            ],
            account,
          ),
        ) as MergeMethods)
      : null;
    await runGh(top, autoMergeArgs(pr, allowed), account);
  },

  async prReview(_caller, cwd, pr, user) {
    const top = await topLevel(cwd);
    const account = githubAccount(user);
    const [json, patch] = await Promise.all([
      runGh(top, prReviewQuery(pr), account),
      runGh(top, ['pr', 'diff', String(pr), '--color', 'never'], account),
    ]);
    return parsePrReview(json, parseDiff(patch, false));
  },

  async commentPr(_caller, cwd, pr, body, user) {
    await runGh(
      await topLevel(cwd),
      ['pr', 'comment', String(pr), '--body', body],
      githubAccount(user),
    );
  },

  async replyThread(_caller, cwd, threadId, body, user) {
    await runGh(
      await topLevel(cwd),
      replyThreadArgs(threadId, body),
      githubAccount(user),
    );
  },

  async resolveThread(_caller, cwd, threadId, isResolved, user) {
    await runGh(
      await topLevel(cwd),
      resolveThreadArgs(threadId, isResolved),
      githubAccount(user),
    );
  },

  async reviewPr(_caller, cwd, pr, verdict, body, user) {
    await runGh(
      await topLevel(cwd),
      reviewArgs(pr, verdict, body),
      githubAccount(user),
    );
  },

  async mergePr(_caller, cwd, pr, method, mode, user) {
    await runGh(
      await topLevel(cwd),
      mergeArgs(pr, method, mode),
      githubAccount(user),
    );
  },

  async ciLog(_caller, cwd, link, user) {
    return failedLog(await topLevel(cwd), link, githubAccount(user));
  },

  async ghAccounts() {
    return ghAccounts();
  },

  async repoSlug(_caller, cwd) {
    const url = await runGit(cwd, ['remote', 'get-url', 'origin']).catch(
      () => '',
    );
    const remote = parseRemote(url);
    if (!remote || remote.host !== GITHUB_COM) return null;
    const [owner, repo] = remote.path.split('/');
    return { owner, repo };
  },

  async renameAutoBranch(_caller, cwd, expected, title) {
    const dir = insideWorktreeRoot(cwd);
    return renameAutoBranch(dir, expected, title);
  },
  async sync(_caller, cwd, chosenBase) {
    const top = await topLevel(cwd);
    const base = chosenBase === undefined ? await baseRef(top) : chosenBase;
    if (base.startsWith('origin/'))
      await runGit(top, ['fetch', 'origin', base.slice('origin/'.length)]);
    try {
      await runGit(top, ['merge', '--no-edit', base]);
      return { base, conflicts: [] };
    } catch (error) {
      const conflicts = await conflictedPaths(top);
      if (conflicts.length === 0) throw error;
      return { base, conflicts };
    }
  },

  async addWorktree(_caller, root, threadId, branch, options) {
    return addWorktree(root, threadId, branch, options);
  },

  async branches(_caller, root) {
    return listBranches(await topLevel(root));
  },

  async branchNameError(_caller, root, name) {
    return branchNameError(await topLevel(root), name);
  },

  async switchBranch(_caller, root, branch, options) {
    await switchBranch(await topLevel(root), branch, options);
  },

  async worktrees(_caller, root) {
    const top = await mainRepo(root);
    return (await listWorktrees(top)).filter((w) =>
      isUnderWorktreeRoot(w.path),
    );
  },

  async head(_caller, cwd) {
    return headOf(await topLevel(cwd));
  },

  async removeWorktree(_caller, path) {
    const dir = insideWorktreeRoot(path);
    await runGit(await mainRepo(dir), ['worktree', 'remove', dir]);
  },

  async diskUsage(_caller, path) {
    const top = await topLevel(path);
    return Number((await run('du', top, ['-sk', top])).split('\t')[0]) * 1024;
  },

  // Checkpoints and rewind only run in a Mochi worktree: resetting a branch is never done to the user's own checkout.
  async checkpoint(_caller, cwd, threadId, n) {
    const top = insideWorktreeRoot(await topLevel(cwd));
    const ref = checkpointRef(threadId, n);
    return snapshot(top, ref, `harness checkpoint ${ref.split('/').pop()}`);
  },

  async restoreCheckpoint(_caller, cwd, threadId, n, hasUndo) {
    const top = insideWorktreeRoot(await topLevel(cwd));
    const id = threadId;
    const which = n;
    const commit = await resolveCommit(top, checkpointRef(id, which));
    if (!commit) throw new Error(`Checkpoint ${which} does not exist`);
    if (which !== 'undo' && hasUndo !== true)
      await snapshot(
        top,
        checkpointRef(id, 'undo'),
        'harness checkpoint before rewind',
      );
    await restore(top, commit);
    // The restored files are the agent's baseline now, so the next rewind doesn't count them as someone else's changes.
    await snapshot(
      top,
      checkpointRef(id, 'turn'),
      'harness checkpoint after rewind',
    );
  },

  async restoreFiles(_caller, cwd, threadId, n, paths) {
    const top = insideWorktreeRoot(await topLevel(cwd));
    const id = threadId;
    const which = n;
    const files = paths.map((p) => inside(top, p));
    const commit = await resolveCommit(top, checkpointRef(id, which));
    if (!commit) throw new Error(`Checkpoint ${which} has no saved files`);
    if (which !== 'undo')
      await snapshot(
        top,
        checkpointRef(id, 'undo'),
        'harness checkpoint before undoing a turn',
      );
    await restorePaths(top, commit, files);
    await snapshot(
      top,
      checkpointRef(id, 'turn'),
      'harness checkpoint after undoing a turn',
    );
  },

  async rewindPreview(_caller, cwd, threadId, n) {
    const top = insideWorktreeRoot(await topLevel(cwd));
    const id = threadId;
    const index = n;
    const commit = await resolveCommit(top, checkpointRef(id, index));
    if (!commit) throw new Error(`Checkpoint ${index} has no saved files`);
    const now = await snapshotCommit(top, 'harness rewind preview');
    const turn = await resolveCommit(top, checkpointRef(id, 'turn'));
    // GAP: no turn snapshot yet (the thread's first turn hasn't ended this launch) reads as no outside changes.
    return {
      files: await changedPaths(top, commit, now),
      outside: turn ? await changedPaths(top, turn, now) : [],
    };
  },

  async checkpointDiff(_caller, cwd, threadId, n) {
    const top = await topLevel(cwd);
    const index = n;
    const commit = await resolveCommit(top, checkpointRef(threadId, index));
    if (!commit) throw new Error(`Checkpoint ${index} has no saved files`);
    const [branch, base] = await Promise.all([
      currentBranch(top),
      baseRef(top),
    ]);
    const from = await runGit(top, ['merge-base', commit, base]).then(
      (s) => s.trim(),
      () => `${commit}^`,
    );
    return {
      branch,
      base,
      files: parseDiff(
        await runGit(top, ['diff', from, commit, ...DIFF_FLAGS]),
        false,
      ),
    };
  },

  async turnDiff(_caller, cwd, from, to) {
    const top = await topLevel(cwd);
    const end =
      to === undefined ? await snapshotCommit(top, 'harness turn diff') : to;
    return parseDiff(
      await runGit(top, ['diff', from, end, ...DIFF_FLAGS]),
      false,
    );
  },

  async runCheck(_caller, cwd, command) {
    const top = await topLevel(cwd);
    return runCheck(top, command);
  },

  async forkWorktree(_caller, cwd, threadId, branch, from) {
    const source = await topLevel(cwd);
    const top = await mainRepo(source);
    const id = threadId;
    const name = (
      await runGit(top, ['check-ref-format', '--branch', branch])
    ).trim();
    const point = from === undefined ? null : from;
    const commit = point
      ? await resolveCommit(source, checkpointRef(point.threadId, point.n))
      : '';
    if (point && !commit) throw new Error('That checkpoint has no saved files');
    const dir = join(worktreeRoot(), basename(top), id);
    if (existsSync(dir)) throw new Error(`${dir} already exists`);
    await mkdir(dirname(dir), { recursive: true });
    await runGit(top, [
      'worktree',
      'add',
      '-b',
      name,
      dir,
      commit
        ? `${commit}^`
        : (await runGit(source, ['rev-parse', 'HEAD'])).trim(),
    ]);
    if (commit) await applyFiles(dir, commit);
    return dir;
  },
} satisfies HostMethods<Omit<GitHost, CoreServed>>;

/** Core's GitHub service answers these (`../github/handlers.ts`). */
export type CoreServed = 'pr' | 'worktreePrs' | 'refStates';

/**
 * The thread's worktree of the repo at `root` on `branch`, made on first call; agent.start also uses it. A new branch starts at
 * `base` (the default branch when unset); one that already exists (a restart after cleanup, or `isExisting`) is checked out,
 * refused when another worktree has it, and refused outright on an `isNew` start, which asked for a branch of its own.
 */
export async function addWorktree(
  root: string,
  threadId: string,
  branch: string,
  options: WorktreeOptions = {},
) {
  return (await createWorktree(root, threadId, branch, options)).dir;
}

/** As `addWorktree`; `isNew` says this call made it, so it still needs its setup. */
export async function createWorktree(
  root: string,
  threadId: string,
  branch: string,
  options: WorktreeOptions = {},
) {
  const top = await mainRepo(root);
  if (!/^[\w-]+$/.test(threadId))
    throw new Error('threadId must be letters, digits, - or _');
  const dir = join(worktreeRoot(), basename(top), threadId);
  if (existsSync(dir)) return { dir, isNew: false };
  await addBranchWorktree(top, dir, branch, options);
  return { dir, isNew: true };
}

async function change(cwd: string, value: ChangeTarget) {
  const top = await topLevel(cwd);
  const target: ChangeTarget = { ...value, path: inside(top, value.path) };
  if (target.patch) checkPatch(top, target.patch, target.path);
  return { top, target };
}

// A hunk patch must touch exactly the file it claims, inside this worktree.
function checkPatch(top: string, patch: string, path: string) {
  const files = parseDiff(patch, false);
  if (files.length !== 1 || files[0].path !== path)
    throw new Error('Patch does not match its file');
  if (files[0].oldPath) inside(top, files[0].oldPath);
}

async function untrackedDiffs(top: string): Promise<DiffFile[]> {
  const paths = (
    await runGit(top, ['ls-files', '--others', '--exclude-standard', '-z'])
  )
    .split('\0')
    .filter(Boolean)
    .slice(0, MAX_UNTRACKED);
  const patches = await Promise.all(
    paths.map((p) =>
      runGit(top, ['diff', '--no-index', ...DIFF_FLAGS, '--', '/dev/null', p], {
        okCodes: [1],
      }),
    ),
  );
  return patches
    .flatMap((p) => parseDiff(p, false))
    .map((f) => ({ ...f, kind: 'untracked' as const }));
}

/** A repo with no commit yet has no HEAD to diff against: everything in it is new, so the base is the empty tree. */
async function headOrEmptyTree(top: string) {
  return runGit(top, ['rev-parse', '--verify', '--quiet', 'HEAD']).then(
    () => 'HEAD',
    async () =>
      (
        await runGit(top, ['hash-object', '-t', 'tree', '--stdin'], {
          input: '',
        })
      ).trim(),
  );
}

async function currentBranch(top: string) {
  return (
    await runGit(top, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'HEAD')
  ).trim();
}

/** The tail of a failed GitHub Actions job's log, from the check's link; throws for a check that isn't an Actions job. */
export async function failedLog(
  top: string,
  link: string,
  account: GithubAccountRef | undefined,
  lines = CI_LOG_LINES,
) {
  const job = /\/actions\/runs\/(\d+)(?:\/job\/(\d+))?/.exec(link);
  if (!job)
    throw new Error(
      "This check doesn't run on GitHub Actions, so there's no log to fetch. Open it on GitHub instead.",
    );
  const [, runId, jobId] = job;
  const log = await runGh(
    top,
    ['run', 'view', runId, ...(jobId ? ['--job', jobId] : []), '--log-failed'],
    account,
  );
  return log.split('\n').slice(-lines).join('\n');
}

/** Thread worktrees live under the worktree root (Settings › Git and worktrees), never inside the project, so its own `git status` stays clean. */
function insideWorktreeRoot(path: string) {
  const abs = resolve(path);
  if (!isUnderWorktreeRoot(abs))
    throw new Error(`${path} is not a Mochi worktree`);
  return abs;
}

function isUnderWorktreeRoot(path: string) {
  return worktreeRoots().some((root) => path.startsWith(root + sep));
}
