import type { ActivityEntry, Handoff, Provider, Step, Thread } from '../model.ts';
import { log, mapThread } from '../store/threads.ts';
import type { State } from '../store/index.tsx';

export interface DiffStat {
  files: number;
  added: number;
  removed: number;
}

export const PROVIDER_NAME = { claude: 'Claude', codex: 'Codex' } satisfies Record<Provider, string>;

const RECENT_DECISIONS = 3;

/** The context the receiving agent starts from: goal, done and open steps, your latest decisions and the diff so far. */
export function handoffSummary(thread: Thread, to: Provider, diff: DiffStat | null) {
  const isOpen = (s: Step) => s.status !== 'done' && s.status !== 'dropped';
  const decisions = thread.activity.filter((a) => a.who === 'you' && a.kind === 'message').slice(-RECENT_DECISIONS);
  const list = (lines: string[]) => (lines.length ? lines.map((l) => `- ${l}`).join('\n') : '- None yet');
  return [
    `**Handoff to ${PROVIDER_NAME[to]}**`,
    `**Goal:** ${thread.goal}`,
    `**Done**\n${list(thread.steps.filter((s) => s.status === 'done').map((s) => s.title))}`,
    `**Open**\n${list(thread.steps.filter(isOpen).map((s) => `${s.title} (${s.status})`))}`,
    `**Recent decisions**\n${list(decisions.map((d) => (d.text.length > 140 ? `${d.text.slice(0, 139)}…` : d.text)))}`,
    `**Diff so far:** ${diff ? `${diff.files} files, +${diff.added} −${diff.removed}` : 'not read'}`,
  ].join('\n\n');
}

const VERB = { drafting: 'Handing off', started: 'Handed off', failed: 'Could not hand off' } satisfies Record<Handoff['status'], string>;

const handoffEntry = (at: number, handoff: Handoff): ActivityEntry => ({ at, who: 'harness', kind: 'event', text: `${VERB[handoff.status]} from ${PROVIDER_NAME[handoff.from]} to ${PROVIDER_NAME[handoff.to]}`, handoff });

/** The thread's handoff row still waiting on its prompt; -1 when none is. */
export const draftingIndex = (thread: Thread) => thread.activity.findLastIndex((e) => e.handoff?.status === 'drafting');

/** Opens the handoff's row while its prompt is drafted; the thread stays on its agent until `handoff` lands. */
export function handoffDraft(state: State, threadId: string, to: Provider): State {
  return { ...state, threads: mapThread(state.threads, threadId, (t) => (t.providers[0] === to || draftingIndex(t) >= 0 ? t : log(t, handoffEntry(state.now, { from: t.providers[0], to, status: 'drafting' })))) };
}

// For a live thread, `agentCalls` (src/runtime/live.ts) also stops the old agent and starts the new one in the same worktree
// with `prompt` as its first message. A demo thread only changes which agent it names.
/** Moves the thread to `to` and records the prompt on its handoff row: the drafting one, or a new one (a remote handoff never drafts). Not a goal revision: what done means is unchanged. */
export function handoff(state: State, threadId: string, to: Provider, prompt: string, fallback?: Handoff['fallback']): State {
  return {
    ...state,
    threads: mapThread(state.threads, threadId, (t) => {
      const from = t.providers[0];
      if (from === to) return settleDraft(t, state.now, { status: 'failed', error: `Already on ${PROVIDER_NAME[to]}` });
      const moved = { ...t, providers: [to, ...t.providers.filter((p) => p !== to)] };
      return settleDraft(moved, state.now, { from, to, status: 'started', prompt, ...(fallback && { fallback }) });
    }),
  };
}

/** The drafting row ends without a handoff: the draft threw, or Mochi quit before it came back. */
export function handoffFail(state: State, threadId: string, error: string): State {
  return { ...state, threads: mapThread(state.threads, threadId, (t) => settleDraft(t, state.now, { status: 'failed', error })) };
}

/** Every drafting row in `activity` failed with `error`; same array when none was open. */
export function failDrafts(activity: ActivityEntry[], error: string) {
  if (!activity.some((e) => e.handoff?.status === 'drafting')) return activity;
  return activity.map((e) => (e.handoff?.status === 'drafting' ? handoffEntry(e.at, { ...e.handoff, status: 'failed', error }) : e));
}

/** Patches the drafting row with `patch`; with none open, a started handoff logs its own row and anything else changes nothing. */
function settleDraft(thread: Thread, now: number, patch: Partial<Handoff>): Thread {
  const i = draftingIndex(thread);
  if (i < 0) return patch.status === 'started' ? log(thread, handoffEntry(now, patch as Handoff)) : thread;
  const entry = thread.activity[i];
  return { ...thread, activity: thread.activity.with(i, handoffEntry(entry.at, { ...entry.handoff!, ...patch })) };
}
