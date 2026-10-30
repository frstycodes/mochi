import type { AgentImage, SeqAgentEvent } from '../host/types/agent.ts';
import type { CheckRun, Head } from '../host/types/git.ts';
import type { DraftedCriterion } from '../utility/prompts.ts';
import {
  NOW0,
  seedThreads,
  type ActivityEntry,
  type Assumption,
  type Author,
  type Handoff,
  type IdleCheck,
  type LineSlot,
  type OrchestrationGrant,
  type ParentReport,
  type PendingSteer,
  type Pivot,
  type Provider,
  type PullRequest,
  type QueuedMessage,
  type SentImage,
  type Similar,
  type Source,
  type Step,
  type SubThreadLink,
  type Thread,
  type ThreadProposal,
  type ThreadRef,
  type TurnReport,
} from '../model.ts';
import { changedBySend, withAssumptions } from '../goals/ledger.ts';
import {
  addProposal,
  findProposal,
  proposalBlocker,
  updateProposal,
} from '../chat/proposals.ts';
import { allowGrant, findGrant, updateGrant } from '../chat/grants.ts';
import { markSent } from '../chat/threadMessages.ts';
import { interruptsToSend, orderQueue, pauseQueue } from '../chat/queued.ts';
import { compactionEntry } from '../chat/compaction.ts';
import { shownImage } from '../chat/images.ts';
import { sourcePrompt } from '../sources.ts';
import { hasGoal, KEEPS_TO_MUTE, type DriftKind } from '../drift.ts';
import { applyDraft, draftFrom, type GoalDraft } from '../goals/edit.ts';
import { goalProgress } from '../progress.ts';
import { nestBlocker, openSubtree, pinAt, reorderThreads } from '../reorder.ts';
import { applyAgentEvent, applyAgentEvents } from '../runtime/apply.ts';
import { demoEvents } from '../runtime/demo.ts';
import {
  stallBackground,
  startBackground,
  type BackgroundStart,
} from '../runtime/subagents.ts';
import { markReportsDelivered, undeliveredPositions } from '../runtime/due.ts';
import {
  isAutofixTurn,
  reportPrsEnded,
  reportStalls,
  reportTyped,
} from '../runtime/subThreadReports.ts';
import {
  recordCheckpoints,
  rewind,
  rewindToMessage,
  seedCheckpoints,
  turnUndo,
  undoRewind,
  type Checkpoint,
  type RewindMode,
  type RewindUndo,
} from '../rewind/checkpoints.ts';
import {
  forkThread,
  keepFork,
  type Fork,
  type ForkPoint,
} from '../rewind/fork.ts';
import type { ThreadControls } from '../runtime/controls.ts';
import { contextMax } from '../runtime/models.ts';
import {
  failDrafts,
  handoff,
  handoffBlocker,
  handoffDraft,
  handoffFail,
} from '../rewind/handoff.ts';
import {
  DEFAULT_CONTEXT,
  prefsNow,
  type ProjectionContext,
} from './context.ts';
import { leftSession, switchProvider } from '../rewind/switch.ts';
import { threadRoot } from '../git/root.ts';
import { projectRef, repoFor } from '../projectRef.ts';
import { autofixTitle } from '../git/autofix.ts';
import { canAutofix } from '../git/autofixToggle.ts';
import { recordPrs } from '../git/prs.ts';
import {
  repoWorkspace,
  tempBranch,
  withHead,
  type WorkspaceDraft,
} from '../git/workspace.ts';
import type { Action, Snapshot, State } from './types.ts';
import type { RemoteSideChat } from './remoteSideChat.ts';
import type { Saved } from './saved.ts';
import { markSeen, type SeenAction } from './seen.ts';
import type { TriggerDraft } from '../schedule/calls.ts';
import { describeTrigger } from '../schedule/describe.ts';
import { markSettled } from '../settled/settled.ts';

export interface ThreadsState {
  now: number;
  threads: Thread[];
  seq: number;
  checkpoints: Record<string, Checkpoint[]>;
  checkpointSeq: number;
  rewindUndo: RewindUndo | null;
  /** Fork thread id → where it was forked from. */
  forks: Record<string, Fork>;
  /** Side chats other computers ask on threads here (`remoteSideChat.ts`, its own domain slice). */
  remoteSideChats: Record<string, RemoteSideChat>;
  /** Your prefs and pins as the folds read them (`src/store/context.ts`). */
  context: ProjectionContext;
}

