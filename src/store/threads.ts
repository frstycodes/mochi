import type { AgentEvent, AgentImage } from '../host/types/agent.ts';
import type { CheckRun } from '../host/types/git.ts';
import type { DraftedCriterion } from '../utility/prompts.ts';
import { NOW0, seedThreads, type ActivityEntry, type Author, type LineSlot, type Provider, type QueuedMessage, type SentImage, type Similar, type Source, type Step, type StepStatus, type Thread, type TurnReport } from '../model.ts';
import { orderQueue, pauseQueue } from '../chat/outbox.ts';
import { sourcePrompt } from '../sources.ts';
import { KEEPS_TO_MUTE, stepTitleFrom, type DriftKind } from '../drift.ts';
import { applyDraft, type GoalDraft } from '../goals/edit.ts';
import { goalProgress } from '../progress.ts';
import { reorderThreads } from '../reorder.ts';
import { applyAgentEvent, applyAgentEvents } from '../runtime/apply.ts';
import { demoEvents, overlapEvents } from '../runtime/demo.ts';
import { startBackground, type BackgroundStart } from '../runtime/subagents.ts';
import { recordCheckpoints, rewind, rewindToMessage, seedCheckpoints, undoRewind, type Checkpoint, type RewindMode, type RewindUndo } from '../rewind/checkpoints.ts';
import { forkThread, keepFork, type Fork, type ForkPoint } from '../rewind/fork.ts';
import type { ThreadControls } from '../runtime/controls.ts';
import { contextMax } from '../runtime/models.ts';
import { handoff } from '../rewind/handoff.ts';
import { getPrefs } from '../settings/prefs.ts';
import { threadCwd } from '../host/cwd.ts';
import { projectRef, repoFor } from '../projects.ts';
import { branchName, repoWorkspace, type WorkspaceDraft } from '../git/workspace.ts';
import type { Action, Snapshot, State } from './index.tsx';
import { getRestored } from './persist.ts';
import { showsDemoData } from '../demoData.ts';
import type { TriggerDraft } from '../schedule/calls.ts';
import { describeTrigger } from '../schedule/describe.ts';

export type OverlapMode = 'link' | 'extract' | 'race' | 'related';

export interface ThreadsState {
  now: number;
  threads: Thread[];
  seq: number;
  checkpoints: Record<string, Checkpoint[]>;
  checkpointSeq: number;
  rewindUndo: RewindUndo | null;
  /** Fork thread id → where it was forked from. */
  forks: Record<string, Fork>;
}

