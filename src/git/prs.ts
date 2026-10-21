import type { PullRequest, Thread } from '../model.ts';

/** `prs` with `seen` added or updated by number; the same array when nothing changed, so the store neither re-renders nor re-saves. */
export function recordPrs(prs: PullRequest[], seen: PullRequest[]): PullRequest[] {
  let next = prs;
  for (const pr of seen) {
    const i = next.findIndex((p) => p.number === pr.number);
    // A closed PR only updates one already recorded: an old one on a reused branch name isn't this thread's.
    if (i < 0) next = pr.state === 'closed' ? next : [...next, pr];
    else if (!isSame(next[i], pr)) next = next.map((p, j) => (j === i ? { ...p, ...pr } : p));
  }
  return next;
}

function isSame(a: PullRequest, b: PullRequest) {
  return a.state === b.state && a.title === b.title && a.url === b.url;
}

/** What the Open pull request buttons ask the agent; it picks the base, since a nested thread's parent branch is rarely the right one. */
export const OPEN_PR_PROMPT =
  'Open a pull request for this branch: commit what is left, push it, then run gh pr create with --base set explicitly (usually main, or the branch this one was cut from), a Conventional Commits title, and a body written from your turn report: What, Why, Checks. If a check or gap blocks it, tell me what is missing instead.';

export interface GhPr {
  number: number;
  url: string;
  title: string;
  state: string;
  isDraft: boolean;
  headRefName: string;
  isCrossRepository: boolean;
}

/** `gh pr list --json` rows on one of `branches` → those branches' PRs, leaving out a fork's PR that shares a branch name. */
export function prsOnBranches(rows: GhPr[], branches: Set<string>): { branch: string; pr: PullRequest }[] {
  return rows.flatMap((row) => {
    const state = row.state === 'MERGED' ? 'merged' : row.state === 'CLOSED' ? 'closed' : row.isDraft ? 'draft' : 'open';
    if (row.isCrossRepository || !branches.has(row.headRefName)) return [];
    return [{ branch: row.headRefName, pr: { number: row.number, state, title: row.title, url: row.url } }];
  });
}

/** Each worktree's PRs, matched by the branch it has checked out (`HEAD` when detached, which has none), so a PR opened any way lands on its thread. */
export function prsByWorktree(worktrees: string[], branches: string[], rows: GhPr[]): { worktree: string; pr: PullRequest }[] {
  const found = prsOnBranches(rows, new Set(branches.filter((b) => b !== 'HEAD')));
  return worktrees.flatMap((worktree, i) => found.filter((f) => f.branch === branches[i]).map(({ pr }) => ({ worktree, pr })));
}

/** Auto-archive (`useAutoArchive`) is due: a PR has it on, every PR merged or closed, and the agent idle; until then it waits. */
export function isArchiveDue(thread: Thread) {
  if (thread.status === 'settled' || thread.live?.isWorking) return false;
  return thread.prs.some((p) => p.autoArchive) && thread.prs.every((p) => p.state === 'merged' || p.state === 'closed');
}

export interface MergeMethods {
  squashMergeAllowed: boolean;
  mergeCommitAllowed: boolean;
  rebaseMergeAllowed: boolean;
}

/** `gh pr merge` turning auto-merge on with the first method the repo allows (squash, merge, rebase), or off when `allowed` is null. */
export function autoMergeArgs(pr: number, allowed: MergeMethods | null): string[] {
  if (!allowed) return ['pr', 'merge', String(pr), '--disable-auto'];
  return ['pr', 'merge', String(pr), '--auto', mergeMethod(allowed)];
}

/** `gh pr merge` merging now with the first method the repo allows. */
export const mergeArgs = (pr: number, allowed: MergeMethods) => ['pr', 'merge', String(pr), mergeMethod(allowed)];

function mergeMethod(allowed: MergeMethods) {
  const method = allowed.squashMergeAllowed ? '--squash' : allowed.mergeCommitAllowed ? '--merge' : allowed.rebaseMergeAllowed ? '--rebase' : null;
  if (!method) throw new Error('This repository allows no merge method');
  return method;
}

// Run as a command (at the start of the activity's `Run …` text or after `&&`, `;`, `|`, a newline), not quoted inside another one's argument.
const GH_PR_CREATE = /(?:^(?:Run )?|&&|;|\||\n)\s*gh\s+pr\s+create\b/;
const PR_URL = /https:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/pull\/\d+/g;
const TITLE_FLAG = /(?:--title|-t)[ =](["'])(.*?)\1/;

/**
 * The PR a `gh pr create` command reports, from its output: the URL gh prints on success, or the existing PR's when one is already
 * open for the branch. The title is the command's `--title` until gh's own read of the branch fills it in.
 */
export function createdPr(command: string, output: string | undefined): PullRequest | null {
  if (!output || !GH_PR_CREATE.test(command)) return null;
  const url = [...output.matchAll(PR_URL)].at(-1)?.[0];
  const pr = url && openedPr(url, TITLE_FLAG.exec(command)?.[2] ?? '');
  return pr ? { ...pr, ...(/\s(--draft|-d)\b/.test(command) && { state: 'draft' }) } : null;
}

/** A PR Mochi just opened, from the URL gh printed; a draft reads open until gh's next read of the branch. */
export function openedPr(url: string, title: string): PullRequest | null {
  const number = /\/pull\/(\d+)/.exec(url)?.[1];
  return number ? { number: Number(number), state: 'open', title, url } : null;
}