export type ThreadsAction =
  | { type: 'tick' }
  /** A window's prefs and pins, sent when they differ from the state's, so Core folds with them too. */
  | { type: 'context'; context: ProjectionContext }
  /** The main window loaded (again); `threadIds` are the threads whose Mochi tool calls it asks anew (`pendingToolCalls`). */
  | { type: 'window-loaded'; threadIds: string[] }
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
  | {
      type: 'create';
      /** The profile it opens in; dispatch fills in yours (`withDispatchContext`). */ spaceId?: string;
      title: string;
      /** The thread's title when given, in place of one cut from `title`: no model renames it. */ name?: string;
      provider: Provider;
      /** A project ref (`src/projects.ts`); null for a folderless chat. */ project:
        | string
        | null;
      branchFrom?: string;
      controls?: ThreadControls;
      isLive?: boolean;
      /** Opened by an agent: you stay on the view you're on. */ isBackground?: boolean;
      /** Waits for its first scheduled run instead of starting now. */ schedule?: TriggerDraft;
      /** Unset: a new worktree from the default branch, or a project folder when that's your Settings default. */ workspace?: WorkspaceDraft;
      /** What the agent starts on when it isn't the title as typed (`withReferences`). */ prompt?: string;
      skills?: string[];
      /** Sent with the first prompt. */ images?: SentImage[];
      /** Screenshots of `@` windows: sent with the first prompt, not shown in the transcript. */ referenceImages?: AgentImage[];
      /** Started as a sub-thread of another thread. */ parent?: SubThreadLink;
      /** The profile's settings chat (Settings › Ask Mochi). */ isSettingsChat?: true;
    }
  /** Make `threadId` a sub-thread of `parentId` (a drag, the Similar row, the row menu); it leaves Pinned, sub-threads aren't pinned. */
  | { type: 'nest'; threadId: string; parentId: string; criterionId?: string }
  | { type: 'unnest'; threadId: string }
  /** A sub-thread's result goes back to its parent: a row in the parent's chat, and the criterion it covers claimed with `evidence`. */
  | { type: 'subthread-handback'; threadId: string; evidence: string }
  /** What the thread's checkout really has (`useWorktreeRecovery`); `worktree`: its own worktree, found on disk. */
  | { type: 'repo-head'; threadId: string; head: Head; worktree?: string }
  /** Before a thread's folder is set up (`isUnstarted`): a different workspace for it. */
  | { type: 'workspace'; threadId: string; workspace: WorkspaceDraft }
  /** A folderless chat whose agent is idle moves into the project at this folder, on your default workspace mode; its session goes with it. */
  | { type: 'attach-project'; threadId: string; project: string }
  /** As `attach-project`, once the agent's turn ends (`move_to_project`). */
  | { type: 'attach-project-queued'; threadId: string; project: string }
  | { type: 'controls'; threadId: string; controls: ThreadControls }
  | { type: 'interrupt'; threadId: string }
  /** After a usage limit: on the same account, or (`onApiKey`) on the stored API key from now on. `atReset`: the reset came and you had chosen Resume at reset. */
  | { type: 'resume'; threadId: string; onApiKey?: boolean; atReset?: boolean }
  | { type: 'limit-auto-resume'; threadId: string; isOn: boolean }
  /**
   * `prompt` and `images` are what the agent gets when they differ from the transcript's `text` (composer references). No `drift` while the classifier is still out; `drift-verdict` tags the message once it answers.
   * `queuedId`: the queued message this sends, which leaves the queue. `steers`: joins the turn in flight instead of waiting for it to end (every `sendMessage`).
   */
  | {
      type: 'send';
      threadId: string;
      text: string;
      drift?: DriftKind;
      reason: string;
      prompt?: string;
      images?: AgentImage[];
      /** The images you attached, as the transcript shows them. */ shownImages?: string[];
      skills?: string[];
      queuedId?: string;
      steers?: boolean;
      /** The message as you typed it: sent into a turn in flight, it waits in `steering` until the agent reads it. */ typed?: QueuedMessage;
      /** Sent by another thread's agent (`send_to_thread`); `prompt` then names it for the agent. */ from?: ThreadRef;
      /** With `from`: the target's next turn end goes back to `from` as a note (`noteReplies`). */ expectReply?: true;
      /** An Auto-fix event; `prompt` is the event as the agent gets it. */ autofix?: ActivityEntry['autofix'];
      /** The verdict of a second opinion the agent asked for. */ secondOpinion?: ActivityEntry['secondOpinion'];
    }
  /** `/compact`: the harness compacts the live session now. `queuedId`: it waited in the queue as typed. */
  | { type: 'compact'; threadId: string; focus: string; queuedId?: string }
  | { type: 'queued-add'; threadId: string; message: QueuedMessage }
  /** A message sent into the running turn, taken back before the agent read it; the composer has it again. */
  | { type: 'steer-take-back'; threadId: string; id: string }
  /** Send now clicked on a message the agent hasn't read: marks it while `sendSteerNow` takes it back. */
  | { type: 'steer-send-now'; threadId: string; id: string }
  /** The unread messages Send now took back, the clicked one first (none when the agent already had it): they head the queue. */
  | { type: 'steer-requeue'; threadId: string; ids: string[] }
  /** Edit and remove both take a message out; Edit puts its text back in the composer itself. */
  | { type: 'queued-remove'; threadId: string; id: string }
  | { type: 'queued-order'; threadId: string; ids: string[] }
  | { type: 'queued-resume'; threadId: string }
  /** A link or file you added in the summary; a live agent is told in a message of yours. */
  | { type: 'source-add'; threadId: string; source: Source }
  /** PRs Mochi learned of for the thread (gh's read of its branch, a PR it opened): added, or updated by number. */
  | { type: 'prs-seen'; threadId: string; prs: PullRequest[] }
  | {
      type: 'drift-verdict';
      threadId: string;
      text: string;
      drift: DriftKind;
      reason: string;
    }
  | {
      type: 'drift-new-thread';
      threadId: string;
      prompt: string;
      branchFrom: 'current' | 'base';
    }
  | { type: 'drift-settings'; threadId: string; isMuted: boolean }
  | { type: 'drift-keep'; threadId: string }
  | { type: 'edit-goal'; threadId: string; draft: GoalDraft; by?: Author }
  /** The background model's goal for a thread that had none; dropped when one was set meanwhile or you removed it. */
  | {
      type: 'goal-drafted';
      threadId: string;
      outcome: string;
      criteria: DraftedCriterion[];
      similar?: Similar[];
    }
  | {
      type: 'criterion-check';
      threadId: string;
      criterionId: string;
      result: CheckRun | 'running';
    }
  | { type: 'similar-dismiss'; threadId: string; otherId: string }
  | { type: 'goal-remove'; threadId: string }
  /** A reply's bullets from Simplify, shown in its place; display only. */
  | {
      type: 'simplified';
      threadId: string;
      index: number;
      text: string;
      rulesKey: string;
    }
  | { type: 'simplify-toggle'; threadId: string; index: number }
  | {
      type: 'criterion-claim';
      threadId: string;
      criterionId: string;
      evidence: string;
      by: Provider;
    }
  | { type: 'report'; threadId: string; report: Omit<TurnReport, 'at'> }
  | {
      type: 'parent-report';
      threadId: string;
      report: Omit<ParentReport, 'at' | 'index'>;
    }
  /** update_plan dropped or renamed steps; `why` alone (`pivot-why`) gives the reason for the turn's last pivot that has none. */
  | { type: 'pivot'; threadId: string; pivot: Omit<Pivot, 'turn'> }
  | { type: 'pivot-why'; threadId: string; why: string }
  /** The agent went idle: a fresh record replaces the last turn's, accepted gaps and Open anyway included. */
  /** The agent's `propose_goal`; `isApplied` when Settings › Goals and checks applies proposals with an undo instead of asking. */
  | {
      type: 'goal-propose';
      threadId: string;
      goal: string;
      criteria: { text: string; command?: string }[];
      basis?: string;
      by: Provider;
      isApplied: boolean;
    }
  | {
      type: 'goal-proposal';
      threadId: string;
      decision: 'accept' | 'keep' | 'undo';
    }
  | { type: 'idle-start'; threadId: string }
  /** `turn`: only that turn's record takes the patch, so a late answer can't land on the next turn's. */
  | {
      type: 'idle-update';
      threadId: string;
      patch: Partial<Omit<IdleCheck, 'at'>>;
      turn?: number;
    }
  /** You accepted an assumption the agent made, or asked to change it. */
  | {
      type: 'assumption-set';
      threadId: string;
      id: string;
      state: Assumption['state'];
    }
  /** You answered the turn's next-move card, or wrote instead: it's kept in the chat as a record and the card goes. */
  | {
      type: 'next-move-record';
      threadId: string;
      record: NonNullable<ActivityEntry['nextMove']>;
    }
  /** `at`: epoch ms, the order key a new pin at the end takes (`reorderThreads`). */
  | { type: 'reorder'; pinned: string[]; unpinned: string[]; at: number }
  /** Pins or moves a pin to order key `order` among all your computers' pins (`pinAt`). */
  | { type: 'pin-at'; threadId: string; order: number }
  | { type: 'say'; threadId: string; entry: Omit<ActivityEntry, 'at'> }
  | { type: 'restore'; snapshot: Snapshot }
  /** `ms`: wall-clock time of the rewind, the restarted clock of a step that was running then. */
  | {
      type: 'rewind';
      threadId: string;
      n: number;
      mode?: RewindMode;
      forkAt?: string | null;
      ms?: number;
    }
  | {
      type: 'rewind-message';
      threadId: string;
      index: number;
      mode?: RewindMode;
      forkAt?: string | null;
      ms?: number;
    }
  | { type: 'rewind-undo' }
  | {
      type: 'turn-undo';
      threadId: string;
      start: number;
      isUndone: boolean;
      text: string;
    }
  | { type: 'checkpoint-ref'; threadId: string; n: number; ref: string | null }
  | { type: 'fork'; threadId: string; point: ForkPoint }
  | { type: 'fork-keep'; keepId: string; dropId: string }
  /** Legacy: a drafting handoff row, kept so logged events still fold; `provider-switch` replaced it. `handoff` then moved the thread. */
  | { type: 'handoff-draft'; threadId: string; to: Provider }
  | {
      type: 'handoff';
      threadId: string;
      to: Provider;
      summary: string;
      fallback?: Handoff['fallback'];
    }
  | { type: 'handoff-fail'; threadId: string; error: string }
  /** Moves the thread to another provider from its next message on (`src/rewind/switch.ts`); `model` '' runs its default. */
  | { type: 'provider-switch'; threadId: string; to: Provider; model?: string }
  /** A task the thread's agent delegated (`start_subagent`); `agentCalls` starts its session. */
  | { type: 'bg-start'; threadId: string; agent: BackgroundStart }
  /** Stops a subagent: a Mochi one ends here, a native one when its harness reports it stopped. */
  | { type: 'bg-stop'; threadId: string; subagentId: string }
  /** Stops a background command (or workflow, monitor); it ends when its harness reports it stopped, or here when no harness is live to. */
  | { type: 'task-stop'; threadId: string; taskId: string }
  /** A finished delegated task's report goes to the thread's agent: steered into its turn, or starting one (`dueReports`). */
  | { type: 'delegate-report'; threadId: string; subagentId: string }
  /** Its sub-threads are idle and left notes: the notes are the agent's next message (`dueWakes`). */
  | { type: 'subthread-wake'; threadId: string }
  /** The agent's `create_thread` that didn't start one: a card in its chat (`src/chat/proposals.ts`). */
  | {
      type: 'proposal-add';
      threadId: string;
      proposal: ThreadProposal;
      by: Provider;
    }
  /** Start, New thread, or the agent starting it when you said so: creates the thread the proposal resolved, as a sub-thread when it is one. */
  | { type: 'proposal-start'; threadId: string; proposalId: string }
  /** Dismiss (yours, or the agent withdrawing it with `reason`), or Do it here on an offer. */
  | {
      type: 'proposal-answer';
      threadId: string;
      proposalId: string;
      state: 'dismissed' | 'here';
      reason?: string;
    }
  /** The agent's `request_orchestration_grant`: a card in its chat (`src/chat/grants.ts`). */
  | {
      type: 'grant-add';
      threadId: string;
      grant: OrchestrationGrant;
      by: Provider;
    }
  /** Allow (with the models you left on) or Don't allow on a pending grant; Revoke on an allowed one. */
  | {
      type: 'grant-answer';
      threadId: string;
      grantId: string;
      answer: 'allow' | 'deny' | 'revoke';
      models?: string[];
    }
  /** An agent-driven turn started a thread on the grant. */
  | {
      type: 'grant-use';
      threadId: string;
      grantId: string;
      started: ThreadRef;
    };

