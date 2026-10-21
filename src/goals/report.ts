import { isMet, type Thread, type TurnReport } from '../model.ts';
import { openTurn } from '../chat/turnChanges.ts';
import type { RefStatus } from '../chat/refs.ts';

/** The latest report while it still describes the thread: it isn't working, and you haven't written since. */
export function currentReport(t: Thread) {
  const report = turnReport(t);
  if (!report || t.live?.isWorking || isAnsweredUnturned(t, report)) return null;
  const criteria = t.criteria ?? [];
  const met = criteria.filter((c) => isMet(c, t.idle?.isConfirmed)).length;
  return { report, criteria, met, isReady: criteria.length > 0 && met === criteria.length, changes: openTurn(t.activity) };
}

/** The agent's report_turn from the turn that just ended; an older one describes a turn your later message already answered. */
export function turnReport(thread: Thread) {
  const { report, idle } = thread;
  if (report?.turn !== undefined) return report.turn === (idle?.turn ?? 0) ? report : undefined;
  return report && report.at >= (idle?.at ?? 0) - TURN_SLACK ? report : undefined;
}

// The agent reports just before its turn ends, so its report lands a moment before Mochi's idle record.
const TURN_SLACK = 1;

/** A report saved before turns were counted, with your message after it: only minute-tick times can tell, so a same-minute reply slips through. */
function isAnsweredUnturned(t: Thread, report: TurnReport) {
  if (report.turn !== undefined) return false;
  const lastYou = t.activity.findLast((e) => e.who === 'you' && e.kind === 'message');
  return !!lastYou && lastYou.at > report.at;
}

/** Your likely next message for the empty composer: the agent's pick on its next-move card, in your voice; nothing without one. */
export function suggestedReply(t: Thread) {
  const report = currentReport(t)?.report;
  return report?.isSuperseded ? undefined : report?.options?.[0]?.reply;
}

/** Whether the end-of-turn card shows: a thread gone idle, with a turn Mochi checked or the agent reported, nothing from you since, and its card not answered yet. */
export function showsVerdictCard(t: Thread) {
  const since = t.idle?.at ?? t.report?.at;
  if (t.live?.isWorking || t.status === 'settled' || since === undefined || t.idle?.isMoveAnswered) return false;
  const lastYou = t.activity.findLast((e) => e.who === 'you' && e.kind === 'message');
  return !lastYou || lastYou.at <= since;
}

/** The sidebar card's one line from the report: the question first, then readiness, then what's left. */
export function reportHeadline(t: Thread) {
  const view = currentReport(t);
  if (!view) return null;
  if (view.report.question && !view.report.isSuperseded) return `Needs you: ${view.report.question}`;
  if (view.isReady) return NEXT_STEP_TITLES[nextStep(t.prs.map((p) => p.state))];
  if (view.criteria.length) return `${view.met} of ${view.criteria.length} criteria done`;
  return view.report.left[0] ?? null;
}

export type NextStep = 'open-pr' | 'review' | 'settle';

/** What a goal whose criteria are all met waits on, from its PRs' states: a PR to open, one to review, or a merged one to settle. */
export function nextStep(prStates: RefStatus[]): NextStep {
  if (prStates.some((s) => s === 'open' || s === 'draft')) return 'review';
  if (prStates.includes('merged')) return 'settle';
  return 'open-pr';
}

export const NEXT_STEP_TITLES = { 'open-pr': 'Ready for a pull request', review: 'Ready for review', settle: 'Merged' } satisfies Record<NextStep, string>;