export type ThreadsAction =
  | { type: 'tick' }
  /** `ms`: wall-clock arrival, stamped on the entries the event logs so a live turn can say how long it took to the second. */
  | { type: 'agent'; event: AgentEvent; ms?: number }
  | { type: 'agent-starting'; threadId: string; provider: Provider }
  | { type: 'overlap'; queueId: string; mode: OverlapMode }
  | { type: 'trigger-overlap' }
  | { type: 'settle'; threadId: string }
  | { type: 'unsettle'; threadId: string }
  | { type: 'rename'; threadId: string; title: string }
  /** A model's name for the thread; dropped when you renamed it meanwhile. */
  | { type: 'title-generated'; threadId: string; title: string }
  /** For good: every slice drops what it keeps for these threads; `agentCalls` stops their agents. */
  | { type: 'delete'; threadIds: string[] }
  | { type: 'create'; title: string; provider: Provider; /** A project ref (`src/projects.ts`); null for a folderless chat. */ project: string | null; dependOn?: { threadId: string; stepId: string }; branchFrom?: string; controls?: ThreadControls; isLive?: boolean; /** Opened by an agent: you stay on the view you're on. */ isBackground?: boolean; /** Waits for its first scheduled run instead of starting now. */ schedule?: TriggerDraft; /** Unset: a new worktree from the default branch, or a project folder when that's your Settings default. */ workspace?: WorkspaceDraft; /** What the agent starts on when it isn't the title as typed (`withReferences`). */ prompt?: string; skills?: string[]; /** Sent with the first prompt. */ images?: SentImage[] }
  /** Before a thread's folder is set up (`isUnstarted`): a different workspace for it. */
  | { type: 'workspace'; threadId: string; workspace: WorkspaceDraft }
  | { type: 'controls'; threadId: string; controls: ThreadControls }
  | { type: 'interrupt'; threadId: string }
  /** After a usage limit: on the same account, or (`onApiKey`) on the stored API key from now on. `atReset`: the reset came and you had chosen Resume at reset. */
  | { type: 'resume'; threadId: string; onApiKey?: boolean; atReset?: boolean }
  | { type: 'limit-auto-resume'; threadId: string; isOn: boolean }
  /**
   * `prompt` and `images` are what the agent gets when they differ from the transcript's `text` (composer references). No `drift` while the classifier is still out; `drift-verdict` tags the message once it answers.
   * `queuedId`: the queued message this sends, which leaves the queue. `interrupts`: ends the turn in flight first (the queue's Send now).
   */
  | { type: 'send'; threadId: string; text: string; drift?: DriftKind; reason: string; prompt?: string; images?: AgentImage[]; /** Thumbnails of the images you attached, for the transcript. */ thumbs?: string[]; skills?: string[]; queuedId?: string; interrupts?: boolean }
  | { type: 'queued-add'; threadId: string; message: QueuedMessage }
  /** Edit and remove both take a message out; Edit puts its text back in the composer itself. */
  | { type: 'queued-remove'; threadId: string; id: string }
  | { type: 'queued-order'; threadId: string; ids: string[] }
  | { type: 'queued-resume'; threadId: string }
  /** A link or file you added in the summary; a live agent is told in a message of yours. */
  | { type: 'source-add'; threadId: string; source: Source }
  | { type: 'drift-verdict'; threadId: string; text: string; drift: DriftKind; reason: string }
  | { type: 'drift-new-thread'; threadId: string; prompt: string; branchFrom: 'current' | 'base' }
  | { type: 'drift-settings'; threadId: string; isMuted: boolean }
  | { type: 'drift-keep'; threadId: string }
  | { type: 'edit-goal'; threadId: string; draft: GoalDraft; by?: Author }
  /** The background model's goal for a thread that had none; dropped when one was set meanwhile or you removed it. */
  | { type: 'goal-drafted'; threadId: string; outcome: string; criteria: DraftedCriterion[]; similar?: Similar[] }
  | { type: 'criterion-check'; threadId: string; criterionId: string; result: CheckRun | 'running' }
  | { type: 'similar-dismiss'; threadId: string; otherId: string }
  | { type: 'goal-remove'; threadId: string }
  /** A reply's bullets from Simplify, shown in its place; display only. */
  | { type: 'simplified'; threadId: string; index: number; text: string; rulesKey: string }
  | { type: 'simplify-toggle'; threadId: string; index: number }
  | { type: 'criterion-claim'; threadId: string; criterionId: string; evidence: string; by: Provider }
  | { type: 'report'; threadId: string; report: Omit<TurnReport, 'at'> }
  | { type: 'step-status'; threadId: string; stepId: string; status: StepStatus; by: Author }
  | { type: 'reorder'; pinned: string[]; unpinned: string[] }
  | { type: 'say'; threadId: string; entry: Omit<ActivityEntry, 'at'> }
  | { type: 'restore'; snapshot: Snapshot }
  | { type: 'rewind'; threadId: string; n: number; mode?: RewindMode; forkAt?: string | null }
  | { type: 'rewind-message'; threadId: string; index: number; mode?: RewindMode; forkAt?: string | null }
  | { type: 'rewind-undo' }
  | { type: 'checkpoint-ref'; threadId: string; n: number; ref: string | null }
  | { type: 'fork'; threadId: string; point: ForkPoint }
  | { type: 'fork-keep'; keepId: string; dropId: string }
  | { type: 'handoff'; threadId: string; stepId?: string; to: Provider; summary: string }
  /** A Mochi background agent for the thread (`start_background_agent`); `agentCalls` starts its session. */
  | { type: 'bg-start'; threadId: string; agent: BackgroundStart }
  /** Stops a subagent: a Mochi one ends here, a native one when its harness reports it stopped. */
  | { type: 'bg-stop'; threadId: string; subagentId: string };

/** The demo's fixture threads when shown, then your own threads from the last launch (desktop). */
export function initialThreads(saved = getRestored(), isDemo = showsDemoData()): ThreadsState {
  const demo = isDemo ? seedThreads() : [];
  let checkpointSeq = saved?.checkpointSeq ?? 0;
  const checkpoints = Object.fromEntries(
    demo.map((t) => {
      const list = seedCheckpoints(t, checkpointSeq);
      checkpointSeq += list.length;
      return [t.id, list];
    }),
  );
  return {
    now: Math.max(NOW0, saved?.now ?? 0),
    threads: [...demo, ...(saved?.threads ?? [])],
    seq: Math.max(1, saved?.seq ?? 0),
    checkpoints: { ...checkpoints, ...saved?.checkpoints },
    checkpointSeq,
    rewindUndo: null,
    forks: saved?.forks ?? {},
  };
}