/** The demo's fixture threads when shown, then your own threads from the last launch (desktop). */
export function initialThreads(
  saved: Saved | null = null,
  isDemo = true,
): ThreadsState {
  // Demo threads start read, as a restored save does.
  const demo = isDemo
    ? seedThreads().map((t) => ({ ...t, seenActivity: t.activity.length }))
    : [];
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
    remoteSideChats: saved?.remoteSideChats ?? {},
    context: DEFAULT_CONTEXT,
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
    case 'context':
      return { ...state, context: action.context };
    case 'window-loaded':
      return windowLoaded(state, action.threadIds);
    case 'seen':
      return markSeen(state, action);
    case 'agent': {
      const resumed = resumeStoppedSteps(
        state,
        action.event.threadId,
        state.now,
        action.ms,
      );
      return stampNew(
        resumed,
        withEventSeq(applyAgentEvent(resumed, action.event), action.event),
        action.event.threadId,
        action.ms,
      );
    }
    case 'agent-starting':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          t.live ? { ...t, live: { ...t.live, starting: action.provider } } : t,
        ),
      };
    case 'settle': {
      // A parent settles with its open sub-threads at every depth: they were parts of its goal. A settled one's subtree already stands on its own.
      const ids = new Set([
        action.threadId,
        ...openSubtree(state.threads, action.threadId).map((t) => t.id),
      ]);
      return {
        ...state,
        // Settling stops the agent process; the next message after reactivating starts it again with `resume`.
        threads: state.threads.map((t) =>
          ids.has(t.id)
            ? pauseQueue(
                {
                  ...markSettled(t, state.now),
                  ...(t.live && {
                    live: {
                      ...t.live,
                      isWorking: false,
                      isDetached: true,
                      limit: undefined,
                    },
                  }),
                },
                'interrupted',
              )
            : t,
        ),
        queue: state.queue.filter((q) => !ids.has(q.threadId)),
      };
    }
    case 'nest': {
      if (nestBlocker(state.threads, action.threadId, action.parentId))
        return state;
      const parent = state.threads.find((t) => t.id === action.parentId);
      const sub = state.threads.find((t) => t.id === action.threadId);
      return {
        ...state,
        threads: state.threads.map((t) => {
          if (t.id === action.parentId && sub)
            return log(t, linkRow('sub', sub, state.now));
          if (t.id !== action.threadId) return t;
          const nested = {
            ...t,
            parent: {
              threadId: action.parentId,
              ...(action.criterionId && { criterionId: action.criterionId }),
            },
            orbitSlot: undefined,
          };
          return parent
            ? log(nested, linkRow('parent', parent, state.now))
            : nested;
        }),
      };
    }
    case 'unnest':
      return {
        ...state,
        threads: mapThread(
          state.threads,
          action.threadId,
          ({ parent: _, ...t }) => t,
        ),
      };
    case 'subthread-handback':
      return handBack(state, action);
    case 'unsettle':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) => ({
          ...t,
          status: 'running',
        })),
      };
    case 'rename':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) => ({
          ...t,
          title: action.title,
          isTitleRenamed: true,
        })),
      };
    case 'title-generated':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          withGeneratedTitle(t, action.title),
        ),
      };
    case 'delete': {
      const gone = (id: string) => action.threadIds.includes(id);
      return {
        ...state,
        // A deleted parent's sub-threads become threads of their own.
        threads: state.threads
          .filter((t) => !gone(t.id))
          .map((t) =>
            t.parent && gone(t.parent.threadId)
              ? (({ parent: _, ...rest }) => rest)(t)
              : t,
          ),
        checkpoints: Object.fromEntries(
          Object.entries(state.checkpoints).filter(([id]) => !gone(id)),
        ),
        forks: Object.fromEntries(
          Object.entries(state.forks).filter(([id]) => !gone(id)),
        ),
      };
    }
    case 'create':
      return create(state, action);
    case 'repo-head': {
      const { head, worktree } = action;
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          t.repo
            ? {
                ...t,
                repo: withHead(t.repo, head, !!worktree),
                live:
                  worktree && t.live ? { ...t.live, cwd: worktree } : t.live,
              }
            : t,
        ),
      };
    }
    case 'workspace':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          t.repo
            ? {
                ...t,
                repo: withWorkspace(
                  t.repo,
                  action.workspace,
                  threadTempBranch(t.spaceId, t.id, t.startedAt),
                ),
                live: t.live && { ...t.live, cwd: undefined },
              }
            : t,
        ),
      };
    case 'attach-project':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          canAttach(t) ? attachProject(t, action.project, state.now) : t,
        ),
      };
    case 'attach-project-queued':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          !t.repo && t.live
            ? { ...t, live: { ...t.live, moveTo: action.project } }
            : t,
        ),
      };
    case 'send':
      return send(state, action);
    case 'compact':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) => {
          if (!t.live) return t;
          const left = withQueue(
            t,
            (t.queued ?? []).filter((m) => m.id !== action.queuedId),
          );
          return log(
            {
              ...left,
              status: 'running',
              live: { ...t.live, isWorking: true },
            },
            compactionEntry(t, state.now, 'manual', action.focus),
          );
        }),
      };
    case 'queued-add':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) => ({
          ...t,
          queued: [...(t.queued ?? []), action.message],
        })),
      };
    case 'steer-take-back':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          withSteering(
            t,
            (t.steering ?? []).filter((s) => s.message.id !== action.id),
          ),
        ),
      };
    case 'steer-send-now':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          withSteering(
            t,
            (t.steering ?? []).map((s) =>
              s.message.id === action.id
                ? { ...s, sendNow: 'pending' as const }
                : s,
            ),
          ),
        ),
      };
    case 'steer-requeue':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          requeueSteers(t, action.ids),
        ),
      };
    case 'queued-remove':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          withQueue(
            t,
            (t.queued ?? []).filter((m) => m.id !== action.id),
          ),
        ),
      };
    case 'queued-order':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) => ({
          ...t,
          queued: orderQueue(t.queued ?? [], action.ids),
        })),
      };
    case 'queued-resume':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) => ({
          ...t,
          queuePause: undefined,
        })),
      };
    case 'source-add':
      return addSource(state, action);
    case 'prs-seen':
      return seePrs(state, action.threadId, action.prs);
    case 'controls':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) => ({
          ...t,
          controls: action.controls,
        })),
      };
    case 'resume':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          t.live
            ? log(
                // The queue waits for this turn to end, then goes on.
                {
                  ...t,
                  status: 'running',
                  queuePause: undefined,
                  live: {
                    ...t.live,
                    isWorking: true,
                    limit: undefined,
                    isDetached: undefined,
                    isOnApiKey: t.live.isOnApiKey || action.onApiKey,
                  },
                },
                {
                  at: state.now,
                  who: 'harness',
                  kind: 'event',
                  text: resumeText(t, action),
                },
              )
            : t,
        ),
      };
    case 'limit-auto-resume':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          t.live?.limit
            ? {
                ...t,
                live: {
                  ...t.live,
                  limit: {
                    ...t.live.limit,
                    autoResume: action.isOn || undefined,
                  },
                },
              }
            : t,
        ),
      };
    case 'drift-new-thread':
      return driftNewThread(state, action);
    case 'drift-verdict':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          tagSent(t, action, state.now),
        ),
      };
    case 'drift-settings':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) => ({
          ...t,
          drift: { ...t.drift, isMuted: action.isMuted },
        })),
      };
    case 'drift-keep':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          keepHere(t, state.now),
        ),
      };
    case 'goal-drafted':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          setDraftedGoal(
            t,
            action.outcome,
            action.criteria,
            action.similar ?? [],
            state.now,
          ),
        ),
      };
    case 'similar-dismiss':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) => ({
          ...t,
          similar: t.similar?.filter((s) => s.threadId !== action.otherId),
        })),
      };
    case 'criterion-check':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          checkCriterion(t, action, state.now),
        ),
      };
    case 'criterion-claim':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          claimCriterion(t, action, state.now),
        ),
      };
    case 'goal-propose':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          propose(t, action, state.now),
        ),
      };
    case 'goal-proposal':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          decideProposal(t, action.decision, state.now),
        ),
      };
    case 'idle-start':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) => ({
          ...t,
          idle: {
            at: state.now,
            turn: (t.idle?.turn ?? 0) + 1,
            accepted: [],
            isGathering: true,
          },
        })),
      };
    case 'next-move-record':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          log(
            {
              ...t,
              idle: {
                ...(t.idle ?? { at: state.now, accepted: [] }),
                isMoveAnswered: true,
              },
            },
            {
              at: state.now,
              who: 'harness',
              kind: 'event',
              text: action.record.question,
              nextMove: action.record,
            },
          ),
        ),
      };
    case 'idle-update':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          t.idle && (action.turn === undefined || t.idle.turn === action.turn)
            ? { ...t, idle: { ...t.idle, ...action.patch } }
            : t,
        ),
      };
    case 'pivot':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) => ({
          ...t,
          pivots: [
            ...(t.pivots ?? []).filter((p) => p.turn === turnOf(t)),
            { ...action.pivot, turn: turnOf(t) },
          ],
        })),
      };
    case 'pivot-why':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) => {
          const k = (t.pivots ?? []).findLastIndex(
            (p) => p.turn === turnOf(t) && !p.why,
          );
          return k < 0
            ? t
            : {
                ...t,
                pivots: t.pivots!.map((p, i) =>
                  i === k ? { ...p, why: action.why } : p,
                ),
              };
        }),
      };
    case 'assumption-set':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) => ({
          ...t,
          assumptions: t.assumptions?.map((a) =>
            a.id === action.id ? { ...a, state: action.state } : a,
          ),
        })),
      };
    case 'report':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) => ({
          ...t,
          report: {
            ...action.report,
            at: state.now,
            turn: turnOf(t),
            index: t.activity.length,
          },
          ...(action.report.assumptions?.length && {
            assumptions: withAssumptions(
              t.assumptions,
              action.report.assumptions,
              turnOf(t),
            ),
          }),
          steering: t.steering?.map((s) => ({
            ...s,
            hasReportBefore: true as const,
          })),
        })),
      };
    case 'parent-report':
      return parentReport(state, action);
    case 'simplified':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          mapEntry(t, action.index, (e) => ({
            ...e,
            simplified: {
              text: action.text,
              rulesKey: action.rulesKey,
              isShown: true,
            },
          })),
        ),
      };
    case 'simplify-toggle':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          mapEntry(t, action.index, (e) =>
            e.simplified
              ? {
                  ...e,
                  simplified: {
                    ...e.simplified,
                    isShown: !e.simplified.isShown,
                  },
                }
              : e,
          ),
        ),
      };
    case 'goal-remove':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          removeGoal(t, state.now),
        ),
      };
    case 'edit-goal':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          applyDraft(t, action.draft, state.now, action.by),
        ),
      };
    case 'reorder':
      return {
        ...state,
        threads: reorderThreads(
          state.threads,
          action.pinned,
          action.unpinned,
          action.at,
        ),
      };
    case 'pin-at': {
      const thread = state.threads.find((t) => t.id === action.threadId);
      return {
        ...state,
        threads:
          (thread &&
            pinAt(state.threads, thread.spaceId, thread.id, action.order)) ??
          state.threads,
      };
    }
    case 'say':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          log(t, { ...action.entry, at: state.now }),
        ),
      };
    case 'restore':
      return { ...state, ...action.snapshot };
    case 'rewind':
      return rewind(
        state,
        action.threadId,
        action.n,
        action.mode,
        action.forkAt,
        action.ms,
      );
    case 'rewind-message':
      return rewindToMessage(
        state,
        action.threadId,
        action.index,
        action.mode,
        action.forkAt,
        action.ms,
      );
    case 'turn-undo':
      return turnUndo(
        state,
        action.threadId,
        { start: action.start, isUndone: action.isUndone },
        action.text,
      );
    case 'rewind-undo':
      return undoRewind(state);
    case 'checkpoint-ref':
      return {
        ...state,
        checkpoints: {
          ...state.checkpoints,
          [action.threadId]: (state.checkpoints[action.threadId] ?? []).map(
            (c) =>
              c.n === action.n
                ? { ...c, ref: action.ref ?? undefined, wantsFiles: false }
                : c,
          ),
        },
      };
    case 'fork':
      return forkThread(state, action.threadId, action.point);
    case 'fork-keep':
      return keepFork(state, action.keepId, action.dropId);
    case 'bg-start':
      return startBackground(state, action.threadId, action.agent);
    case 'bg-stop': {
      const thread = state.threads.find((t) => t.id === action.threadId);
      const subagent = thread?.subagents?.find(
        (s) => s.id === action.subagentId,
      );
      // A native agent of a live harness ends when the harness reports it stopped.
      if (
        !subagent ||
        (subagent.origin === 'native' &&
          thread?.live &&
          !thread.live.isDetached)
      )
        return state;
      return applyAgentEvent(state, {
        threadId: action.threadId,
        type: 'subagent',
        id: subagent.id,
        phase: 'end',
        status: 'stopped',
      });
    }
    case 'task-stop': {
      const thread = state.threads.find((t) => t.id === action.threadId);
      const task = thread?.backgroundTasks?.find((t) => t.id === action.taskId);
      if (!thread || !task || (thread.live && !thread.live.isDetached))
        return state;
      return applyAgentEvent(state, {
        threadId: thread.id,
        type: 'task',
        id: task.id,
        phase: 'end',
        status: 'stopped',
      });
    }
    case 'delegate-report':
      // As `send` does: the report is the agent's next message, carrying its notes.
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) => ({
          ...t,
          ...leftSession(t),
          ...(t.live && {
            status: 'running',
            live: {
              ...t.live,
              isWorking: true,
              isDetached: undefined,
              notes: undefined,
              restart: undefined,
            },
          }),
          // Steered into a turn in flight it joins that turn; otherwise the report begins one nobody asked for.
          ...(t.live &&
            !t.live.isWorking && {
              turn: { start: t.activity.length, isAgentDriven: true as const },
            }),
          subagents: t.subagents?.map((s) =>
            s.id === action.subagentId ? { ...s, isReportDue: undefined } : s,
          ),
        })),
      };
    case 'proposal-add':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          addProposal(t, action.proposal, {
            at: state.now,
            who: action.by,
            kind: 'event',
            text: `Suggested "${action.proposal.title}"`,
          }),
        ),
      };
    case 'proposal-start':
      return startProposal(state, action);
    case 'grant-add':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) => ({
          ...t,
          activity: [
            ...t.activity,
            {
              at: state.now,
              who: action.by,
              kind: 'event',
              text: `Asked to start up to ${action.grant.maxThreads} threads on its own`,
              grant: action.grant,
            },
          ],
        })),
      };
    case 'grant-answer':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          answerGrant(t, action, state.now),
        ),
      };
    case 'grant-use':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          updateGrant(t, action.grantId, (g) => ({
            started: [...g.started, action.started],
          })),
        ),
      };
    case 'proposal-answer': {
      const thread = state.threads.find((t) => t.id === action.threadId);
      if (!thread || proposalBlocker(thread, action.proposalId, state.now))
        return state;
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          updateProposal(t, action.proposalId, {
            state: action.state,
            ...(action.reason && { reason: action.reason }),
          }),
        ),
      };
    }
    case 'subthread-wake':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) =>
          t.live
            ? log(
                {
                  ...t,
                  ...leftSession(t),
                  status: 'running',
                  live: {
                    ...t.live,
                    isWorking: true,
                    isDetached: undefined,
                    notes: undefined,
                    restart: undefined,
                    sentReports: sentReports(t),
                  },
                  activity: markReportsDelivered(t).activity,
                  turn: { start: t.activity.length, isAgentDriven: true },
                },
                {
                  at: state.now,
                  who: 'harness',
                  kind: 'event',
                  text: 'Sent the sub-thread reports to the agent',
                },
              )
            : t,
        ),
      };
    case 'handoff-draft':
      return handoffDraft(state, action.threadId, action.to);
    case 'handoff': {
      const thread = state.threads.find((t) => t.id === action.threadId);
      const isMoving = !!thread && !handoffBlocker(thread, action.to);
      const next = handoff(
        state,
        action.threadId,
        action.to,
        action.summary,
        action.fallback,
      );
      return isMoving ? handoffLive(next, action) : next;
    }
    case 'handoff-fail':
      return handoffFail(state, action.threadId, action.error);
    case 'provider-switch':
      return switchProvider(state, action.threadId, action.to, action.model);
    default:
      return state;
  }
}

