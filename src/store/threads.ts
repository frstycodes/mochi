import type { AgentImage, SeqAgentEvent } from '../host/types/agent.ts';
import type { CheckRun, Head } from '../host/types/git.ts';
import type { DraftedCriterion } from '../utility/prompts.ts';
import { NOW0, seedThreads, type ActivityEntry, type Author, type IdleCheck, type LineSlot, type Provider, type PullRequest, type QueuedMessage, type SentImage, type Similar, type Source, type Step, type SubThreadLink, type Thread, type ThreadRef, type TurnReport } from '../model.ts';
import { markSent } from '../chat/threadMessages.ts';
import { orderQueue, pauseQueue } from '../chat/outbox.ts';
import { compactionEntry } from '../chat/compact.ts';
import { shownImage } from '../chat/images.ts';
import { sourcePrompt } from '../sources.ts';
import { KEEPS_TO_MUTE, type DriftKind } from '../drift.ts';
import { applyDraft, draftFrom, type GoalDraft } from '../goals/edit.ts';
import { goalProgress } from '../progress.ts';
import { nestBlocker, pinAt, reorderThreads, subThreadsOf } from '../reorder.ts';
import { applyAgentEvent, applyAgentEvents } from '../runtime/apply.ts';
import { demoEvents } from '../runtime/demo.ts';
import { startBackground, type BackgroundStart } from '../runtime/subagents.ts';
import { recordCheckpoints, rewind, rewindToMessage, seedCheckpoints, turnUndo, undoRewind, type Checkpoint, type RewindMode, type RewindUndo } from '../rewind/checkpoints.ts';
import { forkThread, keepFork, type Fork, type ForkPoint } from '../rewind/fork.ts';
import type { ThreadControls } from '../runtime/controls.ts';
import { contextMax } from '../runtime/models.ts';
import { handoff } from '../rewind/handoff.ts';
import { getPrefs } from '../settings/prefs.ts';
import { threadCwd } from '../host/cwd.ts';
import { projectRef, repoFor } from '../projects.ts';
import { recordPrs } from '../git/prs.ts';
import { repoWorkspace, tempBranch, withHead, type WorkspaceDraft } from '../git/workspace.ts';
import type { Action, Snapshot, State } from './index.tsx';
import { getRestored } from './persist.ts';
import { markSeen, type SeenAction } from './seen.ts';
import { showsDemoData } from '../demoData.ts';
import type { TriggerDraft } from '../schedule/calls.ts';
import { describeTrigger } from '../schedule/describe.ts';

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
  | SeenAction
  /** `ms`: wall-clock arrival, stamped on the entries the event logs so a live turn can say how long it took to the second. */
  | { type: 'agent'; event: SeqAgentEvent; ms?: number }
  | { type: 'agent-starting'; threadId: string; provider: Provider }
  | { type: 'settle'; threadId: string }
  | { type: 'unsettle'; threadId: string }
  | { type: 'rename'; threadId: string; title: string }
  /** A model's name for the thread; dropped when you renamed it meanwhile. */
  | { type: 'title-generated'; threadId: string; title: string }
  /** For good: every slice drops what it keeps for these threads; `agentCalls` stops their agents. */
  | { type: 'delete'; threadIds: string[] }
  | { type: 'create'; title: string; provider: Provider; /** A project ref (`src/projects.ts`); null for a folderless chat. */ project: string | null; branchFrom?: string; controls?: ThreadControls; isLive?: boolean; /** Opened by an agent: you stay on the view you're on. */ isBackground?: boolean; /** Waits for its first scheduled run instead of starting now. */ schedule?: TriggerDraft; /** Unset: a new worktree from the default branch, or a project folder when that's your Settings default. */ workspace?: WorkspaceDraft; /** What the agent starts on when it isn't the title as typed (`withReferences`). */ prompt?: string; skills?: string[]; /** Sent with the first prompt. */ images?: SentImage[]; /** Screenshots of `@` windows: sent with the first prompt, not shown in the transcript. */ referenceImages?: AgentImage[]; /** Started as a sub-thread of another thread. */ parent?: SubThreadLink }
  /** Make `threadId` a sub-thread of `parentId` (a drag, the Similar row, the row menu); it leaves Pinned, sub-threads aren't pinned. */
  | { type: 'nest'; threadId: string; parentId: string; criterionId?: string }
  | { type: 'unnest'; threadId: string }
  /** A sub-thread's result goes back to its parent: a row in the parent's chat, and the criterion it covers claimed with `evidence`. */
  | { type: 'subthread-handback'; threadId: string; evidence: string }
  /** What the thread's checkout really has (`useWorktreeRecovery`); `worktree`: its own worktree, found on disk. */
  | { type: 'repo-head'; threadId: string; head: Head; worktree?: string }
  /** Before a thread's folder is set up (`isUnstarted`): a different workspace for it. */
  | { type: 'workspace'; threadId: string; workspace: WorkspaceDraft }
  | { type: 'controls'; threadId: string; controls: ThreadControls }
  | { type: 'interrupt'; threadId: string }
  /** After a usage limit: on the same account, or (`onApiKey`) on the stored API key from now on. `atReset`: the reset came and you had chosen Resume at reset. */
  | { type: 'resume'; threadId: string; onApiKey?: boolean; atReset?: boolean }
  | { type: 'limit-auto-resume'; threadId: string; isOn: boolean }
  /**
   * `prompt` and `images` are what the agent gets when they differ from the transcript's `text` (composer references). No `drift` while the classifier is still out; `drift-verdict` tags the message once it answers.
   * `queuedId`: the queued message this sends, which leaves the queue. `steers`: joins the turn in flight instead of waiting for it to end (the queue's Send now).
   */
  | { type: 'send'; threadId: string; text: string; drift?: DriftKind; reason: string; prompt?: string; images?: AgentImage[]; /** The images you attached, as the transcript shows them. */ shownImages?: string[]; skills?: string[]; queuedId?: string; steers?: boolean; /** Sent by another thread's agent (`send_to_thread`); `prompt` then names it for the agent. */ from?: ThreadRef }
  /** `/compact`: the harness compacts the live session now. `queuedId`: it waited in the queue as typed. */
  | { type: 'compact'; threadId: string; focus: string; queuedId?: string }
  | { type: 'queued-add'; threadId: string; message: QueuedMessage }
  /** Edit and remove both take a message out; Edit puts its text back in the composer itself. */
  | { type: 'queued-remove'; threadId: string; id: string }
  | { type: 'queued-order'; threadId: string; ids: string[] }
  | { type: 'queued-resume'; threadId: string }
  /** A link or file you added in the summary; a live agent is told in a message of yours. */
  | { type: 'source-add'; threadId: string; source: Source }
  /** PRs Mochi learned of for the thread (gh's read of its branch, a PR it opened): added, or updated by number. */
  | { type: 'prs-seen'; threadId: string; prs: PullRequest[] }
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
  /** The agent went idle: a fresh record replaces the last turn's, accepted gaps and Open anyway included. */
  /** The agent's `propose_goal`; `isApplied` when Settings › Goals and checks applies proposals with an undo instead of asking. */
  | { type: 'goal-propose'; threadId: string; goal: string; criteria: { text: string; command?: string }[]; basis?: string; by: Provider; isApplied: boolean }
  | { type: 'goal-proposal'; threadId: string; decision: 'accept' | 'keep' | 'undo' }
  | { type: 'idle-start'; threadId: string }
  | { type: 'idle-update'; threadId: string; patch: Partial<Omit<IdleCheck, 'at'>> }
  /** You answered the turn's next-move card, or wrote instead: it's kept in the chat as a record and the card goes. */
  | { type: 'next-move-record'; threadId: string; record: NonNullable<ActivityEntry['nextMove']> }
  /** `at`: epoch ms, the order key a new pin at the end takes (`reorderThreads`). */
  | { type: 'reorder'; pinned: string[]; unpinned: string[]; at: number }
  /** Pins or moves a pin to order key `order` among all your computers' pins (`pinAt`). */
  | { type: 'pin-at'; threadId: string; order: number }
  | { type: 'say'; threadId: string; entry: Omit<ActivityEntry, 'at'> }
  | { type: 'restore'; snapshot: Snapshot }
  | { type: 'rewind'; threadId: string; n: number; mode?: RewindMode; forkAt?: string | null }
  | { type: 'rewind-message'; threadId: string; index: number; mode?: RewindMode; forkAt?: string | null }
  | { type: 'rewind-undo' }
  | { type: 'turn-undo'; threadId: string; start: number; isUndone: boolean; text: string }
  | { type: 'checkpoint-ref'; threadId: string; n: number; ref: string | null }
  | { type: 'fork'; threadId: string; point: ForkPoint }
  | { type: 'fork-keep'; keepId: string; dropId: string }
  | { type: 'handoff'; threadId: string; to: Provider; summary: string }
  /** A Mochi background agent for the thread (`start_background_agent`); `agentCalls` starts its session. */
  | { type: 'bg-start'; threadId: string; agent: BackgroundStart }
  /** Stops a subagent: a Mochi one ends here, a native one when its harness reports it stopped. */
  | { type: 'bg-stop'; threadId: string; subagentId: string };

