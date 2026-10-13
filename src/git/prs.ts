import type { PullRequest } from '../model.ts';

/** `prs` with `seen` added or updated by number; the same array when nothing changed, so the store neither re-renders nor re-saves. */
export function recordPrs(prs: PullRequest[], seen: PullRequest[]): PullRequest[] {
  let next = prs;
  for (const pr of seen) {
    const i = next.findIndex((p) => p.number === pr.number);
    if (i < 0) next = [...next, pr];
    else if (!isSame(next[i], pr)) next = next.map((p, j) => (j === i ? { ...p, ...pr } : p));
  }
  return next;
}

function isSame(a: PullRequest, b: PullRequest) {
  return a.state === b.state && a.title === b.title && a.url === b.url;
}

export interface GhPr {
  number: number;
  url: string;
  title: string;
  state: string;
  isDraft: boolean;
  headRefName: string;
  isCrossRepository: boolean;
}

/** `gh pr list --json` rows on one of `branches` → those branches' PRs. A closed one isn't recorded, nor a fork's PR that shares a branch name. */
export function prsOnBranches(rows: GhPr[], branches: Set<string>): { branch: string; pr: PullRequest }[] {
  return rows.flatMap((row) => {
    const state = row.state === 'MERGED' ? 'merged' : row.state === 'OPEN' ? (row.isDraft ? 'draft' : 'open') : null;
    if (!state || row.isCrossRepository || !branches.has(row.headRefName)) return [];
    return [{ branch: row.headRefName, pr: { number: row.number, state, title: row.title, url: row.url } }];
  });
}

const GH_PR_CREATE = /\bgh\s+pr\s+create\b/;
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