/**
 * What ran in the window that went away: a handoff draft never answers, and a Mochi tool call's open card waits on a run
 * that ended with it; the new window runs that call again and asks anew.
 */
function windowLoaded(state: State, threadIds: string[]): State {
  const reasked = new Set(
    state.queue
      .filter((q) => q.tool && threadIds.includes(q.threadId))
      .map((q) => q.id),
  );
  const threads = state.threads.map((t) => {
    const kept = reasked.size
      ? t.activity.filter((e) => !(e.card?.isOpen && reasked.has(e.card.id)))
      : t.activity;
    const activity = failDrafts(
      kept.length === t.activity.length ? t.activity : kept,
      'Stopped when the window reloaded',
    );
    return activity === t.activity ? t : { ...t, activity };
  });
  const isSame =
    !reasked.size && threads.every((t, i) => t === state.threads[i]);
  return isSame
    ? state
    : {
        ...state,
        threads,
        queue: state.queue.filter((q) => !reasked.has(q.id)),
      };
}

/** An emptied queue drops its pause with it. */
/**
 * The agent read a message you sent into its turn: it joins the transcript here, after the agent's latest step. Read after the turn
 * ended, it started the next one; a report written while it waited answered a turn your message changed.
 */
export function readSteer(t: Thread, id: string, now: number): Thread {
  const pending = t.steering?.find((s) => s.message.id === id);
  if (!pending) return t;
  const rest = withSteering(
    t,
    t.steering!.filter((s) => s !== pending),
  );
  const report =
    pending.hasReportBefore && rest.report
      ? { ...rest.report, isSuperseded: true as const }
      : rest.report;
  const live = rest.live && { ...rest.live, isWorking: true };
  const said = log(
    { ...rest, report, live, status: rest.live ? 'running' : rest.status },
    pending.entry,
  );
  return pending.entry.drift
    ? applyDrift(said, pending.entry.drift, pending.reason, now)
    : said;
}