export function threadsReducer(state: State, action: Action): State {
  const next = reduce(state, action);
  return next === state ? state : recordCheckpoints(state, next);
}

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'tick':
      return tick(state);
    case 'overlap':
      return resolveOverlap(state, action.queueId, action.mode);
    case 'agent':
      return stampNew(state, applyAgentEvent(state, action.event), action.event.threadId, action.ms);
    case 'agent-starting':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => (t.live ? { ...t, live: { ...t.live, starting: action.provider } } : t)) };
    case 'trigger-overlap':
      return triggerOverlap(state);
    case 'settle':
      return {
        ...state,
        // Settling stops the agent process; the next message after reactivating starts it again with `resume`.
        threads: mapThread(state.threads, action.threadId, (t) => pauseQueue({ ...t, status: 'settled', settledAt: state.now, ...(t.live && { live: { ...t.live, isWorking: false, isDetached: true, limit: undefined } }) }, 'interrupted')),
        queue: state.queue.filter((q) => q.threadId !== action.threadId),
      };
    case 'unsettle':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => ({ ...t, status: hasOpenWork(t) ? 'running' : 'review' })) };
    case 'rename':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => ({ ...t, title: action.title, isTitleRenamed: true })) };
    case 'title-generated':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => (t.isTitleRenamed ? t : { ...t, title: action.title, isTitleGenerated: true })) };
    case 'delete': {
      const gone = (id: string) => action.threadIds.includes(id);
      return {
        ...state,
        threads: state.threads.filter((t) => !gone(t.id)),
        checkpoints: Object.fromEntries(Object.entries(state.checkpoints).filter(([id]) => !gone(id))),
        forks: Object.fromEntries(Object.entries(state.forks).filter(([id]) => !gone(id))),
      };
    }
    case 'create':
      return create(state, action);
    case 'workspace':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => (t.repo ? { ...t, repo: withWorkspace(t.repo, action.workspace, branchName(getPrefs().branchPrefix, '', t.id)), live: t.live && { ...t.live, cwd: undefined } } : t)) };
    case 'send':
      return send(state, action);
    case 'queued-add':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => ({ ...t, queued: [...(t.queued ?? []), action.message] })) };
    case 'queued-remove':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => withQueue(t, (t.queued ?? []).filter((m) => m.id !== action.id))) };
    case 'queued-order':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => ({ ...t, queued: orderQueue(t.queued ?? [], action.ids) })) };
    case 'queued-resume':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => ({ ...t, queuePause: undefined })) };
    case 'source-add':
      return addSource(state, action);
    case 'controls':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => ({ ...t, controls: action.controls })) };
    case 'resume':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          t.live
            ? log(
                // The queue waits for this turn to end, then goes on.
                { ...t, status: 'running', queuePause: undefined, live: { ...t.live, isWorking: true, limit: undefined, isDetached: undefined, isOnApiKey: t.live.isOnApiKey || action.onApiKey } },
                { at: state.now, who: 'harness', kind: 'event', text: resumeText(t, action) },
              )
            : t,
        ),
      };
    case 'limit-auto-resume':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => (t.live?.limit ? { ...t, live: { ...t.live, limit: { ...t.live.limit, autoResume: action.isOn || undefined } } } : t)) };
    case 'drift-new-thread':
      return driftNewThread(state, action);
    case 'drift-verdict':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => tagSent(t, action, state.now)) };
    case 'drift-settings':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => ({ ...t, drift: { ...t.drift, isMuted: action.isMuted } })) };
    case 'drift-keep':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => keepHere(t, state.now)) };
    case 'goal-drafted':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => setDraftedGoal(t, action.outcome, action.criteria, action.similar ?? [], state.now)) };
    case 'similar-dismiss':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => ({ ...t, similar: t.similar?.filter((s) => s.threadId !== action.otherId) })) };
    case 'criterion-check':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => checkCriterion(t, action, state.now)) };
    case 'criterion-claim':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => claimCriterion(t, action, state.now)) };
    case 'report':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => ({ ...t, report: { ...action.report, at: state.now } })) };
    case 'simplified':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => mapEntry(t, action.index, (e) => ({ ...e, simplified: { text: action.text, rulesKey: action.rulesKey, isShown: true } }))) };
    case 'simplify-toggle':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => mapEntry(t, action.index, (e) => (e.simplified ? { ...e, simplified: { ...e.simplified, isShown: !e.simplified.isShown } } : e))) };
    case 'goal-remove':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => removeGoal(t, state.now)) };
    case 'edit-goal':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => applyDraft(t, action.draft, state.now, action.by)) };
    case 'step-status':
      return setStepStatus(state, action);
    case 'reorder':
      return { ...state, threads: reorderThreads(state.threads, action.pinned, action.unpinned) };
    case 'say':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => log(t, { ...action.entry, at: state.now })) };
    case 'restore':
      return { ...state, ...action.snapshot };
    case 'rewind':
      return rewind(state, action.threadId, action.n, action.mode, action.forkAt);
    case 'rewind-message':
      return rewindToMessage(state, action.threadId, action.index, action.mode, action.forkAt);
    case 'rewind-undo':
      return undoRewind(state);
    case 'checkpoint-ref':
      return {
        ...state,
        checkpoints: { ...state.checkpoints, [action.threadId]: (state.checkpoints[action.threadId] ?? []).map((c) => (c.n === action.n ? { ...c, ref: action.ref ?? undefined, wantsFiles: false } : c)) },
      };
    case 'fork':
      return forkThread(state, action.threadId, action.point);
    case 'fork-keep':
      return keepFork(state, action.keepId, action.dropId);
    case 'bg-start':
      return startBackground(state, action.threadId, action.agent);
    case 'bg-stop': {
      const thread = state.threads.find((t) => t.id === action.threadId);
      const subagent = thread?.subagents?.find((s) => s.id === action.subagentId);
      // A native agent of a live harness ends when the harness reports it stopped.
      if (!subagent || (subagent.origin === 'native' && thread?.live && !thread.live.isDetached)) return state;
      return applyAgentEvent(state, { threadId: action.threadId, type: 'subagent', id: subagent.id, phase: 'end', status: 'stopped' });
    }
    case 'handoff':
      return handoffLive(handoff(state, action.threadId, action.stepId, action.to, action.summary), action);
    default:
      return state;
  }
}