/** The demo's fixture threads when shown, then your own threads from the last launch (desktop). */
export function initialThreads(saved = getRestored(), isDemo = showsDemoData()): ThreadsState {
  // Demo threads start read, as a restored save does.
  const demo = isDemo ? seedThreads().map((t) => ({ ...t, seenActivity: t.activity.length })) : [];
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
    case 'seen':
      return markSeen(state, action);
    case 'agent':
      return stampNew(state, withEventSeq(applyAgentEvent(state, action.event), action.event), action.event.threadId, action.ms);
    case 'agent-starting':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => (t.live ? { ...t, live: { ...t.live, starting: action.provider } } : t)) };
    case 'settle': {
      // A parent settles with its open sub-threads: they were parts of its goal.
      const ids = new Set([action.threadId, ...subThreadsOf(state.threads, action.threadId).filter((t) => t.status !== 'settled').map((t) => t.id)]);
      return {
        ...state,
        // Settling stops the agent process; the next message after reactivating starts it again with `resume`.
        threads: state.threads.map((t) => (ids.has(t.id) ? pauseQueue({ ...t, status: 'settled', settledAt: state.now, ...(t.live && { live: { ...t.live, isWorking: false, isDetached: true, limit: undefined } }) }, 'interrupted') : t)),
        queue: state.queue.filter((q) => !ids.has(q.threadId)),
      };
    }
    case 'nest':
      if (nestBlocker(state.threads, action.threadId, action.parentId)) return state;
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => ({ ...t, parent: { threadId: action.parentId, ...(action.criterionId && { criterionId: action.criterionId }) }, orbitSlot: undefined })) };
    case 'unnest':
      return { ...state, threads: mapThread(state.threads, action.threadId, ({ parent: _, ...t }) => t) };
    case 'subthread-handback':
      return handBack(state, action);
    case 'unsettle':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => ({ ...t, status: 'running' })) };
    case 'rename':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => ({ ...t, title: action.title, isTitleRenamed: true })) };
    case 'title-generated':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => withGeneratedTitle(t, action.title)) };
    case 'delete': {
      const gone = (id: string) => action.threadIds.includes(id);
      return {
        ...state,
        // A deleted parent's sub-threads become threads of their own.
        threads: state.threads.filter((t) => !gone(t.id)).map((t) => (t.parent && gone(t.parent.threadId) ? (({ parent: _, ...rest }) => rest)(t) : t)),
        checkpoints: Object.fromEntries(Object.entries(state.checkpoints).filter(([id]) => !gone(id))),
        forks: Object.fromEntries(Object.entries(state.forks).filter(([id]) => !gone(id))),
      };
    }
    case 'create':
      return create(state, action);
    case 'repo-head': {
      const { head, worktree } = action;
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => (t.repo ? { ...t, repo: withHead(t.repo, head, !!worktree), live: worktree && t.live ? { ...t.live, cwd: worktree } : t.live } : t)) };
    }
    case 'workspace':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => (t.repo ? { ...t, repo: withWorkspace(t.repo, action.workspace, threadTempBranch(t.spaceId, t.id, t.startedAt)), live: t.live && { ...t.live, cwd: undefined } } : t)) };
    case 'send':
      return send(state, action);
    case 'compact':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) => {
          if (!t.live) return t;
          const left = withQueue(t, (t.queued ?? []).filter((m) => m.id !== action.queuedId));
          return log({ ...left, status: 'running', live: { ...t.live, isWorking: true } }, compactionEntry(t, state.now, 'manual', action.focus));
        }),
      };
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
    case 'prs-seen':
      return seePrs(state, action.threadId, action.prs);
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
    case 'goal-propose':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => propose(t, action, state.now)) };
    case 'goal-proposal':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => decideProposal(t, action.decision, state.now)) };
    case 'idle-start':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => ({ ...t, idle: { at: state.now, accepted: [], isGathering: true } })) };
    case 'next-move-record':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => log({ ...t, idle: { ...(t.idle ?? { at: state.now, accepted: [] }), isMoveAnswered: true } }, { at: state.now, who: 'harness', kind: 'event', text: action.record.question, nextMove: action.record })) };
    case 'idle-update':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => (t.idle ? { ...t, idle: { ...t.idle, ...action.patch } } : t)) };
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
    case 'reorder':
      return { ...state, threads: reorderThreads(state.threads, action.pinned, action.unpinned, action.at) };
    case 'pin-at': {
      const thread = state.threads.find((t) => t.id === action.threadId);
      return { ...state, threads: (thread && pinAt(state.threads, thread.spaceId, thread.id, action.order)) ?? state.threads };
    }
    case 'say':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => log(t, { ...action.entry, at: state.now })) };
    case 'restore':
      return { ...state, ...action.snapshot };
    case 'rewind':
      return rewind(state, action.threadId, action.n, action.mode, action.forkAt);
    case 'rewind-message':
      return rewindToMessage(state, action.threadId, action.index, action.mode, action.forkAt);
    case 'turn-undo':
      return turnUndo(state, action.threadId, { start: action.start, isUndone: action.isUndone }, action.text);
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
      return handoffLive(handoff(state, action.threadId, action.to, action.summary), action);
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

