import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState, type Dispatch, type ReactNode } from 'react';
import { dueQueued, sendMessage } from '../chat/outbox.ts';
import { compactFocus, useCompactInstructions } from '../chat/compact.ts';
import { setDriftClassifier } from '../drift.ts';
import { host } from '../host/index.ts';
import { showsDemoData } from '../demoData.ts';
import { NO_AGENT_PROCESS, type AgentEvent, type AgentToolCall, type AttachedAgent, type SeqAgentEvent } from '../host/types/agent.ts';
import { isListed, type QueueItem, type Thread } from '../model.ts';
import { useProfiles } from '../profiles.ts';
import { resolution, undelivered } from '../runtime/apply.ts';
import { setWorktreePath } from '../git/worktrees.ts';
import { agentCalls, resumeAfterLostProcess, type AgentCall } from '../runtime/live.ts';
import { dueResumes, nextResumeAt } from '../runtime/limits.ts';
import { dueReports } from '../runtime/subagents.ts';
import { dueWakes } from '../runtime/subThreadNotes.ts';
import { runTool } from '../runtime/tools.ts';
import { runDevTool } from '../runtime/devTools.ts';
import { toolEnv } from '../runtime/toolEnv.ts';
import type { ToolUndo } from '../runtime/undo.ts';
import type { LayoutAction, LayoutState } from './layout.ts';
import { savePanes, type PanesAction, type PanesState } from './panes.ts';
import { rankQueue, type QueueAction, type QueueState } from './queue.ts';
import { saveSideChats, type SideChatAction, type SideChatState } from './sidechat.ts';
import { saveThreads } from './persist.ts';
import { initialState, reducer } from './root.ts';
import { pruneDrafts } from '../chat/drafts.ts';
import type { ThreadsAction, ThreadsState } from './threads.ts';
import type { UiAction, UiState } from './ui.ts';
import type { ReviewAction } from '../secondOpinion/slice.ts';
import { actedOn, type NotificationsAction, type NotificationsState } from '../notify/slice.ts';
import { scheduleCalls, triggerInput } from '../schedule/calls.ts';
import type { ScheduleAction } from '../schedule/slice.ts';
import type { ScheduleEvent } from '../host/types/schedule.ts';
import { recordAction } from '../replay/recorder.ts';
import { tapAction } from '../remote/tap.ts';
import { useRemoteBridge } from '../remote/useRemoteBridge.ts';
import { useAutoTitles } from '../utility/useAutoTitles.ts';
import { useIdleChecks } from '../goals/useIdleChecks';
import { useAutoSimplify } from '../simplify/useSimplify.ts';
import { usePrSync } from '../git/usePrSync.ts';

export type { View } from './layout.ts';
export { rankQueue };
export { mirrorState, reducer } from './root.ts';

export interface Snapshot {
  threads: Thread[];
  queue: QueueItem[];
}

/** `streamed`: how many of the remote stream's numbered actions this store holds (`src/remote/tap.ts`). */
export type State = ThreadsState & QueueState & PanesState & LayoutState & UiState & SideChatState & NotificationsState & { streamed: number };
export type Action = ThreadsAction | QueueAction | PanesAction | LayoutAction | UiAction | SideChatAction | ReviewAction | NotificationsAction | ScheduleAction | { type: 'reset' } | { type: 'tool-undo'; undo: ToolUndo };

setDriftClassifier((prompt, thread) => host.agent.classify(prompt, thread));

const TICK_MS = showsDemoData() ? 1000 : 60_000;

export const HarnessContext = createContext<{ state: State; dispatch: Dispatch<Action> } | null>(null);