/** An emptied queue drops its pause with it. */
function withQueue(thread: Thread, queued: QueuedMessage[]): Thread {
  return { ...thread, queued, ...(queued.length === 0 && { queuePause: undefined }) };
}

function mapEntry(t: Thread, index: number, fn: (e: ActivityEntry) => ActivityEntry): Thread {
  const entry = t.activity[index];
  return entry ? { ...t, activity: t.activity.map((e, i) => (i === index ? fn(e) : e)) } : t;
}

export function mapThread(threads: Thread[], id: string, fn: (t: Thread) => Thread) {
  return threads.map((t) => (t.id === id ? fn(t) : t));
}

export function mapStep(thread: Thread, id: string, fn: (s: Step) => Step): Thread {
  return { ...thread, steps: thread.steps.map((s) => (s.id === id ? fn(s) : s)) };
}

function stampNew(before: State, after: State, threadId: string, ms?: number): State {
  if (ms === undefined || after === before) return after;
  const from = before.threads.find((t) => t.id === threadId)?.activity.length ?? 0;
  return { ...after, threads: mapThread(after.threads, threadId, (t) => (t.activity.length > from ? { ...t, activity: t.activity.map((e, i) => (i >= from && e.ms === undefined ? { ...e, ms } : e)) } : t)) };
}

export function log(thread: Thread, entry: ActivityEntry): Thread {
  return { ...thread, activity: [...thread.activity, entry] };
}

export function hasOpenWork(t: Thread) {
  return t.steps.some((s) => s.status !== 'done' && s.status !== 'dropped');
}

/** One simulated minute: the clock moves and every demo thread (no live session) reports what it did. */
function tick(state: State): State {
  let next: State = { ...state, now: state.now + 1 };
  for (const { id } of state.threads) {
    const thread = next.threads.find((t) => t.id === id);
    if (thread && !thread.session && !thread.live) next = applyAgentEvents(next, demoEvents(thread, next.now));
  }
  return next;
}

export function completeStep(threads: Thread[], threadId: string, stepId: string, now: number): Thread[] {
  const source = threads.find((t) => t.id === threadId)!;
  const step = source.steps.find((s) => s.id === stepId)!;
  let next = mapThread(threads, threadId, (t) =>
    checkAcceptance(
      log(
        mapStep(t, stepId, (s) => ({ ...s, status: 'done', progress: 1, doneAt: now })),
        { at: now, who: step.owner ?? t.providers[0], kind: 'event', text: `Finished "${step.title}"` },
      ),
      step,
      now,
    ),
  );

  for (const t of next) {
    for (const s of t.steps) {
      const link = s.link;
      if (!link || s.status === 'done' || s.status === 'dropped') continue;
      if (link.mode === 'provided-by' && link.threadId === threadId && link.stepId === stepId) {
        next = mapThread(next, t.id, (x) =>
          log(
            mapStep(x, s.id, (y) => ({ ...y, status: 'done', progress: 1, startedAt: y.startedAt ?? now, doneAt: now, note: `Brought in from "${source.title}", 2 commits cherry-picked` })),
            { at: now, who: 'harness', kind: 'event', text: `"${s.title}" arrived from "${source.title}"` },
          ),
        );
      }
      if (link.mode === 'race' && link.threadId === threadId && link.stepId === stepId) {
        next = mapThread(next, t.id, (x) =>
          log(
            mapStep(x, s.id, (y) => ({ ...y, status: 'dropped', droppedAt: now, note: `Superseded: "${source.title}" finished first` })),
            { at: now, who: 'harness', kind: 'event', text: `Race lost to "${source.title}", its version was brought in` },
          ),
        );
      }
    }
  }
  return next;
}

function triggerOverlap(state: State): State {
  const adm = state.threads.find((t) => t.id === 'adm');
  if (!adm || adm.steps.some((s) => s.title === 'Add Redis client')) return state;
  return applyAgentEvents(state, overlapEvents(adm));
}