/** Unchanged state when every PR is already recorded as it is, so a periodic gh read doesn't re-save. */
export function seePrs<S extends { threads: Thread[] }>(state: S, threadId: string, prs: PullRequest[]): S {
  const thread = state.threads.find((t) => t.id === threadId);
  const next = thread && recordPrs(thread.prs, prs);
  if (!thread || next === thread.prs) return state;
  return { ...state, threads: mapThread(state.threads, threadId, (t) => ({ ...t, prs: next! })) };
}

export function mapThread(threads: Thread[], id: string, fn: (t: Thread) => Thread) {
  return threads.map((t) => (t.id === id ? fn(t) : t));
}

export function mapStep(thread: Thread, id: string, fn: (s: Step) => Step): Thread {
  return { ...thread, steps: thread.steps.map((s) => (s.id === id ? fn(s) : s)) };
}

function withEventSeq(state: State, event: SeqAgentEvent): State {
  if (event.seq === undefined) return state;
  return { ...state, threads: mapThread(state.threads, event.threadId, (t) => (t.live ? { ...t, live: { ...t.live, eventSeq: event.seq } } : t)) };
}

function stampNew(before: State, after: State, threadId: string, ms?: number): State {
  if (ms === undefined || after === before) return after;
  const from = before.threads.find((t) => t.id === threadId)?.activity.length ?? 0;
  return { ...after, threads: mapThread(after.threads, threadId, (t) => (t.activity.length > from ? { ...t, activity: t.activity.map((e, i) => (i >= from && e.ms === undefined ? { ...e, ms } : e)) } : t)) };
}

