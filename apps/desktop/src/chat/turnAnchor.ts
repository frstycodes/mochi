import { useState } from 'react';
import type { ActivityEntry, Thread, TurnReport } from '../model.ts';
import { turnReport } from '../goals/report.ts';
import { isYourMessage, turnChanges, type TurnChanges } from './turnChanges.ts';

/** The turn the end-of-turn widgets (report, sub-threads, file changes) sit under. */
export interface TurnAnchor {
  /** Activity index of your message that started it; -1 for work before your first message. */
  start: number;
  /** Activity index of its last entry: the widgets go right after it. */
  end: number;
  /** Nothing after it: the widgets show as the thread's current state, answers included. */
  isLatest: boolean;
  report?: TurnReport;
  changes?: TurnChanges;
}

/** A live agent thread may have no planned steps; its turn is what's running. */
export function isTurnRunning(thread: Thread) {
  return thread.live
    ? thread.live.isWorking
    : thread.steps.some((s) => s.status === 'running');
}

/**
 * The last completed turn that produced widgets of its own; none during the first turn. A running turn leaves them on the turn
 * before it until it ends. A turn you stopped, or that failed, takes them over only with a report or file changes of its own.
 */
export function turnAnchor(thread: Thread): TurnAnchor | undefined {
  const spans = turnSpans(thread.activity);
  const ended = isTurnRunning(thread) ? spans.slice(0, -1) : spans;
  const reported = reportSpan(thread, spans, ended);
  const changes = turnChanges(thread.activity);
  for (let i = ended.length - 1; i >= 0; i--) {
    const span = ended[i];
    const anchor = {
      ...span,
      isLatest: span === spans.at(-1),
      report: span === reported ? thread.report : undefined,
      changes: changes.find((t) => t.start === span.start),
    };
    const isDone = i === ended.length - 1 && !wasStopped(thread, span);
    if (anchor.report || anchor.changes || isDone) return anchor;
  }
}

/**
 * `turnAnchor`, keeping the report it showed: the running turn's report replaces the thread's a moment before that turn ends, and
 * the turn before it would lose its summary for that moment. Stable while nothing it holds changes, so memoized rows stay put.
 */
export function useTurnAnchor(thread: Thread) {
  const fresh = turnAnchor(thread);
  const [state, setState] = useState({ threadId: thread.id, anchor: fresh });
  const held = state.threadId === thread.id ? state.anchor : undefined;
  const anchor =
    fresh && !fresh.report && !fresh.isLatest && held?.start === fresh.start
      ? { ...fresh, report: held.report }
      : fresh;
  const isSame =
    held === anchor ||
    (!!held &&
      !!anchor &&
      held.start === anchor.start &&
      held.end === anchor.end &&
      held.isLatest === anchor.isLatest &&
      held.report === anchor.report);
  if (!isSame) setState({ threadId: thread.id, anchor });
  return isSame ? held : anchor;
}

/** Your message up to your next one; work before your first message is a turn of its own. */
function turnSpans(activity: ActivityEntry[]) {
  const starts = activity.flatMap((e, i) => (isYourMessage(e) ? [i] : []));
  if (starts[0] !== 0) starts.unshift(-1);
  return starts.map((start, k) => ({
    start,
    end: (starts[k + 1] ?? activity.length) - 1,
  }));
}

type Span = ReturnType<typeof turnSpans>[number];

/** The turn the thread's report was made in; a report saved before it carried its `index` can only be the last ended turn's. */
function reportSpan(thread: Thread, spans: Span[], ended: Span[]) {
  const index = thread.report?.index;
  if (index === undefined) return turnReport(thread) && ended.at(-1);
  return spans.find((s) => s.start < index && index <= s.end + 1);
}

const wasStopped = (thread: Thread, span: Span) =>
  thread.activity.slice(span.start + 1, span.end + 1).some((e) => !!e.turnEnd);