function resolveOverlap(state: State, queueId: string, mode: OverlapMode): State {
  const item = state.queue.find((q) => q.id === queueId);
  if (!item?.overlap) return state;
  const { threadId, stepId, otherThreadId, otherStepId } = item.overlap;
  const now = state.now;
  const owner = state.threads.find((t) => t.id === otherThreadId)!;
  const ownerStep = owner.steps.find((s) => s.id === otherStepId)!;
  const asker = state.threads.find((t) => t.id === threadId)!;
  const queue = state.queue.filter((q) => q.id !== queueId);
  const key = `shared-${otherStepId}`;
  let threads = state.threads;

  if (ownerStep.status === 'done' && (mode === 'link' || mode === 'extract')) {
    threads = mapThread(threads, threadId, (t) =>
      log(mapStep(t, stepId, (s) => ({ ...s, status: 'done', progress: 1, startedAt: now, doneAt: now, sharedKey: key, note: `Brought in from "${owner.title}", 2 commits cherry-picked`, link: { mode: 'provided-by', threadId: otherThreadId, stepId: otherStepId } })), {
        at: now,
        who: 'harness',
        kind: 'event',
        text: `"${ownerStep.title}" already landed in "${owner.title}", brought it in`,
      }),
    );
    threads = mapThread(threads, otherThreadId, (t) => mapStep(t, otherStepId, (s) => ({ ...s, sharedKey: key, link: { mode: 'provides-for', threadIds: [threadId] } })));
    return { ...state, threads, queue, seq: state.seq + 1 };
  }

  if (mode === 'link') {
    threads = mapThread(threads, threadId, (t) =>
      log(mapStep(t, stepId, (s) => ({ ...s, status: 'waiting', sharedKey: key, note: `Provided by "${owner.title}"`, link: { mode: 'provided-by', threadId: otherThreadId, stepId: otherStepId } })), {
        at: now,
        who: 'harness',
        kind: 'event',
        text: `Linked: waits on "${ownerStep.title}" from "${owner.title}" and keeps working on other steps`,
      }),
    );
    threads = mapThread(threads, otherThreadId, (t) =>
      log(mapStep(t, otherStepId, (s) => ({ ...s, sharedKey: key, link: { mode: 'provides-for', threadIds: [threadId] } })), { at: now, who: 'harness', kind: 'event', text: `"${asker.title}" now depends on this step` }),
    );
  }

  if (mode === 'extract') {
    const shared: Thread = {
      id: `shared-${state.seq}`,
      spaceId: owner.spaceId,
      repo: owner.repo && { ...owner.repo, branch: 'feat/cache-redis-client' },
      title: 'Redis client (shared)',
      goal: `One Redis client both "${owner.title}" and "${asker.title}" build on.`,
      providers: ['claude'],
      status: 'running',
      line: freeLine(state.threads.filter((t) => t.spaceId === owner.spaceId)),
      startedAt: now,
      revisions: [{ n: 1, at: now, label: 'Extracted from 2 threads', by: 'harness' }],
      sources: owner.sources.filter((src) => src.kind === 'link'),
      context: { used: 12_000, max: 200_000 },
      steps: [{ ...ownerStep, id: `${ownerStep.id}-x`, addedAt: now, startedAt: now, addedBy: 'harness', revision: 1, sharedKey: key, link: { mode: 'provides-for', threadIds: [otherThreadId, threadId] }, note: undefined }],
      activity: [
        { at: now, who: 'harness', kind: 'event', text: `Extracted from "${owner.title}" and "${asker.title}". Kept ${Math.round(ownerStep.progress * 100)}% of Claude's work.` },
      ],
      prs: [],
    };
    const providedBy = { mode: 'provided-by' as const, threadId: shared.id, stepId: shared.steps[0].id };
    threads = mapThread(threads, otherThreadId, (t) => mapStep(t, otherStepId, (s) => ({ ...s, status: 'waiting', sharedKey: key, link: providedBy, note: 'Moved to "Redis client (shared)"' })));
    threads = mapThread(threads, threadId, (t) => mapStep(t, stepId, (s) => ({ ...s, status: 'waiting', sharedKey: key, link: providedBy, note: 'Provided by "Redis client (shared)"' })));
    const ownerIndex = threads.findIndex((t) => t.id === otherThreadId);
    threads = [...threads.slice(0, ownerIndex + 1), shared, ...threads.slice(ownerIndex + 1)];
  }

  if (mode === 'race') {
    threads = mapThread(threads, threadId, (t) => mapStep(t, stepId, (s) => ({ ...s, status: 'running', startedAt: now, sharedKey: key, note: `Racing "${owner.title}"`, link: { mode: 'race', threadId: otherThreadId, stepId: otherStepId } })));
    threads = mapThread(threads, otherThreadId, (t) => mapStep(t, otherStepId, (s) => ({ ...s, sharedKey: key, link: { mode: 'race', threadId, stepId } })));
  }

  if (mode === 'related') {
    threads = mapThread(threads, threadId, (t) => mapStep(t, stepId, (s) => ({ ...s, status: 'ready', note: `Related to "${owner.title}"`, link: { mode: 'related', threadId: otherThreadId, stepId: otherStepId } })));
    threads = mapThread(threads, otherThreadId, (t) => mapStep(t, otherStepId, (s) => ({ ...s, link: { mode: 'related', threadId, stepId } })));
  }

  return { ...state, threads, queue, seq: state.seq + 1 };
}