export function HarnessProvider({ children }: { children: ReactNode }) {
  const [state, applyNow] = useReducer(reducer, undefined, initialState);
  const latest = useRef(state);
  // Actions from outside a dispatch (agent events, scheduled runs) are recorded against the newest store this provider has seen.
  const apply = useCallback((action: Action) => {
    recordAction(latest.current, action);
    applyNow(action);
  }, []);
  useEffect(() => {
    latest.current = state;
  }, [state]);
  const dispatch = useCallback<Dispatch<Action>>((action) => {
    const before = latest.current;
    recordAction(before, action);
    const answer = resolution(before, action);
    if (answer) host.agent.resolve(answer.requestId, answer.decision).catch((error: unknown) => apply({ type: 'say', threadId: answer.threadId, entry: undelivered(answer, error) }));
    let after: State | undefined;
    const next = () => (after ??= reducer(before, action));
    const calls = agentCalls(before, action, next);
    for (const input of scheduleCalls(before, action, next)) host.schedule.set(input).catch((error: unknown) => console.error('Saving the schedule failed', error));
    // A deleted thread takes its trigger with it.
    if (action.type === 'delete') for (const id of action.threadIds) host.schedule.remove(id).catch((error: unknown) => console.error('Removing the schedule failed', error));
    for (const call of calls) {
      // A call that throws (bad options, no adapter) ends the turn as failed, so the thread says why instead of spinning.
      callAgent(call).catch((error: unknown) => {
        const thread = call.method === 'send' && isLostProcess(error) ? latest.current.threads.find((t) => t.id === call.threadId) : undefined;
        const retry = thread && call.method === 'send' ? resumeAfterLostProcess(thread, call) : [];
        if (retry.length === 0) return apply({ type: 'agent', event: failed(call.threadId, error) });
        for (const again of retry) {
          if (again.method === 'start') applyNow({ type: 'agent-starting', threadId: again.threadId, provider: again.options.provider });
          callAgent(again).catch((e: unknown) => apply({ type: 'agent', event: failed(again.threadId, e) }));
        }
      });
    }
    applyNow(action);
    // After the action: a new thread only exists once it has applied.
    for (const call of calls) if (call.method === 'start') applyNow({ type: 'agent-starting', threadId: call.threadId, provider: call.options.provider });
    if (action.type === 'workspace') void retarget(next().threads.find((t) => t.id === action.threadId));
    const acted = actedOn(action, before.queue);
    if (acted) host.notify.addressed({ threadId: acted, isActedOn: true }).catch(() => undefined);
  }, [apply]);
  // The tick is the app's clock, one per minute of `now`: the demo runs it 60× fast, real threads at wall-clock speed.
  // Real agents report through host.agent whether or not the demo is paused.
  useEffect(() => {
    if (state.paused) return;
    // Streamed but not recorded for replay: a device's copy keeps the same clock, so entries it applies get the same times.
    const id = setInterval(() => {
      const tick: Action = { type: 'tick' };
      tapAction(tick);
      applyNow(tick);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [state.paused]);
  useEffect(() => {
    const onEvent = (event: SeqAgentEvent) => {
      if (event.type === 'worktree') setWorktreePath(event.threadId, event.path);
      apply({ type: 'agent', event, ms: Date.now() });
    };
    // After a window reload, agents still running in main replay what they sent meanwhile; live events wait behind that replay.
    let held: SeqAgentEvent[] | null = [];
    const off = host.agent.onEvent((event) => (held ? held.push(event) : onEvent(event)));
    const attached = latest.current.threads.filter((t) => t.live && !t.live.isDetached).map((t) => ({ threadId: t.id, after: t.live!.eventSeq ?? 0 }));
    void (attached.length ? host.agent.attached(attached) : Promise.resolve([]))
      .catch((error: unknown): AttachedAgent[] => (console.error('Replaying agent events after reload failed', error), []))
      .then((agents) => {
        const seen = new Set<number>();
        [...agents.flatMap((a) => a.events), ...held!]
          .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
          .forEach((event) => {
            if (event.seq !== undefined && seen.has(event.seq)) return;
            if (event.seq !== undefined) seen.add(event.seq);
            onEvent(event);
          });
        held = null;
      });
    return off;
  }, [apply]);
  useEffect(() => {
    const onSchedule = (event: ScheduleEvent) => {
      if (event.type === 'agent') return apply({ type: 'agent', event: event.event });
      if (event.type === 'autofix') return apply({ type: 'autofix', threadId: event.threadId, event: event.event });
      apply(event.type === 'ci' ? { type: 'ci-result', event } : { type: 'schedule-run', event });
    };
    const off = host.schedule.onEvent(onSchedule);
    // What happened while no window was open: runs and their agent's events, in order.
    void host.schedule.drain().then((events) => events.forEach(onSchedule), (error: unknown) => console.error('Reading scheduled runs failed', error));
    return off;
  }, [apply]);
  useEffect(() => {
    const onToolCall = (call: AgentToolCall) => {
      const env = toolEnv(
        () => latest.current,
        (action) => {
          dispatch(action);
          // The next step of this call (or the next call) can run before React renders this one; it must see this change.
          latest.current = reducer(latest.current, action);
        },
      );
      void (import.meta.env.DEV && call.threadId === '__dev__' ? runDevTool(call, env) : runTool(call, env)).then((result) => host.agent.toolResult(call.id, result));
    };
    const off = host.agent.onToolCall(onToolCall);
    // Asked only once listening, so a call main sends meanwhile arrives once, by one route or the other.
    void host.agent.pendingToolCalls().then((calls) => calls.forEach(onToolCall), (error: unknown) => console.error('Taking back tool calls after reload failed', error));
    return off;
  }, [dispatch]);
  useQueueRunner(state, dispatch);
  useDelegatedReports(state.threads, dispatch);
  useSubThreadWakes(state, dispatch);
  useCompactInstructions(state.threads);
  useRemoteBridge(state, dispatch);
  useLimitResumes(state.threads, dispatch);
  useEffect(() => {
    savePanes(state.panes);
  }, [state.panes]);
  useEffect(() => saveSideChats(state.sidechats), [state.sidechats]);
  useAutoTitles(state.threads, dispatch);
  useIdleChecks(state.threads, dispatch);
  useAutoSimplify(state.threads, dispatch);
  usePrSync(state.threads, dispatch);
  useEffect(() => saveThreads(state), [state.threads, state.queue, state.checkpoints, state.forks]);
  useEffect(() => pruneDrafts(new Set(state.threads.map((t) => t.id))), [state.threads]);
  return <HarnessContext.Provider value={{ state, dispatch }}>{children}</HarnessContext.Provider>;
}

/** Sends each live thread's next queued message once its agent's turn is over; `dueQueued` says when. */
function useQueueRunner(state: State, dispatch: Dispatch<Action>) {
  // The send applies on the next render; until then the same head is still due.
  const sent = useRef(new Set<string>());
  useEffect(() => {
    for (const { thread, message } of dueQueued(state)) {
      if (sent.current.has(message.id)) continue;
      sent.current.add(message.id);
      const focus = compactFocus(message.draft);
      if (focus !== null) dispatch({ type: 'compact', threadId: thread.id, focus, queuedId: message.id });
      else sendMessage(dispatch, state, thread, message, { queuedId: message.id });
    }
  }, [state, dispatch]);
}

/** Sends each finished delegated task's report to its thread's agent right away, steering a turn in flight; `dueReports` says which. */
function useDelegatedReports(threads: Thread[], dispatch: Dispatch<Action>) {
  // The report applies on the next render; until then the same one is still due.
  const sent = useRef(new Set<string>());
  useEffect(() => {
    for (const { thread, subagent } of dueReports(threads)) {
      const key = `${thread.id}:${subagent.id}`;
      if (sent.current.has(key)) continue;
      sent.current.add(key);
      dispatch({ type: 'delegate-report', threadId: thread.id, subagentId: subagent.id });
    }
  }, [threads, dispatch]);
}

/** Starts each idle parent on its sub-threads' notes once they're all idle; `dueWakes` says which. */
function useSubThreadWakes(state: State, dispatch: Dispatch<Action>) {
  // The wake applies on the next render; until then the same parent is still due.
  const woken = useRef(new Set<string>());
  useEffect(() => {
    const due = dueWakes(state);
    for (const id of woken.current) if (!due.some((t) => t.id === id)) woken.current.delete(id);
    for (const { id } of due) {
      if (woken.current.has(id)) continue;
      woken.current.add(id);
      dispatch({ type: 'subthread-wake', threadId: id });
    }
  }, [state, dispatch]);
}

/** Resumes threads you set to Resume at reset once their reset passes; one timer for the earliest. */
function useLimitResumes(threads: Thread[], dispatch: Dispatch<Action>) {
  const [tick, setTick] = useState(0);
  // The resume applies on the next render; until then the same thread is still due.
  const resumed = useRef(new Set<string>());
  useEffect(() => {
    for (const t of dueResumes(threads)) {
      const key = `${t.id}:${t.live!.limit!.resetsAt}`;
      if (resumed.current.has(key)) continue;
      resumed.current.add(key);
      dispatch({ type: 'resume', threadId: t.id, atReset: true });
    }
    const at = nextResumeAt(threads);
    if (at === undefined) return;
    // setTimeout overflows past ~24.8 days; a weekly reset is well inside that.
    const id = window.setTimeout(() => setTick((n) => n + 1), at - Date.now() + 1000);
    return () => window.clearTimeout(id);
  }, [threads, dispatch, tick]);
}

// Sequential: a handoff's stop must reach the old agent before the new one starts in the same thread.
let pending: Promise<unknown> = Promise.resolve();

function callAgent(call: AgentCall) {
  const run = () => {
    if (call.method === 'start') return host.agent.start(call.threadId, call.options);
    if (call.method === 'send') return host.agent.send(call.threadId, call.text, call.images, call.skills, call.speed, call.steer, call.steerId);
    if (call.method === 'compact') return host.agent.compact(call.threadId, call.focus);
    if (call.method === 'stopTask') return host.agent.stopTask(call.threadId, call.taskId);
    return host.agent[call.method](call.threadId);
  };
  const next = pending.then(run);
  pending = next.catch(() => {});
  return next;
}

function isLostProcess(error: unknown) {
  return error instanceof Error && error.message.includes(NO_AGENT_PROCESS);
}

function failed(threadId: string, error: unknown): AgentEvent {
  return { threadId, type: 'turn-end', status: 'failed', error: error instanceof Error ? error.message : String(error) };
}

export function useHarness() {
  const ctx = useContext(HarnessContext);
  if (!ctx) throw new Error('useHarness must be used inside HarnessProvider');
  return ctx;
}

const NEW_VIEW = { kind: 'new' } as const;

export function useSpace() {
  const { state } = useHarness();
  const profiles = useProfiles();
  return profiles.find((p) => p.id === state.spaceId) ?? profiles[0];
}

export function useView(spaceId?: string) {
  const { state } = useHarness();
  // A profile added in Settings gets its layout on first visit; until then it shows a new thread.
  return state.views[spaceId ?? state.spaceId] ?? NEW_VIEW;
}

export function useThread(id: string) {
  const { state } = useHarness();
  return state.threads.find((t) => t.id === id);
}

export function useSpaceThreads(spaceId?: string) {
  const { state } = useHarness();
  const id = spaceId ?? state.spaceId;
  return state.threads.filter((t) => t.spaceId === id && isListed(t));
}

export function useSpaceQueue(spaceId?: string) {
  const { state } = useHarness();
  const id = spaceId ?? state.spaceId;
  const ids = new Set(state.threads.filter((t) => t.spaceId === id && isListed(t)).map((t) => t.id));
  return rankQueue(state.queue.filter((q) => ids.has(q.threadId)));
}

export function snapshot(state: State): Snapshot {
  return { threads: state.threads, queue: state.queue };
}

/** A scheduled thread's trigger keeps how main starts it; a new workspace before its first run replaces that. */
async function retarget(thread: Thread | undefined) {
  if (!thread) return;
  const trigger = (await host.schedule.list()).find((t) => t.threadId === thread.id);
  const input = trigger && triggerInput(thread, { when: trigger.when, missed: trigger.missed, name: trigger.name, prompt: trigger.prompt });
  if (input) await host.schedule.set(input).catch((error: unknown) => console.error('Saving the schedule failed', error));
}