/** Taken-back steers head the queue, `ids` order first; the turn Send now was clicked in, if still running, is interrupted for them (`agentCalls`). */
function requeueSteers(t: Thread, ids: string[]): Thread {
  const taken = ids
    .flatMap(
      (id) => t.steering?.find((s) => s.message.id === id)?.message ?? [],
    )
    .map((m, i) => (i === 0 ? { ...m, isSentNow: true as const } : m));
  const steering = (t.steering ?? [])
    .filter((s) => !ids.includes(s.message.id))
    .map((s) => (s.sendNow ? { ...s, sendNow: undefined } : s));
  const requeued = {
    ...withSteering(t, steering),
    queued: [...taken, ...(t.queued ?? [])],
  };
  return interruptsToSend(t, ids)
    ? { ...requeued, isInterruptedToSend: true }
    : requeued;
}

function withSteering(thread: Thread, steering: PendingSteer[]): Thread {
  return { ...thread, steering: steering.length ? steering : undefined };
}

function withQueue(thread: Thread, queued: QueuedMessage[]): Thread {
  return {
    ...thread,
    queued,
    ...(queued.length === 0 && { queuePause: undefined }),
  };
}

function mapEntry(
  t: Thread,
  index: number,
  fn: (e: ActivityEntry) => ActivityEntry,
): Thread {
  const entry = t.activity[index];
  return entry
    ? { ...t, activity: t.activity.map((e, i) => (i === index ? fn(e) : e)) }
    : t;
}

/** Unchanged state when every PR is already recorded as it is, so a periodic gh read doesn't re-save. */
/** Records gh's PRs on the thread; one new to it starts with your defaults (Settings › Git), Auto-fix only where Mochi can watch it. */
export function seePrs(
  state: State,
  threadId: string,
  prs: PullRequest[],
): State {
  const thread = state.threads.find((t) => t.id === threadId);
  if (!thread) return state;
  const next = recordPrs(thread.prs, prs);
  if (next === thread.prs) return state;
  const { autofixPrs, autoArchivePrs } = prefsNow();
  const isNew = (pr: PullRequest) =>
    !thread.prs.some((p) => p.number === pr.number);
  const withDefaults = (pr: PullRequest): PullRequest => ({
    ...pr,
    ...(autoArchivePrs && { autoArchive: true }),
    ...(autofixPrs && canAutofix(thread, pr) && { autofixSince: state.now }),
  });
  const recorded = next.map((pr) => (isNew(pr) ? withDefaults(pr) : pr));
  const enabled = recorded.filter((pr) => isNew(pr) && pr.autofixSince);
  const said = enabled.reduce(
    (t, pr) =>
      log(t, {
        at: state.now,
        who: 'harness',
        kind: 'event',
        text: autofixTitle({ kind: 'enabled', pr: pr.number }),
      }),
    { ...thread, prs: recorded },
  );
  return reportPrsEnded(
    { ...state, threads: mapThread(state.threads, threadId, () => said) },
    thread,
  );
}

export function mapThread(
  threads: Thread[],
  id: string,
  fn: (t: Thread) => Thread,
) {
  return threads.map((t) => (t.id === id ? fn(t) : t));
}

export function mapStep(
  thread: Thread,
  id: string,
  fn: (s: Step) => Step,
): Thread {
  return {
    ...thread,
    steps: thread.steps.map((s) => (s.id === id ? fn(s) : s)),
  };
}

function withEventSeq(state: State, event: SeqAgentEvent): State {
  if (event.seq === undefined) return state;
  return {
    ...state,
    threads: mapThread(state.threads, event.threadId, (t) =>
      t.live ? { ...t, live: { ...t.live, eventSeq: event.seq } } : t,
    ),
  };
}

/**
 * The agent's first event in a new turn picks up the step the last turn stopped: an interrupted step keeps running without the
 * agent re-sending its plan. Its clock skips the time it sat stopped.
 */
function resumeStoppedSteps(
  state: State,
  threadId: string,
  now: number,
  ms?: number,
): State {
  const thread = state.threads.find((t) => t.id === threadId);
  if (!thread?.live?.isWorking) return state;
  if (!thread.steps.some(isStoppedRunning)) return state;
  return {
    ...state,
    threads: mapThread(state.threads, threadId, (t) => ({
      ...t,
      steps: t.steps.map((s) =>
        isStoppedRunning(s) ? resumeStep(s, now, ms) : s,
      ),
    })),
  };
}

function isStoppedRunning(step: Step) {
  return step.status === 'running' && step.stoppedAt !== undefined;
}

function resumeStep(step: Step, now: number, ms?: number): Step {
  const { stoppedAt, stoppedMs, ...rest } = step;
  return {
    ...rest,
    ...(rest.startedAt !== undefined && {
      startedAt: rest.startedAt + now - stoppedAt!,
    }),
    ...(rest.startedMs !== undefined &&
      stoppedMs !== undefined &&
      ms !== undefined && { startedMs: rest.startedMs + ms - stoppedMs }),
  };
}

function stampNew(
  before: State,
  after: State,
  threadId: string,
  ms?: number,
): State {
  if (ms === undefined || after === before) return after;
  const prior = before.threads.find((t) => t.id === threadId);
  const from = prior?.activity.length ?? 0;
  const priorSteps = new Map(prior?.steps.map((s) => [s.id, s]));
  return {
    ...after,
    threads: mapThread(after.threads, threadId, (t) => {
      const steps = t.steps.map((s) => stampStep(priorSteps.get(s.id), s, ms));
      return {
        ...t,
        activity:
          t.activity.length > from
            ? t.activity.map((e, i) =>
                i >= from && e.ms === undefined ? { ...e, ms } : e,
              )
            : t.activity,
        // Unchanged steps keep their array, so a streamed token changes nothing a reader of the plan compares.
        steps: steps.every((s, i) => s === t.steps[i]) ? t.steps : steps,
      };
    }),
  };
}

