import type { Thread, TurnReport } from '../model.ts';
import { prefsNow } from '../store/context.ts';
import { openAssumptions } from './ledger.ts';

/** The latest report while it still describes the thread: it isn't working, and you haven't written since. */
export function currentReport(t: Thread) {
  const report = turnReport(t);
  if (!report || t.live?.isWorking || isAnsweredUnturned(t, report))
    return null;
  return report;
}

/** The agent's report_turn from the turn that just ended; an older one describes a turn your later message already answered. */
export function turnReport(thread: Thread) {
  const { report, idle } = thread;
  if (report?.turn !== undefined)
    return report.turn === (idle?.turn ?? 0) ? report : undefined;
  return report && report.at >= (idle?.at ?? 0) - TURN_SLACK
    ? report
    : undefined;
}

// The agent reports just before its turn ends, so its report lands a moment before Mochi's idle record.
const TURN_SLACK = 1;

/** A report saved before turns were counted, with your message after it: only minute-tick times can tell, so a same-minute reply slips through. */
function isAnsweredUnturned(t: Thread, report: TurnReport) {
  if (report.turn !== undefined) return false;
  const lastYou = t.activity.findLast(
    (e) => e.who === 'you' && e.kind === 'message',
  );
  return !!lastYou && lastYou.at > report.at;
}

/** The agent's own question and buttons for this turn; null when it wrote none (a limit, an error, no report). */
export function agentAsk(report: TurnReport | undefined) {
  if (!report?.next || !report.options?.length) return null;
  return { question: report.next, options: report.options };
}

/** Your likely next message for the empty composer: the agent's pick on its next-move card, in your voice; nothing without one. */
export function suggestedReply(t: Thread) {
  const report = currentReport(t);
  return report?.isSuperseded ? undefined : report?.options?.[0]?.reply;
}

/** Whether the end-of-turn card shows: a thread gone idle, with a turn Mochi checked or the agent reported, nothing from you since, and its card not answered yet. */
export function showsVerdictCard(t: Thread) {
  const since = t.idle?.at ?? t.report?.at;
  if (
    t.live?.isWorking ||
    t.status === 'settled' ||
    since === undefined ||
    t.idle?.isMoveAnswered
  )
    return false;
  const lastYou = t.activity.findLast(
    (e) => e.who === 'you' && e.kind === 'message',
  );
  return !lastYou || lastYou.at <= since;
}

const PLURAL = new Intl.PluralRules('en');
const ASSUMPTION_WORDS = { one: 'assumption', other: 'assumptions' };

/** The sidebar card's one line from the report: the question first, then open assumptions (turn spine on), what's left. */
export function reportHeadline(
  t: Thread,
  isSpineOn = prefsNow().turnSpine !== false,
) {
  const report = currentReport(t);
  if (!report) return null;
  if (report.question && !report.isSuperseded)
    return `Needs you: ${report.question}`;
  const toCheck = isSpineOn ? openAssumptions(t.assumptions).length : 0;
  if (toCheck)
    return `${toCheck} ${ASSUMPTION_WORDS[PLURAL.select(toCheck) === 'one' ? 'one' : 'other']} to check`;
  return report.left[0] ?? null;
}
