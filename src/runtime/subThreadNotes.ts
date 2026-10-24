import { AUTOFIX_ATTEMPTS, type AutofixEvent } from '../git/autofix.ts';
import type { AgentEvent } from '../host/types/agent.ts';
import type { PullRequest, Thread } from '../model.ts';
import { subThreadsOf } from '../reorder.ts';
import type { State } from '../store/types.ts';
import { mapThread } from '../store/threads.ts';

const NOTE_PREFIX = '[Sub-thread ';
const EXCERPT_CHARS = 800;

export const WAKE_PROMPT = 'Your sub-threads are idle; their notes are above. Carry on with your work.';

/**
 * A sub-thread's turn end goes to its parent's agent as a note, delivered with its next message (`withNotes`) or by `dueWakes`.
 * A turn an Auto-fix event started and that ended normally stays with the sub-thread: it owns its PR, and the parent hears only `notePr`'s escalations.
 */
export function noteParent(state: State, sub: Thread, status: Extract<AgentEvent, { type: 'turn-end' }>['status']): State {
  if (status === 'done' && sub.turn && sub.activity[sub.turn.start]?.autofix) return state;
  const ended = state.threads.find((t) => t.id === sub.id) ?? sub;
  return addNote(state, sub, subThreadNote(ended, status));
}

/** A sub-thread's PR needs its parent: `prEscalation` or `prEnded` said what. Notes are deduped, so the same news never stacks. */
export function notePr(state: State, sub: Thread, pr: number, what: string): State {
  return addNote(state, sub, `${NOTE_PREFIX}"${sub.title}" (${sub.id}) PR #${pr}: ${what}]`);
}

/**
 * The Auto-fix events a parent hears of: CI Auto-fix gave up on, or a conflict back after the sub-thread's fix. Merged and closed
 * come from `prEnded` instead, which also sees PRs without Auto-fix. CI failures, first conflicts and reviews stay with the sub-thread.
 */
export function prEscalation(sub: Thread, event: AutofixEvent): string | null {
  if (event.kind === 'stopped') return event.reason === 'cap' ? `CI still failing after ${AUTOFIX_ATTEMPTS} Auto-fix attempts; Auto-fix stopped and the PR needs a decision` : null;
  if (event.kind !== 'conflict') return null;
  const last = sub.activity.findLast((e) => e.autofix?.pr === event.pr)?.autofix;
  return last?.kind === 'conflict' ? "merge conflict still there after the sub-thread's fix; it may need a decision" : null;
}

/** `before` is the sub-thread as it was: each of its PRs `state` now records as merged or closed tells the parent, however Mochi learned of it. */
export function notePrsEnded(state: State, before: Thread): State {
  const after = state.threads.find((t) => t.id === before.id);
  return after ? prEnded(before.prs, after.prs).reduce((s, pr) => notePr(s, after, pr.number, pr.state), state) : state;
}

/** The PRs `next` records as merged or closed that `prev` didn't. */
export function prEnded(prev: PullRequest[], next: PullRequest[]): PullRequest[] {
  const isEnded = (p?: PullRequest) => p?.state === 'merged' || p?.state === 'closed';
  return next.filter((p) => isEnded(p) && !isEnded(prev.find((q) => q.number === p.number)));
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

function addNote(state: State, sub: Thread, note: string): State {
  const parentId = sub.parent?.threadId;
  if (!parentId) return state;
  return { ...state, threads: mapThread(state.threads, parentId, (t) => (t.live && t.status !== 'settled' && !t.live.notes?.includes(note) ? { ...t, live: { ...t.live, notes: [...(t.live.notes ?? []), note] } } : t)) };
}

function subThreadNote(sub: Thread, status: string) {
  const said = sub.activity.findLast((e) => e.kind === 'message' && (e.who === 'claude' || e.who === 'codex'))?.text ?? '';
  const excerpt = said.length > EXCERPT_CHARS ? `${said.slice(0, EXCERPT_CHARS)}… (get_thread reads more)` : said;
  return `${NOTE_PREFIX}"${sub.title}" (${sub.id}) ended a turn: ${status}]${excerpt && `\n${excerpt}`}`;
}