/** A step this action started or finished gets the wall clock beside Mochi's minute clock; one started before the stamps existed keeps none. */
export function stampStep(
  prior: Step | undefined,
  step: Step,
  ms: number,
): Step {
  const isStarted =
    step.startedAt !== undefined && prior?.startedAt === undefined;
  const isDone = step.doneAt !== undefined && prior?.doneAt === undefined;
  const isStopped =
    step.stoppedAt !== undefined && prior?.stoppedAt === undefined;
  if (!isStarted && !isDone && !isStopped) return step;
  return {
    ...step,
    ...(isStarted && { startedMs: ms }),
    ...(isDone && { doneMs: ms }),
    ...(isStopped && { stoppedMs: ms }),
  };
}

/** A `report_to_parent` call: kept on the sub-thread for `get_thread`, and logged in its parent's transcript (`reportTyped`). */
function parentReport(
  state: State,
  action: Extract<Action, { type: 'parent-report' }>,
): State {
  const sub = state.threads.find((t) => t.id === action.threadId);
  if (!sub) return state;
  // An Auto-fix turn that needed nothing from the parent stays with the sub-thread, as its normal turn end does.
  const status =
    action.report.status === 'done' && isAutofixTurn(sub)
      ? 'no_change'
      : action.report.status;
  const report = {
    ...action.report,
    status,
    at: state.now,
    index: sub.activity.length,
  };
  return reportTyped(
    {
      ...state,
      threads: mapThread(state.threads, sub.id, (t) => ({
        ...t,
        parentReport: report,
      })),
    },
    sub,
    report,
  );
}

export function log(thread: Thread, entry: ActivityEntry): Thread {
  return { ...thread, activity: [...thread.activity, entry] };
}

/** One simulated minute: the clock moves and every demo thread (no live session) reports what it did. */
/** The reports a message delivers, kept until the agent answers so a failed send un-delivers them (`applyAgentEvent`). */
function sentReports(t: Thread) {
  const positions = undeliveredPositions(t);
  return positions.length ? positions : t.live?.sentReports;
}

function tick(state: State): State {
  let next: State = { ...state, now: state.now + 1 };
  for (const { id } of state.threads) {
    const thread = next.threads.find((t) => t.id === id);
    if (thread && !thread.session && !thread.live)
      next = applyAgentEvents(next, demoEvents(thread, next.now));
  }
  return stallBackground(reportStalls(next));
}

/** A plan item the agent finished. The plan already shows it, so nothing is logged. */
export function completeStep(
  threads: Thread[],
  threadId: string,
  stepId: string,
  now: number,
): Thread[] {
  return mapThread(threads, threadId, (t) =>
    mapStep(t, stepId, (s) => ({ ...s, status: 'done', doneAt: now })),
  );
}

export function freeLine(threads: Thread[]): LineSlot {
  const used = new Set(
    threads.filter((t) => t.status !== 'settled').map((t) => t.line),
  );
  return ([1, 2, 3, 4, 5] as const).find((l) => !used.has(l)) ?? 5;
}

/** The id the next `create` gives its thread. */
export const nextThreadId = (state: Pick<State, 'seq'>) => `new-${state.seq}`;

function create(
  state: State,
  action: Extract<Action, { type: 'create' }>,
): State {
  const now = state.now;
  const id = nextThreadId(state);
  const spaceId = action.spaceId ?? state.spaceId;
  const base = (sid: string, title: string): Step => ({
    id: sid,
    title,
    status: 'ready',
    addedAt: now,
    addedBy: action.provider,
  });
  const isLive = !!action.isLive;
  // A live thread's own steps come from its agent's plan; the placeholders are for the demo adapter.
  const steps = isLive
    ? []
    : [
        base(`${id}-1`, 'Read the code involved'),
        base(`${id}-2`, 'Make the change'),
        base(`${id}-3`, 'Add tests'),
      ];
  const thread: Thread = {
    id,
    spaceId,
    repo: action.project
      ? withWorkspace(
          repoFor(action.project, ''),
          action.workspace ?? { mode: prefsNow().workspaceMode },
          threadTempBranch(spaceId, id, now),
        )
      : null,
    title: action.name ?? titleFrom(action.title),
    ...(action.name && { isTitleRenamed: true }),
    goal: '',
    providers: [action.provider],
    status: 'running',
    line: freeLine(state.threads.filter((t) => t.spaceId === spaceId)),
    startedAt: now,
    revisions: [],
    steps,
    activity: [
      ...(action.branchFrom
        ? [
            {
              at: now,
              who: 'harness' as const,
              kind: 'event' as const,
              text: `Branched off ${action.branchFrom}`,
            },
          ]
        : []),
      {
        at: now,
        who: 'you',
        kind: 'message',
        text: action.title,
        ...(action.images?.length && { images: action.images.map(shownImage) }),
      },
    ],
    prs: [],
    sources: [],
    context: { used: isLive ? 0 : 4_000, max: contextMax(action.provider) },
    controls: action.controls,
    ...(action.parent && { parent: action.parent }),
    ...(action.isSettingsChat && { isSettingsChat: true }),
    // An agent wrote its first prompt, so its first turn is no one's request: it can only propose threads.
    ...(action.isBackground && {
      turn: { start: action.branchFrom ? 1 : 0, isAgentDriven: true as const },
    }),
  };
  if (isLive)
    thread.live = { isWorking: true, cwd: threadRoot(thread) ?? undefined };
  // Detached: a message before the first run starts the agent the way a restored thread does.
  if (isLive && action.schedule) {
    thread.live = { ...thread.live!, isWorking: false, isDetached: true };
    thread.activity.push({
      at: now,
      who: 'harness',
      kind: 'event',
      text: `Scheduled: ${describeTrigger(action.schedule.when)}`,
    });
  }
  // A sub-thread opens on the row naming its parent, ahead of its first message; the parent's chat gets one naming it.
  const parent =
    action.parent &&
    state.threads.find((t) => t.id === action.parent!.threadId);
  if (parent) thread.activity.unshift(linkRow('parent', parent, now));
  const threads = [
    ...state.threads.map((t) =>
      t.id === parent?.id ? log(t, linkRow('sub', thread, now)) : t,
    ),
    thread,
  ];
  return { ...state, threads, seq: state.seq + 1 };
}

/** The row in one chat that names the other side of a sub-thread link: `sub` in the parent's, `parent` in the sub-thread's. */
function linkRow(
  role: 'sub' | 'parent',
  other: Thread,
  at: number,
): ActivityEntry {
  return {
    at,
    who: 'harness',
    kind: 'event',
    text:
      role === 'sub'
        ? `Started sub-thread ${other.title}`
        : `Sub-thread of ${other.title}`,
    threadLink: { role, threadId: other.id, title: other.title },
  };
}

/** The temp branch `create` gives the next thread, which the composer shows before you send. */
export const nextTempBranch = (state: Pick<State, 'spaceId' | 'seq' | 'now'>) =>
  threadTempBranch(state.spaceId, `new-${state.seq}`, state.now);

const threadTempBranch = (spaceId: string, threadId: string, at: number) =>
  tempBranch(prefsNow().branchPrefix, `${spaceId}/${threadId}/${at}`);

/** Only a folderless chat moves into a project, and never mid-turn: its session moves with it. */
export const canAttach = (thread: Thread) =>
  !thread.repo && !thread.live?.isWorking;

/** The next message resumes the same session in the project (`agentCalls`), told where its files went (`moveNote`). */
function attachProject(thread: Thread, project: string, now: number): Thread {
  const repo = withWorkspace(
    repoFor(project, ''),
    { mode: prefsNow().workspaceMode },
    threadTempBranch(thread.spaceId, thread.id, thread.startedAt),
  );
  return log(
    {
      ...thread,
      repo,
      ...(thread.live && {
        live: {
          ...thread.live,
          cwd: undefined,
          isDetached: true,
          moveTo: undefined,
          movedFrom: thread.live.cwd ?? `~/.harness/chats/${thread.id}`,
        },
      }),
    },
    {
      at: now,
      who: 'harness',
      kind: 'event',
      text: `Moved to ${repo.project}`,
    },
  );
}

/** `fallback` names the branch when the draft doesn't: a project folder thread is on whatever branch the folder is. */
function withWorkspace(
  repo: NonNullable<Thread['repo']>,
  draft: WorkspaceDraft,
  fallback: string,
): NonNullable<Thread['repo']> {
  const { project, path } = repo;
  return {
    project,
    ...(path && { path }),
    branch: draft.branch || fallback,
    ...repoWorkspace(draft),
    ...(draft.mode === 'worktree' &&
      !draft.isExisting &&
      (draft.autoBranch || !draft.branch) && {
        autoBranch: draft.autoBranch || fallback,
      }),
  };
}