export function freeLine(threads: Thread[]): LineSlot {
  const used = new Set(threads.filter((t) => t.status !== 'settled').map((t) => t.line));
  return ([1, 2, 3, 4, 5] as const).find((l) => !used.has(l)) ?? 5;
}

function create(state: State, action: Extract<Action, { type: 'create' }>): State {
  const now = state.now;
  const id = `new-${state.seq}`;
  const dep = action.dependOn && state.threads.find((t) => t.id === action.dependOn!.threadId);
  const depStep = dep?.steps.find((s) => s.id === action.dependOn!.stepId);
  const base = (sid: string, title: string, size: 1 | 2 | 3): Step => ({ id: sid, title, size, status: 'ready', progress: 0, footprint: [], addedAt: now, addedBy: action.provider, revision: 1 });
  const isLive = !!action.isLive;
  // A live thread's own steps come from its agent's plan; the placeholders are for the demo adapter.
  const steps: Step[] = [
    ...(dep && depStep
      ? [{ ...base(`${id}-dep`, depStep.title, depStep.size), status: 'waiting' as const, sharedKey: `shared-${depStep.id}`, note: `Provided by "${dep.title}"`, link: { mode: 'provided-by' as const, threadId: dep.id, stepId: depStep.id } }]
      : []),
    ...(isLive ? [] : [base(`${id}-1`, 'Read the code involved', 1), base(`${id}-2`, 'Make the change', 2), base(`${id}-3`, 'Add tests', 1)]),
  ];
  const thread: Thread = {
    id,
    spaceId: state.spaceId,
    repo: action.project ? withWorkspace(repoFor(action.project, ''), action.workspace ?? { mode: getPrefs().workspaceMode }, branchName(getPrefs().branchPrefix, '', id)) : null,
    title: titleFrom(action.title),
    goal: '',
    providers: [action.provider],
    status: 'running',
    line: freeLine(state.threads.filter((t) => t.spaceId === state.spaceId)),
    startedAt: now,
    revisions: [],
    steps,
    activity: [
      ...(action.branchFrom ? [{ at: now, who: 'harness' as const, kind: 'event' as const, text: `Branched off ${action.branchFrom}` }] : []),
      { at: now, who: 'you', kind: 'message', text: action.title, ...(action.images?.length && { images: action.images.map((i) => i.thumb) }) },
    ],
    prs: [],
    sources: [],
    context: { used: isLive ? 0 : 4_000, max: contextMax(action.provider) },
    controls: action.controls,
  };
  if (isLive) thread.live = { isWorking: true, cwd: threadCwd(thread) ?? undefined };
  // Detached: a message before the first run starts the agent the way a restored thread does.
  if (isLive && action.schedule) {
    thread.live = { ...thread.live!, isWorking: false, isDetached: true };
    thread.activity.push({ at: now, who: 'harness', kind: 'event', text: `Scheduled: ${describeTrigger(action.schedule.when)}` });
  }
  let threads = [...state.threads, thread];
  if (dep && depStep) {
    threads = mapThread(threads, dep.id, (t) =>
      mapStep(t, depStep.id, (s) => ({ ...s, sharedKey: `shared-${depStep.id}`, link: { mode: 'provides-for', threadIds: [...(s.link?.mode === 'provides-for' ? s.link.threadIds : []), id] } })),
    );
  }
  return { ...state, threads, seq: state.seq + 1, views: action.isBackground ? state.views : { ...state.views, [state.spaceId]: { kind: 'thread', id } } };
}

/** `fallback` names the branch when the draft doesn't: a project folder thread is on whatever branch the folder is. */
function withWorkspace(repo: NonNullable<Thread['repo']>, draft: WorkspaceDraft, fallback: string): NonNullable<Thread['repo']> {
  const { project, path } = repo;
  return { project, ...(path && { path }), branch: draft.branch || fallback, ...repoWorkspace(draft) };
}

/** Done goes through `completeStep`, so links and acceptance resolve the same as when a plan finishes it. */
function setStepStatus(state: State, action: Extract<Action, { type: 'step-status' }>): State {
  const { threadId, stepId, status, by } = action;
  const now = state.now;
  const step = state.threads.find((t) => t.id === threadId)?.steps.find((s) => s.id === stepId);
  if (!step || step.status === status) return state;
  if (status === 'done') return { ...state, threads: completeStep(state.threads, threadId, stepId, now) };
  const changes: Partial<Step> = status === 'dropped' ? { droppedAt: now } : status === 'running' ? { startedAt: step.startedAt ?? now, doneAt: undefined } : { doneAt: undefined };
  return {
    ...state,
    threads: mapThread(state.threads, threadId, (t) => log(mapStep(t, stepId, (s) => ({ ...s, status, ...changes })), { at: now, who: by, kind: 'event', text: `"${step.title}" is now ${status}` })),
  };
}

