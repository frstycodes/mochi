import { isMet, type Thread } from '../model.ts';
import { openTurn } from '../chat/turnChanges.ts';
import type { RefStatus } from '../chat/refs.ts';
import { getPrefs } from '../settings/prefs.ts';

/** The latest report while it still describes the thread: it has a goal, isn't working, and you haven't written since. */
export function currentReport(t: Thread) {
  const { report } = t;
  if (!getPrefs().goals || !t.goal || !report || t.live?.isWorking) return null;
  const lastYou = t.activity.findLast((e) => e.who === 'you' && e.kind === 'message');
  if (lastYou && lastYou.at > report.at) return null;
  const criteria = t.criteria ?? [];
  const met = criteria.filter(isMet).length;
  return { report, criteria, met, isReady: criteria.length > 0 && met === criteria.length, changes: openTurn(t.activity) };
}

/** Whether the end-of-turn card shows: a goal thread gone idle, with a turn Mochi checked or the agent reported, nothing from you since, and its card not answered yet. */
export function showsVerdictCard(t: Thread) {
  const since = t.idle?.at ?? t.report?.at;
  if (!getPrefs().goals || !t.goal || t.live?.isWorking || t.status === 'settled' || since === undefined || t.idle?.isMoveAnswered) return false;
  const lastYou = t.activity.findLast((e) => e.who === 'you' && e.kind === 'message');
  return !lastYou || lastYou.at <= since;
}

/** The sidebar card's one line from the report: the question first, then readiness, then what's left. */
export function reportHeadline(t: Thread) {
  const view = currentReport(t);
  if (!view) return null;
  if (view.report.question) return `Needs you: ${view.report.question}`;
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