export function send(
  state: State,
  action: Extract<Action, { type: 'send' }>,
): State {
  const now = state.now;
  const { from } = action;
  const threads = from?.threadId
    ? mapThread(state.threads, from.threadId, (t) =>
        markSent(t, {
          threadId: action.threadId,
          title:
            state.threads.find((r) => r.id === action.threadId)?.title ?? '',
          text: action.text,
        }),
      )
    : state.threads;
  return {
    ...state,
    threads: mapThread(threads, action.threadId, (t) => {
      // The agent gets its background agents' notes with this message (`agentCalls`), so they're delivered.
      // Your message ends a Codex limit pause (and its Resume at reset); a turn Claude Code holds keeps waiting.
      const live = t.live && {
        ...t.live,
        isWorking: true,
        limit: t.live.limit?.isTurnHeld ? t.live.limit : undefined,
        isDetached: undefined,
        notes: undefined,
        restart: undefined,
        movedFrom: undefined,
        sentReports: sentReports(t),
      };
      // Its undelivered reports went with this message (`withReports`), as the notes did.
      const delivered = live ? markReportsDelivered(t) : t;
      const isYours = !from && !action.autofix && !action.secondOpinion;
      const sent = withQueue(
        {
          ...delivered,
          queuePause: undefined,
          ...replyTo(t, action),
          ...(isYours &&
            t.assumptions && {
              assumptions: changedBySend(t.assumptions, action.text),
            }),
        },
        (t.queued ?? []).filter((m) => m.id !== action.queuedId),
      );
      const entry: ActivityEntry = {
        at: now,
        who: 'you',
        kind: 'message',
        text: action.text,
        drift: action.drift,
        ...(action.queuedId && !action.typed?.isSentNow && { wasQueued: true }),
        ...(action.shownImages?.length && { images: action.shownImages }),
        ...(from && { from }),
        ...(action.autofix && { autofix: action.autofix }),
        ...(action.secondOpinion && { secondOpinion: action.secondOpinion }),
      };
      const going = live
        ? { ...sent, ...leftSession(t), status: 'running' as const, live }
        : sent;
      // Into a turn in flight, it joins the transcript where the agent reads it (`readSteer`), not where you sent it.
      if (action.typed && t.live?.isWorking)
        return {
          ...going,
          steering: [
            ...(t.steering ?? []),
            {
              message: action.typed,
              entry: { ...entry, isSeen: true },
              reason: action.reason,
            },
          ],
        };
      const said = log(
        {
          ...going,
          turn: {
            start: going.activity.length,
            ...((from || action.autofix || action.secondOpinion) && {
              isAgentDriven: true as const,
            }),
          },
        },
        entry,
      );
      return action.drift
        ? applyDrift(said, action.drift, action.reason, now)
        : said;
    }),
  };
}

/** The turn the thread's agent is in: one past its last idle record's, as a report counts it. */
const turnOf = (t: Thread) => (t.idle?.turn ?? 0) + 1;

/** A message sent with `expectReply` adds its sender to `replyTo`, once per sender (`reportReplies`). */
function replyTo(t: Thread, action: Extract<Action, { type: 'send' }>) {
  const sender = action.from?.threadId;
  if (!action.expectReply || !sender) return {};
  return {
    replyTo: [
      ...(t.replyTo ?? []).filter((r) => r.threadId !== sender),
      { threadId: sender, title: action.from!.title },
    ],
  };
}

function addSource(
  state: State,
  action: Extract<Action, { type: 'source-add' }>,
): State {
  const thread = state.threads.find((t) => t.id === action.threadId);
  if (!thread || thread.sources.some((s) => s.label === action.source.label))
    return state;
  const added = {
    ...state,
    threads: mapThread(state.threads, action.threadId, (t) => ({
      ...t,
      sources: [...t.sources, action.source],
    })),
  };
  if (thread.live)
    return send(added, {
      type: 'send',
      threadId: action.threadId,
      text: sourcePrompt(action.source),
      reason: '',
    });
  return {
    ...added,
    threads: mapThread(added.threads, action.threadId, (t) =>
      log(t, {
        at: state.now,
        who: 'harness',
        kind: 'event',
        text: `Added source ${action.source.label}`,
      }),
    ),
  };
}

/** A title a model generated, unless you named the thread yourself. */
export const withGeneratedTitle = (t: Thread, title: string): Thread =>
  t.isTitleRenamed ? t : { ...t, title, isTitleGenerated: true };

const titleFrom = (text: string) =>
  text.length > 48 ? `${text.slice(0, 47)}…` : text;

function setDraftedGoal(
  t: Thread,
  outcome: string,
  criteria: DraftedCriterion[],
  similar: Similar[],
  now: number,
): Thread {
  if (t.goal || t.isGoalOff) return t;
  const n = (t.revisions.at(-1)?.n ?? 0) + 1;
  const set = {
    ...t,
    goal: outcome,
    ...(similar.length && { similar }),
    criteria: criteria.map((c, i) => ({ id: `${t.id}-c${n}-${i}`, ...c })),
    revisions: [
      ...t.revisions,
      {
        n,
        at: now,
        label: 'Goal drafted',
        by: 'harness' as const,
        diff: [
          `+ Goal: ${outcome}`,
          ...criteria.map((c) => `+ Done when: ${c.text}`),
        ],
      },
    ],
  };
  return log(set, {
    at: now,
    who: 'harness',
    kind: 'event',
    text: `Goal: ${outcome}`,
  });
}

function propose(
  t: Thread,
  action: Extract<Action, { type: 'goal-propose' }>,
  now: number,
): Thread {
  const before = {
    goal: t.goal,
    criteria: (t.criteria ?? []).map(({ text, command }) => ({
      text,
      command,
    })),
  };
  const proposal = {
    goal: action.goal,
    criteria: action.criteria,
    basis: action.basis,
    at: now,
    by: action.by,
    state: 'waiting' as const,
    before,
  };
  if (!action.isApplied)
    return log(
      { ...t, proposal },
      {
        at: now,
        who: action.by,
        kind: 'event',
        text: `Proposed a goal: ${action.goal}`,
        detail: action.basis,
      },
    );
  return {
    ...withGoal(t, proposal, now, action.by),
    proposal: { ...proposal, state: 'applied' },
  };
}

/** Accept puts the proposal in place, Keep leaves the draft, Undo puts back what an applied proposal replaced. */
function decideProposal(
  t: Thread,
  decision: 'accept' | 'keep' | 'undo',
  now: number,
): Thread {
  const p = t.proposal;
  if (!p) return t;
  if (decision === 'keep')
    return log(
      { ...t, proposal: { ...p, state: 'kept' } },
      {
        at: now,
        who: 'you',
        kind: 'event',
        text: `Kept the draft goal: ${t.goal}`,
      },
    );
  if (decision === 'undo')
    return {
      ...withGoal(t, p.before, now, 'you'),
      proposal: { ...p, state: 'undone' },
    };
  return {
    ...withGoal(t, p, now, 'you'),
    proposal: { ...p, state: 'accepted' },
  };
}

function withGoal(
  t: Thread,
  goal: { goal: string; criteria: { text: string; command?: string }[] },
  now: number,
  by: Author,
): Thread {
  return applyDraft(
    t,
    { ...draftFrom(t), goal: goal.goal, criteria: goal.criteria },
    now,
    by,
  );
}

function checkCriterion(
  t: Thread,
  action: Extract<Action, { type: 'criterion-check' }>,
  now: number,
): Thread {
  const criterion = t.criteria?.find((c) => c.id === action.criterionId);
  if (!criterion) return t;
  const { result } = action;
  const check =
    result === 'running'
      ? { status: 'running' as const, at: now }
      : {
          status:
            result.exitCode === 0 ? ('passed' as const) : ('failed' as const),
          at: now,
          ms: result.ms,
          output: result.output,
        };
  const checked = {
    ...t,
    criteria: t.criteria!.map((c) =>
      c.id === criterion.id ? { ...c, check } : c,
    ),
  };
  if (check.status === 'running') return checked;
  return log(checked, {
    at: now,
    who: 'harness',
    kind: 'event',
    text: `Check ${check.status}: ${criterion.text}`,
    detail: `\`${criterion.command}\``,
  });
}