export function log(thread: Thread, entry: ActivityEntry): Thread {
  return { ...thread, activity: [...thread.activity, entry] };
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

/** A plan item the agent finished, logged as it does it. */
export function completeStep(threads: Thread[], threadId: string, stepId: string, now: number): Thread[] {
  return mapThread(threads, threadId, (t) => {
    const step = t.steps.find((s) => s.id === stepId);
    return step ? log(mapStep(t, stepId, (s) => ({ ...s, status: 'done', doneAt: now })), { at: now, who: t.providers[0], kind: 'event', text: `Finished "${step.title}"` }) : t;
  });
}

export function freeLine(threads: Thread[]): LineSlot {
  const used = new Set(threads.filter((t) => t.status !== 'settled').map((t) => t.line));
  return ([1, 2, 3, 4, 5] as const).find((l) => !used.has(l)) ?? 5;
}

function create(state: State, action: Extract<Action, { type: 'create' }>): State {
  const now = state.now;
  const id = `new-${state.seq}`;
  const base = (sid: string, title: string): Step => ({ id: sid, title, status: 'ready', addedAt: now, addedBy: action.provider });
  const isLive = !!action.isLive;
  // A live thread's own steps come from its agent's plan; the placeholders are for the demo adapter.
  const steps = isLive ? [] : [base(`${id}-1`, 'Read the code involved'), base(`${id}-2`, 'Make the change'), base(`${id}-3`, 'Add tests')];
  const thread: Thread = {
    id,
    spaceId: state.spaceId,
    repo: action.project ? withWorkspace(repoFor(action.project, ''), action.workspace ?? { mode: getPrefs().workspaceMode }, threadTempBranch(state.spaceId, id, now)) : null,
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
      { at: now, who: 'you', kind: 'message', text: action.title, ...(action.images?.length && { images: action.images.map(shownImage) }) },
    ],
    prs: [],
    sources: [],
    context: { used: isLive ? 0 : 4_000, max: contextMax(action.provider) },
    controls: action.controls,
    ...(action.parent && { parent: action.parent }),
  };
  if (isLive) thread.live = { isWorking: true, cwd: threadCwd(thread) ?? undefined };
  // Detached: a message before the first run starts the agent the way a restored thread does.
  if (isLive && action.schedule) {
    thread.live = { ...thread.live!, isWorking: false, isDetached: true };
    thread.activity.push({ at: now, who: 'harness', kind: 'event', text: `Scheduled: ${describeTrigger(action.schedule.when)}` });
  }
  const threads = [...state.threads, thread];
  return { ...state, threads, seq: state.seq + 1, views: action.isBackground ? state.views : { ...state.views, [state.spaceId]: { kind: 'thread', id } } };
}

