import type { AgentEvent } from '../host/types/agent.ts';
import type { Thread } from '../model.ts';
import { subThreadsOf } from '../reorder.ts';
import type { State } from '../store/index.tsx';
import { mapThread } from '../store/threads.ts';

const NOTE_PREFIX = '[Sub-thread ';
const EXCERPT_CHARS = 800;

export const WAKE_PROMPT = 'Your sub-threads are idle; their notes are above. Carry on with your work.';

/** A sub-thread's turn end goes to its parent's agent as a note, delivered with its next message (`withNotes`) or by `dueWakes`. */
export function noteParent(state: State, sub: Thread, status: Extract<AgentEvent, { type: 'turn-end' }>['status']): State {
  const parentId = sub.parent?.threadId;
  if (!parentId) return state;
  const ended = state.threads.find((t) => t.id === sub.id) ?? sub;
  const note = subThreadNote(ended, status);
  return { ...state, threads: mapThread(state.threads, parentId, (t) => (t.live && t.status !== 'settled' ? { ...t, live: { ...t.live, notes: [...(t.live.notes ?? []), note] } } : t)) };
}

/** Parents holding sub-thread notes that nothing else will deliver: idle, nothing queued or waiting on you, and every sub-thread idle. */
export function dueWakes(state: Pick<State, 'threads' | 'queue'>): Thread[] {
  return state.threads.filter((t) => {
    if (!t.live || t.live.isWorking || t.live.starting || t.status === 'settled' || t.queued?.length) return false;
    if (!t.live.notes?.some((n) => n.startsWith(NOTE_PREFIX))) return false;
    if (state.queue.some((q) => q.threadId === t.id && (q.kind === 'approval' || q.kind === 'question'))) return false;
    return !subThreadsOf(state.threads, t.id).some((s) => s.live?.isWorking || s.live?.starting);
  });
}

function subThreadNote(sub: Thread, status: string) {
  const said = sub.activity.findLast((e) => e.kind === 'message' && (e.who === 'claude' || e.who === 'codex'))?.text ?? '';
  const excerpt = said.length > EXCERPT_CHARS ? `${said.slice(0, EXCERPT_CHARS)}… (get_thread reads more)` : said;
  return `${NOTE_PREFIX}"${sub.title}" (${sub.id}) ended a turn: ${status}]${excerpt && `\n${excerpt}`}`;
}