function handBack(
  state: State,
  action: Extract<Action, { type: 'subthread-handback' }>,
): State {
  const sub = state.threads.find((t) => t.id === action.threadId);
  if (!sub?.parent || sub.parent.handedBackAt !== undefined) return state;
  const { threadId: parentId, criterionId } = sub.parent;
  const by = sub.providers[0];
  const now = state.now;
  const threads = state.threads.map((t) => {
    if (t.id === sub.id)
      return { ...t, parent: { ...sub.parent!, handedBackAt: now } };
    if (t.id !== parentId) return t;
    const claimed = criterionId
      ? claimCriterion(
          t,
          {
            type: 'criterion-claim',
            threadId: t.id,
            criterionId,
            evidence: action.evidence,
            by,
          },
          now,
        )
      : t;
    return log(claimed, {
      at: now,
      who: 'harness',
      kind: 'event',
      text: `${sub.title} handed back`,
      subThread: { threadId: sub.id, title: sub.title, text: action.evidence },
    });
  });
  return { ...state, threads };
}

function claimCriterion(
  t: Thread,
  action: Extract<Action, { type: 'criterion-claim' }>,
  now: number,
): Thread {
  const criterion = t.criteria?.find((c) => c.id === action.criterionId);
  if (!criterion) return t;
  const criteria = t.criteria!.map((c) =>
    c.id === criterion.id
      ? { ...c, claim: { evidence: action.evidence, at: now, by: action.by } }
      : c,
  );
  return log(
    { ...t, criteria },
    {
      at: now,
      who: action.by,
      kind: 'event',
      text: `Done: ${criterion.text}`,
      detail: action.evidence,
    },
  );
}

function removeGoal(t: Thread, now: number): Thread {
  if (!t.goal) return { ...t, isGoalOff: true };
  return log(
    { ...t, goal: '', criteria: [], isGoalOff: true },
    { at: now, who: 'harness', kind: 'event', text: 'Goal removed' },
  );
}

function keepHere(t: Thread, now: number): Thread {
  const keeps = (t.drift?.keeps ?? 0) + 1;
  const isMuted = keeps >= KEEPS_TO_MUTE;
  const kept = {
    ...t,
    drift: { ...t.drift, isMuted: !!t.drift?.isMuted || isMuted, keeps },
  };
  return isMuted && !t.drift?.isMuted
    ? log(kept, {
        at: now,
        who: 'harness',
        kind: 'event',
        text: 'Drift guard off for this thread',
        detail: `You kept ${keeps} suggestions here`,
      })
    : kept;
}

/** A late verdict for a message sent while the classifier was out: the newest untagged message with that text. */
function tagSent(
  t: Thread,
  action: Extract<Action, { type: 'drift-verdict' }>,
  now: number,
): Thread {
  const i = t.activity.findLastIndex(
    (e) =>
      e.who === 'you' &&
      e.kind === 'message' &&
      !e.drift &&
      e.text === action.text,
  );
  const waiting = t.steering?.find(
    (s) => !s.entry.drift && s.entry.text === action.text,
  );
  if (i < 0 && waiting)
    return {
      ...t,
      steering: t.steering!.map((s) =>
        s === waiting
          ? {
              ...s,
              entry: { ...s.entry, drift: action.drift },
              reason: action.reason,
            }
          : s,
      ),
    };
  if (i < 0) return t;
  const activity = t.activity.map((e, j) =>
    j === i ? { ...e, drift: action.drift } : e,
  );
  return applyDrift({ ...t, activity }, action.drift, action.reason, now);
}

function applyDrift(
  t: Thread,
  drift: DriftKind,
  reason: string,
  now: number,
): Thread {
  return drift === 'off-goal'
    ? log(t, {
        at: now,
        who: 'harness',
        kind: 'event',
        text: 'Sent off-goal · not counted',
        detail: reason,
      })
    : t;
}

/** Off-goal prompt to a new thread. A finished goal is settled first: its review stays queued while a PR is open, otherwise it resolves. */
function answerGrant(
  thread: Thread,
  action: Extract<Action, { type: 'grant-answer' }>,
  now: number,
): Thread {
  const grant = findGrant(thread, action.grantId);
  if (!grant) return thread;
  if (action.answer === 'allow')
    return allowGrant(thread, grant.id, action.models ?? grant.models, now);
  const from = action.answer === 'deny' ? 'pending' : 'active';
  if (grant.state !== from) return thread;
  return updateGrant(thread, grant.id, () => ({
    state: action.answer === 'deny' ? 'denied' : 'revoked',
  }));
}

/** A proposal's thread, created as the agent resolved it: you stay where you are, and the card names it. */
function startProposal(
  state: State,
  action: Extract<Action, { type: 'proposal-start' }>,
): State {
  const thread = state.threads.find((t) => t.id === action.threadId);
  if (!thread || proposalBlocker(thread, action.proposalId, state.now))
    return state;
  const { proposal } = findProposal(thread, action.proposalId)!;
  const next = create(state, {
    type: 'create',
    spaceId: thread.spaceId,
    title: proposal.brief,
    name: proposal.title,
    ...proposal.create,
    isBackground: true,
  });
  const id = `new-${state.seq}`;
  return {
    ...next,
    threads: mapThread(next.threads, thread.id, (t) =>
      updateProposal(t, proposal.id, { state: 'started', threadId: id }),
    ),
  };
}

function driftNewThread(
  state: State,
  action: Extract<Action, { type: 'drift-new-thread' }>,
): State {
  const source = state.threads.find((t) => t.id === action.threadId);
  if (!source) return state;
  const now = state.now;
  const isGoalDone = hasGoal(source) && goalProgress(source).phase === 'ready';
  const hasOpenPr = source.prs.some((p) => p.state === 'open');
  const short =
    action.prompt.length > 40
      ? `${action.prompt.slice(0, 39)}…`
      : action.prompt;
  let next: State = state;
  if (isGoalDone) {
    const outcome = hasOpenPr
      ? 'its PR review stays in your queue'
      : 'review resolved';
    next = {
      ...next,
      threads: mapThread(next.threads, source.id, (t) =>
        log(markSettled(t, now), {
          at: now,
          who: 'harness',
          kind: 'event',
          text: `Goal done, settled to start a new thread; ${outcome}`,
        }),
      ),
      queue: next.queue.filter(
        (q) => q.threadId !== source.id || (hasOpenPr && q.kind === 'review'),
      ),
    };
  }
  next = {
    ...next,
    threads: mapThread(next.threads, source.id, (t) =>
      log(t, {
        at: now,
        who: 'harness',
        kind: 'event',
        text: 'Moved to a new thread',
        detail: `"${short}"`,
      }),
    ),
  };
  const branchFrom =
    action.branchFrom === 'current' ? source.repo?.branch : 'the base branch';
  // Branching off the current branch is a new worktree from it; off the base, the default.
  const workspace: WorkspaceDraft | undefined =
    source.repo && action.branchFrom === 'current'
      ? { mode: 'worktree', base: source.repo.branch }
      : undefined;
  return create(next, {
    type: 'create',
    spaceId: source.spaceId,
    title: action.prompt,
    provider: source.providers[0],
    project: projectRef(source.repo),
    branchFrom: source.repo ? branchFrom : undefined,
    controls: source.controls,
    isLive: !!source.live,
    workspace,
  });
}

/** A handoff of a live thread restarts it on the other provider: the old session and its limit don't carry over. */
function handoffLive(
  state: State,
  action: Extract<Action, { type: 'handoff' }>,
): State {
  return {
    ...state,
    threads: mapThread(state.threads, action.threadId, (t) =>
      t.live
        ? {
            ...t,
            status: 'running',
            session: undefined,
            controls: undefined,
            live: {
              ...t.live,
              isWorking: true,
              limit: undefined,
              isOnApiKey: undefined,
              isDetached: undefined,
            },
          }
        : t,
    ),
  };
}

function resumeText(
  thread: Thread,
  action: Extract<ThreadsAction, { type: 'resume' }>,
) {
  if (action.onApiKey) return 'Continuing on your API key, billed per use';
  const window = thread.live?.limit?.label;
  if (action.atReset)
    return `Resumed after the ${window ? `${window.toLowerCase()} ` : ''}limit reset`;
  return 'Resumed on the same account';
}
