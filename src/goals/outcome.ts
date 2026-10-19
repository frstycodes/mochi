import { isMet, type Thread } from '../model.ts';
import { threadUsage } from '../usage/model.ts';

/** What a settled goal came to: time, criteria verified by Mochi or only claimed, revisions, PRs and spend. `usage.costUsd` is null when the harness reported no spend (Codex, demo threads). */
export function outcomeOf(thread: Thread) {
  const end = thread.settledAt ?? Math.max(thread.startedAt, ...thread.activity.map((a) => a.at));
  const criteria = thread.criteria ?? [];
  const verified = criteria.filter((c) => c.check?.status === 'passed').length;
  return {
    minutes: Math.max(0, Math.round(end - thread.startedAt)),
    total: criteria.length,
    verified,
    claimed: criteria.filter((c) => isMet(c, thread.idle?.isConfirmed)).length - verified,
    revisions: thread.revisions.length - 1,
    merged: thread.prs.filter((p) => p.state === 'merged'),
    unmerged: thread.prs.filter((p) => p.state !== 'merged'),
    usage: threadUsage(thread),
  };
}
