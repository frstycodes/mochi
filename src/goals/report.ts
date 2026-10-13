import type { Thread } from '../model.ts';
import { summarize } from '../summary.ts';

/** The latest report while it still describes the thread: it has a goal, isn't working, and you haven't written since. */
export function currentReport(t: Thread) {
  const { report } = t;
  if (!t.goal || !report || t.live?.isWorking) return null;
  const lastYou = t.activity.findLast((e) => e.who === 'you' && e.kind === 'message');
  if (lastYou && lastYou.at > report.at) return null;
  const criteria = t.criteria ?? [];
  const claimed = criteria.filter((c) => c.claim).length;
  const turn = t.activity.slice(lastYou ? t.activity.lastIndexOf(lastYou) + 1 : 0);
  return { report, criteria, claimed, isReady: criteria.length > 0 && claimed === criteria.length, changes: summarize(turn) };
}

/** The sidebar card's one line from the report: the question first, then readiness, then what's left. */
export function reportHeadline(t: Thread) {
  const view = currentReport(t);
  if (!view) return null;
  if (view.report.question) return `Needs you: ${view.report.question}`;
  if (view.isReady) return 'Ready for review';
  if (view.criteria.length) return `${view.claimed} of ${view.criteria.length} criteria done`;
  return view.report.left[0] ?? null;
}