// GAP: simulated. The real agent runs the command in the thread's worktree and fails the step on a non-zero exit.
function checkAcceptance(thread: Thread, step: Step, now: number) {
  if (!step.acceptance) return thread;
  const what = step.acceptance.command ? `\`${step.acceptance.command}\` passed` : `"${step.acceptance.text}" met`;
  return log(thread, { at: now, who: thread.providers[0], kind: 'event', text: `Checked "${step.title}": ${what}` });
}

function send(state: State, action: Extract<Action, { type: 'send' }>): State {
  const now = state.now;
  return {
    ...state,
    threads: mapThread(state.threads, action.threadId, (t) => {
      // The agent gets its background agents' notes with this message (`agentCalls`), so they're delivered.
      // Your message ends a Codex limit pause (and its Resume at reset); a turn Claude Code holds keeps waiting.
      const live = t.live && { ...t.live, isWorking: true, limit: t.live.limit?.isTurnHeld ? t.live.limit : undefined, isDetached: undefined, notes: undefined, restart: undefined, ...(action.interrupts && t.live.isWorking && { isReplacingTurn: true }) };
      const sent = withQueue({ ...t, queuePause: undefined }, (t.queued ?? []).filter((m) => m.id !== action.queuedId));
      const said = log(live ? { ...sent, status: 'running', live } : sent, { at: now, who: 'you', kind: 'message', text: action.text, drift: action.drift, ...(action.queuedId && { wasQueued: true }), ...(action.thumbs?.length && { images: action.thumbs }) });
      return action.drift ? applyDrift(said, action.text, action.drift, action.reason, now) : said;
    }),
  };
}

function addSource(state: State, action: Extract<Action, { type: 'source-add' }>): State {
  const thread = state.threads.find((t) => t.id === action.threadId);
  if (!thread || thread.sources.some((s) => s.label === action.source.label)) return state;
  const added = { ...state, threads: mapThread(state.threads, action.threadId, (t) => ({ ...t, sources: [...t.sources, action.source] })) };
  if (thread.live) return send(added, { type: 'send', threadId: action.threadId, text: sourcePrompt(action.source), reason: '' });
  return { ...added, threads: mapThread(added.threads, action.threadId, (t) => log(t, { at: state.now, who: 'harness', kind: 'event', text: `Added source ${action.source.label}` })) };
}

const titleFrom = (text: string) => (text.length > 48 ? `${text.slice(0, 47)}…` : text);

function setDraftedGoal(t: Thread, outcome: string, criteria: DraftedCriterion[], similar: Similar[], now: number): Thread {
  if (t.goal || t.isGoalOff) return t;
  const n = (t.revisions.at(-1)?.n ?? 0) + 1;
  const set = { ...t, goal: outcome, ...(similar.length && { similar }), criteria: criteria.map((c, i) => ({ id: `${t.id}-c${n}-${i}`, ...c })), revisions: [...t.revisions, { n, at: now, label: 'Goal drafted', by: 'harness' as const, diff: [`+ Goal: ${outcome}`, ...criteria.map((c) => `+ Done when: ${c.text}`)] }] };
  return log(set, { at: now, who: 'harness', kind: 'event', text: `Goal: ${outcome}` });
}

function checkCriterion(t: Thread, action: Extract<Action, { type: 'criterion-check' }>, now: number): Thread {
  const criterion = t.criteria?.find((c) => c.id === action.criterionId);
  if (!criterion) return t;
  const { result } = action;
  const check = result === 'running' ? { status: 'running' as const, at: now } : { status: result.exitCode === 0 ? ('passed' as const) : ('failed' as const), at: now, ms: result.ms, output: result.output };
  const checked = { ...t, criteria: t.criteria!.map((c) => (c.id === criterion.id ? { ...c, check } : c)) };
  if (check.status === 'running') return checked;
  return log(checked, { at: now, who: 'harness', kind: 'event', text: `Check ${check.status}: ${criterion.text}`, detail: `\`${criterion.command}\`` });
}

function claimCriterion(t: Thread, action: Extract<Action, { type: 'criterion-claim' }>, now: number): Thread {
  const criterion = t.criteria?.find((c) => c.id === action.criterionId);
  if (!criterion) return t;
  const criteria = t.criteria!.map((c) => (c.id === criterion.id ? { ...c, claim: { evidence: action.evidence, at: now, by: action.by } } : c));
  return log({ ...t, criteria }, { at: now, who: action.by, kind: 'event', text: `Done: ${criterion.text}`, detail: action.evidence });
}

