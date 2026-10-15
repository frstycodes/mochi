import type { PrCheck, PrInfo } from '../host/types/git.ts';
import type { AlertKind } from './model.ts';

/** One OS notification main shows for a watched thread. `requestId`: a pending approval the notification can answer. */
export interface OsNotice {
  threadId: string;
  /** `summary`: several threads folded into one, which no single thread addresses. */
  kind: AlertKind | 'summary';
  title: string;
  body: string;
  requestId?: string;
}

export type CiStatus = 'pending' | 'pass' | 'fail';

/** The last CI state main saw for a thread's PR. */
export interface CiSeen {
  pr: number;
  status: CiStatus;
}

export interface CiResult {
  pr: number;
  url: string;
  status: 'pass' | 'fail';
  failed: PrCheck[];
}

/** A failed check settles the PR as failed even while others still run; no checks at all is no CI. */
export function ciStatus(checks: PrCheck[]): CiStatus | null {
  if (checks.length === 0) return null;
  if (checks.some((c) => c.state === 'fail')) return 'fail';
  if (checks.some((c) => c.state === 'pending')) return 'pending';
  return 'pass';
}

/** A pass or fail is reported once, when it follows another state of the same PR; the first look at a PR only sets the baseline. */
export function ciTransition(seen: CiSeen | undefined, pr: PrInfo): { seen: CiSeen | undefined; result?: CiResult } {
  const status = ciStatus(pr.checks);
  if (!status) return { seen };
  const next = { pr: pr.number, status };
  if (seen?.pr !== pr.number || seen.status === status || status === 'pending') return { seen: next };
  return { seen: next, result: { pr: pr.number, url: pr.url, status, failed: pr.checks.filter((c) => c.state === 'fail') } };
}

/** "CI failed on #12: lint", "CI failed on #12: lint and 2 more", "CI passed on #12". */
export function ciTitle(result: Pick<CiResult, 'pr' | 'status' | 'failed'>) {
  if (result.status === 'pass') return `CI passed on #${result.pr}`;
  const [first, ...rest] = result.failed;
  return `CI failed on #${result.pr}${first ? `: ${first.name}` : ''}${rest.length ? ` and ${rest.length} more` : ''}`;
}

/** A burst becomes one notification per thread (reasons stacked), or a single summary once more than two threads are in it. */
export function coalesce(notices: OsNotice[]): OsNotice[] {
  const byThread = new Map<string, OsNotice[]>();
  for (const n of notices) byThread.set(n.threadId, [...(byThread.get(n.threadId) ?? []), n]);
  if (byThread.size > 2) {
    const titles = [...byThread.values()].map((list) => list[0].title);
    return [{ threadId: '', kind: 'summary', title: `${byThread.size} threads need a look`, body: titles.join('\n') }];
  }
  // A merged notification can't say which of its approvals a button answers, so it drops them.
  return [...byThread.values()].map((list) => (list.length === 1 ? list[0] : { threadId: list[0].threadId, kind: list[0].kind, title: list[0].title, body: list.map((n) => n.body).join('\n') }));
}