/** The temp branch `create` gives the next thread, which the composer shows before you send. */
export const nextTempBranch = (state: Pick<State, 'spaceId' | 'seq' | 'now'>) => threadTempBranch(state.spaceId, `new-${state.seq}`, state.now);

const threadTempBranch = (spaceId: string, threadId: string, at: number) => tempBranch(getPrefs().branchPrefix, `${spaceId}/${threadId}/${at}`);

/** `fallback` names the branch when the draft doesn't: a project folder thread is on whatever branch the folder is. */
function withWorkspace(repo: NonNullable<Thread['repo']>, draft: WorkspaceDraft, fallback: string): NonNullable<Thread['repo']> {
  const { project, path } = repo;
  return { project, ...(path && { path }), branch: draft.branch || fallback, ...repoWorkspace(draft), ...(draft.mode === 'worktree' && !draft.isExisting && (draft.autoBranch || !draft.branch) && { autoBranch: draft.autoBranch || fallback }) };
}

function send(state: State, action: Extract<Action, { type: 'send' }>): State {
  const now = state.now;
  const { from } = action;
  const threads = from?.threadId ? mapThread(state.threads, from.threadId, (t) => markSent(t, { threadId: action.threadId, title: state.threads.find((r) => r.id === action.threadId)?.title ?? '', text: action.text })) : state.threads;
  return {
    ...state,
    threads: mapThread(threads, action.threadId, (t) => {
      // The agent gets its background agents' notes with this message (`agentCalls`), so they're delivered.
      // Your message ends a Codex limit pause (and its Resume at reset); a turn Claude Code holds keeps waiting.
      const live = t.live && { ...t.live, isWorking: true, limit: t.live.limit?.isTurnHeld ? t.live.limit : undefined, isDetached: undefined, notes: undefined, restart: undefined };
      const sent = withQueue({ ...t, queuePause: undefined }, (t.queued ?? []).filter((m) => m.id !== action.queuedId));
      const said = log(live ? { ...sent, status: 'running', live } : sent, { at: now, who: 'you', kind: 'message', text: action.text, drift: action.drift, ...(action.queuedId && { wasQueued: true }), ...(action.shownImages?.length && { images: action.shownImages }), ...(from && { from }) });
      return action.drift ? applyDrift(said, action.drift, action.reason, now) : said;
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

/** A title a model generated, unless you named the thread yourself. */
export const withGeneratedTitle = (t: Thread, title: string): Thread => (t.isTitleRenamed ? t : { ...t, title, isTitleGenerated: true });

const titleFrom = (text: string) => (text.length > 48 ? `${text.slice(0, 47)}…` : text);

function setDraftedGoal(t: Thread, outcome: string, criteria: DraftedCriterion[], similar: Similar[], now: number): Thread {
  if (t.goal || t.isGoalOff) return t;
  const n = (t.revisions.at(-1)?.n ?? 0) + 1;
  const set = { ...t, goal: outcome, ...(similar.length && { similar }), criteria: criteria.map((c, i) => ({ id: `${t.id}-c${n}-${i}`, ...c })), revisions: [...t.revisions, { n, at: now, label: 'Goal drafted', by: 'harness' as const, diff: [`+ Goal: ${outcome}`, ...criteria.map((c) => `+ Done when: ${c.text}`)] }] };
  return log(set, { at: now, who: 'harness', kind: 'event', text: `Goal: ${outcome}` });
}

function propose(t: Thread, action: Extract<Action, { type: 'goal-propose' }>, now: number): Thread {
  const before = { goal: t.goal, criteria: (t.criteria ?? []).map(({ text, command }) => ({ text, command })) };
  const proposal = { goal: action.goal, criteria: action.criteria, basis: action.basis, at: now, by: action.by, state: 'waiting' as const, before };
  if (!action.isApplied) return log({ ...t, proposal }, { at: now, who: action.by, kind: 'event', text: `Proposed a goal: ${action.goal}`, detail: action.basis });
  return { ...withGoal(t, proposal, now, action.by), proposal: { ...proposal, state: 'applied' } };
}

/** Accept puts the proposal in place, Keep leaves the draft, Undo puts back what an applied proposal replaced. */
function decideProposal(t: Thread, decision: 'accept' | 'keep' | 'undo', now: number): Thread {
  const p = t.proposal;
  if (!p) return t;
  if (decision === 'keep') return log({ ...t, proposal: { ...p, state: 'kept' } }, { at: now, who: 'you', kind: 'event', text: `Kept the draft goal: ${t.goal}` });
  if (decision === 'undo') return { ...withGoal(t, p.before, now, 'you'), proposal: { ...p, state: 'undone' } };
  return { ...withGoal(t, p, now, 'you'), proposal: { ...p, state: 'accepted' } };
}

function withGoal(t: Thread, goal: { goal: string; criteria: { text: string; command?: string }[] }, now: number, by: Author): Thread {
  return applyDraft(t, { ...draftFrom(t), goal: goal.goal, criteria: goal.criteria }, now, by);
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

function handBack(state: State, action: Extract<Action, { type: 'subthread-handback' }>): State {
  const sub = state.threads.find((t) => t.id === action.threadId);
  if (!sub?.parent || sub.parent.handedBackAt !== undefined) return state;
  const { threadId: parentId, criterionId } = sub.parent;
  const by = sub.providers[0];
  const now = state.now;
  const threads = state.threads.map((t) => {
    if (t.id === sub.id) return { ...t, parent: { ...sub.parent!, handedBackAt: now } };
    if (t.id !== parentId) return t;
    const claimed = criterionId ? claimCriterion(t, { type: 'criterion-claim', threadId: t.id, criterionId, evidence: action.evidence, by }, now) : t;
    return log(claimed, { at: now, who: 'harness', kind: 'event', text: `${sub.title} handed back`, subThread: { threadId: sub.id, title: sub.title, text: action.evidence } });
  });
  return { ...state, threads };
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
  return applyDrift({ ...t, activity }, action.drift, action.reason, now);
}

function applyDrift(t: Thread, drift: DriftKind, reason: string, now: number): Thread {
  return drift === 'off-goal' ? log(t, { at: now, who: 'harness', kind: 'event', text: 'Sent off-goal · not counted', detail: reason }) : t;
}

/** Off-goal prompt to a new thread. A finished goal is settled first: its review stays queued while a PR is open, otherwise it resolves. */
function driftNewThread(state: State, action: Extract<Action, { type: 'drift-new-thread' }>): State {
  const source = state.threads.find((t) => t.id === action.threadId);
  if (!source) return state;
  const now = state.now;
  const isGoalDone = goalProgress(source).phase === 'ready';
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

/** A handoff of a live thread restarts it on the other provider: the old session and its limit don't carry over. */
function handoffLive(state: State, action: Extract<Action, { type: 'handoff' }>): State {
  return {
    ...state,
    threads: mapThread(state.threads, action.threadId, (t) =>
      t.live ? { ...t, status: 'running', session: undefined, controls: undefined, live: { ...t.live, isWorking: true, limit: undefined, isOnApiKey: undefined, isDetached: undefined } } : t,
    ),
  };
}

function resumeText(thread: Thread, action: Extract<ThreadsAction, { type: 'resume' }>) {
  if (action.onApiKey) return 'Continuing on your API key, billed per use';
  const window = thread.live?.limit?.label;
  if (action.atReset) return `Resumed after the ${window ? `${window.toLowerCase()} ` : ''}limit reset`;
  return 'Resumed on the same account';
}