function removeGoal(t: Thread, now: number): Thread {
  if (!t.goal) return { ...t, isGoalOff: true };
  return log({ ...t, goal: '', criteria: [], isGoalOff: true }, { at: now, who: 'harness', kind: 'event', text: 'Goal removed' });
}

function keepHere(t: Thread, now: number): Thread {
  const keeps = (t.drift?.keeps ?? 0) + 1;
  const isMuted = keeps >= KEEPS_TO_MUTE;
  const kept = { ...t, drift: { ...t.drift, isMuted: !!t.drift?.isMuted || isMuted, keeps } };
  return isMuted && !t.drift?.isMuted ? log(kept, { at: now, who: 'harness', kind: 'event', text: 'Drift guard off for this thread', detail: `You kept ${keeps} suggestions here` }) : kept;
}

/** A late verdict for a message sent while the classifier was out: the newest untagged message with that text. */
function tagSent(t: Thread, action: Extract<Action, { type: 'drift-verdict' }>, now: number): Thread {
  const i = t.activity.findLastIndex((e) => e.who === 'you' && e.kind === 'message' && !e.drift && e.text === action.text);
  if (i < 0) return t;
  const activity = t.activity.map((e, j) => (j === i ? { ...e, drift: action.drift } : e));
  return applyDrift({ ...t, activity }, action.text, action.drift, action.reason, now);
}

function applyDrift(t: Thread, text: string, drift: DriftKind, reason: string, now: number): Thread {
  if (drift === 'off-goal') return log(t, { at: now, who: 'harness', kind: 'event', text: 'Sent off-goal · not counted', detail: reason });
  if (drift === 'on-goal') return t;
  const title = stepTitleFrom(text);
  const added: Step = { id: `${t.id}-d${t.steps.length}`, title, size: 1, status: 'ready', progress: 0, footprint: [], addedAt: now, addedBy: 'you', revision: t.revisions.at(-1)?.n ?? 1 };
  return log({ ...t, steps: [...t.steps, added] }, { at: now, who: 'harness', kind: 'event', text: `Plan: +1 step "${title}"`, detail: reason });
}

/** Off-goal prompt to a new thread. A finished goal is settled first: its review stays queued while a PR is open, otherwise it resolves. */
function driftNewThread(state: State, action: Extract<Action, { type: 'drift-new-thread' }>): State {
  const source = state.threads.find((t) => t.id === action.threadId);
  if (!source) return state;
  const now = state.now;
  const isGoalDone = goalProgress(source, now).phase === 'ready';
  const hasOpenPr = source.prs.some((p) => p.state === 'open');
  const short = action.prompt.length > 40 ? `${action.prompt.slice(0, 39)}…` : action.prompt;
  let next: State = state;
  if (isGoalDone) {
    const outcome = hasOpenPr ? 'its PR review stays in your queue' : 'review resolved';
    next = {
      ...next,
      threads: mapThread(next.threads, source.id, (t) => log({ ...t, status: 'settled', settledAt: now }, { at: now, who: 'harness', kind: 'event', text: `Goal done, settled to start a new thread; ${outcome}` })),
      queue: next.queue.filter((q) => q.threadId !== source.id || (hasOpenPr && q.kind === 'review')),
    };
  }
  next = { ...next, threads: mapThread(next.threads, source.id, (t) => log(t, { at: now, who: 'harness', kind: 'event', text: 'Moved to a new thread', detail: `"${short}"` })) };
  const branchFrom = action.branchFrom === 'current' ? source.repo?.branch : 'the base branch';
  // Branching off the current branch is a new worktree from it; off the base, the default.
  const workspace: WorkspaceDraft | undefined = source.repo && action.branchFrom === 'current' ? { mode: 'worktree', base: source.repo.branch } : undefined;
  return create(next, { type: 'create', title: action.prompt, provider: source.providers[0], project: projectRef(source.repo), branchFrom: source.repo ? branchFrom : undefined, controls: source.controls, isLive: !!source.live, workspace });
}

/** A whole-thread handoff of a live thread restarts it on the other provider: the old session and its limit don't carry over. */
function handoffLive(state: State, action: Extract<Action, { type: 'handoff' }>): State {
  return {
    ...state,
    threads: mapThread(state.threads, action.threadId, (t) =>
      t.live && !action.stepId ? { ...t, status: 'running', session: undefined, controls: undefined, live: { ...t.live, isWorking: true, limit: undefined, isOnApiKey: undefined, isDetached: undefined } } : t,
    ),
  };
}

function resumeText(thread: Thread, action: Extract<ThreadsAction, { type: 'resume' }>) {
  if (action.onApiKey) return 'Continuing on your API key, billed per use';
  const window = thread.live?.limit?.label;
  if (action.atReset) return `Resumed after the ${window ? `${window.toLowerCase()} ` : ''}limit reset`;
  return 'Resumed on the same account';
}
