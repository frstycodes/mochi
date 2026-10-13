import type { PrInfo } from '../host/types/git.ts';
import type { PullRequest } from '../model.ts';

const STATES: Record<string, PullRequest['state']> = { OPEN: 'open', MERGED: 'merged' };

/** The thread's PRs with the branch's live one from `gh` added or updated by number; a closed one isn't listed. */
export function withLivePr(prs: PullRequest[], live: PrInfo | null | undefined): PullRequest[] {
  const state = live && STATES[live.state];
  if (!live || !state) return prs;
  const pr: PullRequest = { number: live.number, state, title: live.title, url: live.url };
  return prs.some((p) => p.number === pr.number) ? prs.map((p) => (p.number === pr.number ? pr : p)) : [...prs, pr];
}
