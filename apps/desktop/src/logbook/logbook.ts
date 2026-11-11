import { MOCHI_SERVER } from '@mochi/domain/runtime/toolTable';
import { isExpired } from '../chat/proposals.ts';
import type { ActivityEntry, Thread } from '../model.ts';

/** What you changed by hand, per thread: replies you saved, and recorded answers you removed. Both hold `entryKey`s. */
export interface AnswerMarks {
  saved: string[];
  hidden: string[];
}

export const NO_MARKS: AnswerMarks = { saved: [], hidden: [] };

/** A question and its answer, linked to the reply at activity `index`. */
export interface LoggedAnswer {
  key: string;
  question: string;
  summary: string;
  at: number;
  index: number;
  /** You saved the reply yourself; the agent didn't record it. */
  isSaved: boolean;
}

export interface LoggedDecision {
  key: string;
  kind: 'decision' | 'assumption';
  text: string;
  /** Assumptions: you reworded it, and `text` is your wording. */
  isCorrected: boolean;
  at: number;
  index: number;
}

/** Side work the agent suggested that never started. */
export interface LoggedProposal {
  key: string;
  title: string;
  brief: string;
  state: 'pending' | 'expired' | 'dismissed';
  reason?: string;
  at: number;
  index: number;
}

// The index alone would outlive a rewind: the same position can hold a different entry afterwards.
export const entryKey = (entry: Pick<ActivityEntry, 'at'>, index: number) =>
  `${index}:${entry.at}`;

/** The thread's answers in transcript order: the ones the agent recorded (`record_answer`), then the replies you saved. */
export function answersOf(
  thread: Pick<Thread, 'activity'>,
  marks: AnswerMarks = NO_MARKS,
): LoggedAnswer[] {
  const { activity } = thread;
  const recorded = activity.flatMap((entry, i): LoggedAnswer[] => {
    const input = recordedAnswer(entry);
    const key = entryKey(entry, i);
    if (!input || marks.hidden.includes(key)) return [];
    return [
      {
        key,
        ...input,
        at: entry.at,
        index: turnReply(activity, i),
        isSaved: false,
      },
    ];
  });
  const recordedAt = new Set(recorded.map((a) => a.index));
  const saved = marks.saved.flatMap((key): LoggedAnswer[] => {
    const index = Number(key.split(':')[0]);
    const entry = activity[index];
    if (!entry || !isReply(entry) || entryKey(entry, index) !== key) return [];
    if (recordedAt.has(index)) return [];
    return [
      {
        key,
        question: clip(promptBefore(activity, index), 160) || 'Saved reply',
        summary: clip(entry.text, 300),
        at: entry.at,
        index,
        isSaved: true,
      },
    ];
  });
  return [...recorded, ...saved].sort((a, b) => a.index - b.index);
}

/** Every decision and assumption the thread's turns reported (`wrap_up`), from the plan records they left. */
export function decisionsOf(
  thread: Pick<Thread, 'activity' | 'assumptions'>,
): LoggedDecision[] {
  const { activity } = thread;
  return activity.flatMap((entry, i): LoggedDecision[] => {
    const record = entry.planRecord;
    if (!record) return [];
    const place = { at: entry.at, index: turnReply(activity, i) };
    const decisions = record.decisions.map((d, n) => ({
      key: `${entryKey(entry, i)}:d${n}`,
      kind: 'decision' as const,
      text: d.text,
      isCorrected: false,
      ...place,
    }));
    const assumptions = record.assumptionIds.flatMap((id) => {
      const assumption = thread.assumptions?.find((a) => a.id === id);
      if (!assumption) return [];
      return [
        {
          key: `${entryKey(entry, i)}:${id}`,
          kind: 'assumption' as const,
          text: assumption.correction ?? assumption.text,
          isCorrected: assumption.state === 'changed',
          ...place,
        },
      ];
    });
    return [...decisions, ...assumptions];
  });
}

/** Suggested threads still waiting, expired or dismissed; started ones and those done in the thread are not deferred. */
export function proposalsOf(
  thread: Pick<Thread, 'activity'>,
  now: number,
): LoggedProposal[] {
  const { activity } = thread;
  return activity.flatMap((entry, i) =>
    (entry.proposals ?? []).flatMap((p): LoggedProposal[] => {
      if (p.state !== 'pending' && p.state !== 'dismissed') return [];
      return [
        {
          key: p.id,
          title: p.title,
          brief: p.brief,
          state: isExpired(p, entry, now) ? 'expired' : p.state,
          ...(p.reason && { reason: p.reason }),
          at: entry.at,
          index: turnReply(activity, i),
        },
      ];
    }),
  );
}

/** The answer on the reply at `index`, if it is in the logbook. */
export const answerAt = (answers: LoggedAnswer[], index: number) =>
  answers.find((a) => a.index === index);

/** Saving a reply adds it; saving it again takes it out, and a recorded answer is hidden rather than lost. */
export function toggledMarks(
  thread: Pick<Thread, 'activity'>,
  marks: AnswerMarks,
  index: number,
): AnswerMarks {
  const existing = answerAt(answersOf(thread, marks), index);
  if (existing) return withoutAnswer(marks, existing);
  const entry = thread.activity[index];
  if (!entry) return marks;
  return { ...marks, saved: [...marks.saved, entryKey(entry, index)] };
}

export function withoutAnswer(
  marks: AnswerMarks,
  answer: Pick<LoggedAnswer, 'key' | 'isSaved'>,
): AnswerMarks {
  return answer.isSaved
    ? { ...marks, saved: marks.saved.filter((k) => k !== answer.key) }
    : { ...marks, hidden: [...marks.hidden, answer.key] };
}

function recordedAnswer(entry: ActivityEntry) {
  if (entry.kind !== 'tool' || entry.isError) return undefined;
  if (entry.mcp?.server !== MOCHI_SERVER || entry.mcp.tool !== 'record_answer')
    return undefined;
  const { question, summary } = entry.input ?? {};
  if (typeof question !== 'string' || typeof summary !== 'string')
    return undefined;
  return { question, summary };
}

const isPrompt = (entry: ActivityEntry) =>
  entry.kind === 'message' && entry.who === 'you';

const isReply = (entry: ActivityEntry) =>
  entry.kind === 'message' && entry.who !== 'you';

/**
 * The reply a row opens the thread at: the last one of entry `i`'s turn, which is the row the transcript always shows (earlier
 * rows of a turn can be folded). `i` itself while the turn has no reply yet.
 */
function turnReply(activity: ActivityEntry[], i: number) {
  let end = i;
  while (end + 1 < activity.length && !isPrompt(activity[end + 1]!)) end++;
  for (let j = end; j >= 0 && !isPrompt(activity[j]!); j--)
    if (isReply(activity[j]!)) return j;
  return i;
}

function promptBefore(activity: ActivityEntry[], index: number) {
  for (let j = index - 1; j >= 0; j--)
    if (isPrompt(activity[j]!)) return activity[j]!.text;
  return '';
}

function clip(text: string, max: number) {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}
