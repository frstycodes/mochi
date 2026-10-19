import type { QueueItem, Thread } from '../model.ts';
import type { Action, State } from '../store/index.tsx';

/**
 * A thread's recording (JSON lines, one file per thread in main): the thread and its queue items as they stood when
 * recording began, then every store action that changed them, stamped with the wall clock (`t`) and the app clock (`now`).
 * Agent events are recorded raw; your own actions (messages, answers, goal edits) ride along so the replay shows them too.
 */
export type ReplayLine = ReplayBase | ReplayStep | { t: number; capped: true };

export interface ReplayBase {
  t: number;
  now: number;
  base: { thread: Thread; queue: QueueItem[] };
}

export interface ReplayStep {
  t: number;
  now: number;
  /** `restore`: a later base line, written when recording resumed in a new session (the thread was restored from disk in between). */
  action: RecordedAction | Extract<Action, { type: 'restore' }>;
}

export interface Recording {
  base: ReplayBase;
  steps: ReplayStep[];
  /** Main stopped appending at `MAX_REPLAY_BYTES` (`host/types/data.ts`); the replay ends early. */
  isCapped: boolean;
}

const RECORDED = [
  'agent',
  'send',
  'interrupt',
  'resume',
  'say',
  'rename',
  'edit-goal',
  'goal-drafted',
  'goal-remove',
  'simplified',
  'simplify-toggle',
  'criterion-claim',
  'criterion-check',
  'report',
  'similar-dismiss',
  'drift-verdict',
  'drift-keep',
  'controls',
  'handoff-draft',
  'handoff',
  'handoff-fail',
  'bg-start',
  'bg-stop',
  'rewind',
  'rewind-message',
  'answer',
  'queue-add',
  'card-record',
] as const satisfies readonly Action['type'][];

export type RecordedAction = Extract<Action, { type: (typeof RECORDED)[number] }>;

/** The thread an action changes, when it's one a replay rebuilds from. Demo threads (no `live`) run on the tick and aren't recorded. */
export function recordedThread(state: State, action: Action): Thread | undefined {
  if (!(RECORDED as readonly string[]).includes(action.type)) return;
  const id = threadIdOf(state, action as RecordedAction);
  const thread = id === undefined ? undefined : state.threads.find((t) => t.id === id);
  return thread?.live ? thread : undefined;
}

function threadIdOf(state: State, action: RecordedAction): string | undefined {
  switch (action.type) {
    case 'agent':
      return action.event.threadId;
    case 'answer':
    case 'card-record':
      return state.queue.find((q) => q.id === action.queueId)?.threadId;
    case 'queue-add':
      return action.item.threadId;
    default:
      return action.threadId;
  }
}

/** What an action adds to its thread's recording, given the store just before it; a thread's first line is its base. */
export function linesFor(state: State, action: Action, t: number, isStarted: (threadId: string) => boolean): { threadId: string; lines: ReplayLine[] } | null {
  const thread = recordedThread(state, action);
  if (!thread) return null;
  const step: ReplayStep = { t, now: state.now, action: action as RecordedAction };
  if (isStarted(thread.id)) return { threadId: thread.id, lines: [step] };
  return { threadId: thread.id, lines: [{ t, now: state.now, base: { thread, queue: state.queue.filter((q) => q.threadId === thread.id) } }, step] };
}

/**
 * Folds runs of streamed message deltas into one step, keeping the first one's stamps. The reducer appends a delta to the
 * message before it, so the folded step rebuilds the same entry: same text, same `at` and `ms` (only the first delta of a
 * run can open an entry). A non-delta message always opens a new entry, so it starts a new run.
 */
export function compact<T extends ReplayLine>(lines: T[]): T[] {
  const out: T[] = [];
  for (const line of lines) {
    const last = out.at(-1);
    const event = 'action' in line && line.action.type === 'agent' ? line.action.event : undefined;
    const lastAction = last && 'action' in last && last.action.type === 'agent' ? last.action : undefined;
    const lastEvent = lastAction?.event;
    if (lastAction && event?.type === 'message' && event.isDelta && lastEvent?.type === 'message' && lastEvent.threadId === event.threadId) {
      out[out.length - 1] = { ...last, action: { ...lastAction, event: { ...lastEvent, text: lastEvent.text + event.text } } } as T;
      continue;
    }
    out.push(line);
  }
  return out;
}

export function parseRecording(text: string | null): Recording | null {
  if (!text) return null;
  const lines: ReplayLine[] = [];
  let isCapped = false;
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    let line: ReplayLine;
    try {
      line = JSON.parse(raw) as ReplayLine;
    } catch {
      // A line cut short by a quit mid-append: everything before it still replays.
      break;
    }
    if ('capped' in line) {
      isCapped = true;
      break;
    }
    lines.push(line);
  }
  const [base, ...rest] = lines;
  if (!base || !('base' in base)) return null;
  const steps = rest.map((l): ReplayStep => ('base' in l ? { t: l.t, now: l.now, action: { type: 'restore', snapshot: { threads: [l.base.thread], queue: l.base.queue } } } : (l as ReplayStep)));
  return { base, steps: compact(steps), isCapped };
}

export const toLines = (lines: ReplayLine[]) => lines.map((l) => `${JSON.stringify(l)}\n`).join('');
