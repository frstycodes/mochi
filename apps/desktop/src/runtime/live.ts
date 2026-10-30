import { agentImage } from '../chat/images.ts';
import { interruptsToSend } from '../chat/queued.ts';
import type {
  AgentImage,
  AgentMoveOptions,
  AgentSendInput,
  AgentStartOptions,
  StartWorkspace,
} from '../host/types/agent.ts';
import { firstPrompt, type Provider, type Thread } from '../model.ts';
import { handoffBlocker } from '../rewind/handoff.ts';
import { pendingSwitch, providerOf } from '../rewind/switch.ts';
import {
  isUnstarted,
  startWorkspace,
  workspaceMode,
} from '../git/workspace.ts';
import { sourcePrompt } from '../sources.ts';
import { hasTempBranch, startTitleRequest } from '../utility/titles.ts';
import type { Action, State } from '../store/types.ts';
import { autofixSend } from '../schedule/slice.ts';
import {
  controlsOf,
  DEFAULT_CONTROLS,
  policyOf,
  type ThreadControls,
} from './controls.ts';
import { agentOptions } from './agentOptions.ts';
import { moveCall, withMoveNote } from './move.ts';
import { startEnv } from './startEnv.ts';
import { WAKE_PROMPT, withReports } from './subThreadReports.ts';
import {
  backgroundPrompt,
  backgroundSession,
  isRunning,
  reportOf,
  withNotes,
} from './subagents.ts';

export const CONTINUE_PROMPT = 'Continue where you left off.';

export type AgentCall =
  | { method: 'start'; threadId: string; options: AgentStartOptions }
  | { method: 'move'; threadId: string; options: AgentMoveOptions }
  | ({ method: 'send'; threadId: string } & AgentSendInput)
  | { method: 'compact'; threadId: string; focus: string }
  | { method: 'interrupt' | 'stop' | 'settle' | 'keepTitle'; threadId: string }
  | { method: 'stopTask'; threadId: string; taskId: string };

/** A call's `host.agent` arguments after the thread id, in the method's order. */
export function agentCallArgs(call: AgentCall): unknown[] {
  if (call.method === 'start' || call.method === 'move') return [call.options];
  if (call.method === 'send') {
    const { method: _, threadId: __, ...input } = call;
    return [input];
  }
  if (call.method === 'compact') return [call.focus];
  if (call.method === 'stopTask') return [call.taskId];
  return [];
}

/** The `host.agent` calls an action makes for live threads; demo threads make none. `next` is the state after the action. */
export function agentCalls(
  state: State,
  action: Action,
  next: () => State,
): AgentCall[] {
  switch (action.type) {
    case 'create':
      // A scheduled thread waits for its first run; main starts it then.
      if (action.schedule) return [];
    // falls through
    case 'proposal-start':
    case 'sidechat-promote': {
      const first =
        action.type === 'create'
          ? {
              prompt: action.prompt,
              skills: action.skills?.length ? action.skills : undefined,
            }
          : {};
      const sent =
        action.type === 'create'
          ? [
              ...(action.referenceImages ?? []),
              ...(action.images ?? []).map(agentImage),
            ]
          : [];
      const images = sent.length > 0 ? { images: sent } : {};
      return next()
        .threads.filter(
          (t) => t.live && !state.threads.some((s) => s.id === t.id),
        )
        .flatMap((t) =>
          start(
            t,
            t.providers[0],
            controlsOf(t),
            first.prompt ?? firstPrompt(t),
            {
              workspace: firstWorkspace(t),
              ...(first.skills && { skills: first.skills }),
              ...images,
            },
          ),
        );
    }
    case 'rename':
      return state.threads.find((t) => t.id === action.threadId)?.live
        ? [{ method: 'keepTitle', threadId: action.threadId }]
        : [];
    case 'send': {
      const thread = state.threads.find((t) => t.id === action.threadId);
      if (!thread?.live) return [];
      const text = withMoveNote(
        thread,
        withNotes(thread, withReports(thread, action.prompt ?? action.text)),
      );
      const images = action.images?.length ? { images: action.images } : {};
      const skills = action.skills?.length ? { skills: action.skills } : {};
      // Every message carries the thread's speed and permissions, so a change in the composer applies from the next one.
      const policy = thread.controls ? { policy: policyOf(thread) } : {};
      if (thread.live.isDetached || isSwitching(thread))
        return reattach(thread, text, undefined, images.images, skills.skills);
      const steer =
        action.steers && thread.live.isWorking
          ? { steer: true, ...(action.typed && { steerId: action.typed.id }) }
          : {};
      return [
        {
          method: 'send',
          threadId: thread.id,
          text,
          ...images,
          ...skills,
          ...policy,
          ...steer,
        },
      ];
    }
    case 'attach-project': {
      const before = state.threads.find((t) => t.id === action.threadId);
      const moved = next().threads.find((t) => t.id === action.threadId);
      return before?.live && !before.repo && moved?.repo ? moveCall(moved) : [];
    }
    case 'compact':
      return hasAgent(state, action.threadId)
        ? [
            {
              method: 'compact',
              threadId: action.threadId,
              focus: action.focus,
            },
          ]
        : [];
    case 'autofix':
    case 'autofix-set': {
      // Only what the reducer turned into a message (an event while Auto-fix is on, or turning it on) goes to the agent.
      const before = state.threads.find((t) => t.id === action.threadId);
      const said = next()
        .threads.find((t) => t.id === action.threadId)
        ?.activity.at(-1);
      if (!before || !said?.autofix || said === before.activity.at(-1))
        return [];
      const event =
        action.type === 'autofix'
          ? action.event
          : {
              kind: 'enabled' as const,
              pr: action.pr,
              url: before.prs.find((p) => p.number === action.pr)?.url,
            };
      const sent =
        event.kind !== 'stopped' && autofixSend(state, action.threadId, event);
      return sent ? agentCalls(state, sent, next) : [];
    }
    case 'source-add': {
      const thread = state.threads.find((t) => t.id === action.threadId);
      if (thread?.sources.some((s) => s.label === action.source.label))
        return [];
      return agentCalls(
        state,
        {
          type: 'send',
          threadId: action.threadId,
          text: sourcePrompt(action.source),
        },
        next,
      );
    }
    case 'resume': {
      const thread = state.threads.find((t) => t.id === action.threadId);
      if (!thread?.live) return [];
      if (thread.live.isDetached)
        return reattach(thread, CONTINUE_PROMPT, action.onApiKey);
      if (!action.onApiKey)
        return [{ method: 'send', threadId: thread.id, text: CONTINUE_PROMPT }];
      // Restarts the same session on the key: same account folder, so `resume` finds its transcript.
      return start(
        thread,
        thread.providers[0],
        controlsOf(thread),
        CONTINUE_PROMPT,
        { resume: thread.session?.id, useApiKey: true },
      );
    }
    case 'interrupt':
      return hasAgent(state, action.threadId)
        ? [{ method: 'interrupt', threadId: action.threadId }]
        : [];
    case 'steer-requeue': {
      const thread = state.threads.find((t) => t.id === action.threadId);
      return thread &&
        interruptsToSend(thread, action.ids) &&
        hasAgent(state, action.threadId)
        ? [{ method: 'interrupt', threadId: action.threadId }]
        : [];
    }
    case 'rewind':
    case 'rewind-message':
    case 'rewind-undo': {
      // The next message starts the agent again on the rewound session (`reattach`).
      const threadId =
        action.type === 'rewind-undo'
          ? state.rewindUndo?.threadId
          : action.threadId;
      return threadId && hasAgent(state, threadId)
        ? [{ method: 'stop', threadId }]
        : [];
    }
    // Main shuts down everything the thread started (its agents, terminals, dev servers), running or not.
    // Its open sub-threads at every depth settle with it (`threads.ts`), so their agents stop too.
    case 'settle': {
      const after = next().threads;
      return state.threads
        .filter(
          (t) =>
            t.live &&
            t.status !== 'settled' &&
            after.find((n) => n.id === t.id)?.status === 'settled',
        )
        .map((t) => ({ method: 'settle' as const, threadId: t.id }));
    }
    case 'delete':
      return action.threadIds
        .filter((id) => isLive(state, id))
        .map((threadId) => ({ method: 'settle' as const, threadId }));
    case 'bg-start': {
      const thread = state.threads.find((t) => t.id === action.threadId);
      if (!thread?.live) return [];
      const { agent } = action;
      const cwd = agent.hasOwnWorktree
        ? threadCwdRoot(thread)
        : runFolder(thread);
      if (cwd === undefined) return [];
      const controls =
        agent.provider === thread.providers[0]
          ? controlsOf(thread)
          : DEFAULT_CONTROLS[agent.provider];
      // Its own worktree branches off the thread's branch, so it starts from the thread's work.
      const workspace: StartWorkspace | undefined =
        agent.hasOwnWorktree && thread.repo
          ? {
              mode: 'worktree',
              branch: `${thread.repo.branch}-${agent.id}`,
              base: thread.repo.branch,
            }
          : undefined;
      const options: AgentStartOptions = {
        provider: agent.provider,
        spaceId: thread.spaceId,
        cwd,
        prompt: backgroundPrompt(agent),
        ...agentOptions(controls, agent.provider, thread.spaceId),
        ...(agent.model && { model: agent.model }),
        ...(workspace && { workspace }),
      };
      return [
        {
          method: 'start',
          threadId: backgroundSession(thread.id, agent.id),
          options,
        },
      ];
    }
    case 'bg-stop': {
      const subagent = state.threads
        .find((t) => t.id === action.threadId)
        ?.subagents?.find((s) => s.id === action.subagentId);
      if (!subagent || !isRunning(subagent)) return [];
      if (subagent.sessionId)
        return [{ method: 'stop', threadId: subagent.sessionId }];
      return hasAgent(state, action.threadId)
        ? [
            {
              method: 'stopTask',
              threadId: action.threadId,
              taskId: subagent.id,
            },
          ]
        : [];
    }
    case 'task-stop': {
      const task = state.threads
        .find((t) => t.id === action.threadId)
        ?.backgroundTasks?.find((t) => t.id === action.taskId);
      return task?.status === 'running' && hasAgent(state, action.threadId)
        ? [{ method: 'stopTask', threadId: action.threadId, taskId: task.id }]
        : [];
    }
    case 'delegate-report': {
      const subagent = state.threads
        .find((t) => t.id === action.threadId)
        ?.subagents?.find((s) => s.id === action.subagentId);
      if (!subagent?.sessionId) return [];
      // Its session ends with its first turn: the report is in, nobody will send it more.
      const report = agentCalls(
        state,
        {
          type: 'send',
          threadId: action.threadId,
          text: reportOf(subagent),
          steers: true,
        },
        next,
      );
      return [{ method: 'stop', threadId: subagent.sessionId }, ...report];
    }
    case 'subthread-wake':
      return agentCalls(
        state,
        {
          type: 'send',
          threadId: action.threadId,
          text: WAKE_PROMPT,
        },
        next,
      );
    case 'handoff': {
      // GAP: a one-step handoff keeps the thread's agent; one agent per thread can't run a single step elsewhere yet.
      const thread = state.threads.find((t) => t.id === action.threadId);
      if (!thread?.live || handoffBlocker(thread, action.to)) return [];
      // No model: the adapter picks the Settings default (Claude) or the harness's own (Codex).
      return [
        ...(thread.live.isDetached
          ? []
          : [{ method: 'stop' as const, threadId: thread.id }]),
        ...start(
          thread,
          action.to,
          DEFAULT_CONTROLS[action.to],
          action.summary,
          { model: undefined },
        ),
      ];
    }
    default:
      return [];
  }
}

/** Live threads `next` marks working that weren't, with no call to run that turn: nothing would ever end it, so it would think forever. */
export function unsentTurns(
  before: State,
  next: State,
  calls: AgentCall[],
): string[] {
  const called = new Set(calls.map((c) => c.threadId));
  const wasWorking = new Set(
    before.threads.filter((t) => t.live?.isWorking).map((t) => t.id),
  );
  return next.threads
    .filter(
      (t) => t.live?.isWorking && !wasWorking.has(t.id) && !called.has(t.id),
    )
    .map((t) => t.id);
}

function start(
  thread: Thread,
  provider: Provider,
  controls: ThreadControls,
  prompt: string,
  extra?: Partial<Pick<AgentStartOptions, 'cwd'>> &
    Pick<
      AgentStartOptions,
      | 'model'
      | 'resume'
      | 'forkAt'
      | 'useApiKey'
      | 'workspace'
      | 'images'
      | 'skills'
    >,
): AgentCall[] {
  const cwd = runFolder(thread);
  if (cwd === undefined) return [];
  return [
    {
      method: 'start',
      threadId: thread.id,
      options: {
        provider,
        spaceId: thread.spaceId,
        cwd,
        prompt,
        ...agentOptions(controls, provider, thread.spaceId),
        ...(thread.isSettingsChat && { isSettingsChat: true }),
        ...(thread.parent && { isSubThread: true }),
        ...extra,
      },
    },
  ];
}

/** A new thread's first start: its branch is its own, and main names it from its given title or first message before the agent starts. */
function firstWorkspace(thread: Thread): StartWorkspace | undefined {
  const workspace = startWorkspace(thread.repo);
  if (workspace?.mode !== 'worktree' || workspace.isExisting) return workspace;
  if (thread.isTitleRenamed && hasTempBranch(thread))
    return { ...workspace, isNew: true, title: thread.title };
  const titlePrompt = startTitleRequest(thread);
  return { ...workspace, isNew: true, ...(titlePrompt && { titlePrompt }) };
}

/**
 * How the scheduler starts this thread's agent: as a first start would, in the thread's worktree or project folder, named from its
 * first message before its first run (`triggerAfter` drops that once a run started). Undefined when it can't run.
 */
export function scheduledStart(
  thread: Thread,
): Omit<AgentStartOptions, 'prompt'> | undefined {
  const cwd = runFolder(thread);
  const provider = thread.session?.provider ?? thread.providers[0];
  if (cwd === undefined) return;
  const workspace = isUnstarted(thread)
    ? firstWorkspace(thread)
    : startWorkspace(thread.repo);
  return {
    provider,
    spaceId: thread.spaceId,
    cwd,
    workspace,
    ...agentOptions(controlsOf(thread), provider, thread.spaceId),
    ...(thread.parent && { isSubThread: true }),
  };
}

/** A project with no folder on disk can't run (undefined); a folderless chat (null) runs in a folder main makes for it. */
function runFolder(thread: Thread) {
  const cwd = startEnv().threadCwd(thread);
  if (thread.repo && !cwd) return undefined;
  return cwd ?? null;
}

/** A thread restored after a restart: its agent starts again on the session it had, with this message as the prompt. */
/** A send that found no agent process (it ended without Mochi noticing): start it again with `resume`, carrying the same message. */
export function resumeAfterLostProcess(
  thread: Thread,
  call: Extract<AgentCall, { method: 'send' }>,
): AgentCall[] {
  return thread.live
    ? reattach(thread, call.text, undefined, call.images, call.skills)
    : [];
}

function reattach(
  thread: Thread,
  prompt: string,
  onApiKey?: boolean,
  images?: AgentImage[],
  skills?: string[],
) {
  const provider = providerOf(thread);
  const restart = thread.live?.restart;
  const seed = restart && 'seed' in restart ? restart.seed : undefined;
  const switchFrom = pendingSwitch(thread);
  // A switch has no session of `provider` to resume here: Core keeps each provider's own and picks it (`ThreadContext`).
  const resume =
    seed === undefined && !switchFrom ? thread.session?.id : undefined;
  const forkAt = restart && 'forkAt' in restart ? restart.forkAt : undefined;
  // Cleanup removed its worktree, or a move made it: main makes it again (or finds it) on the same branch, at the same path, so `resume`
  // still finds the session.
  const remake =
    isCleanedUp(thread) || thread.live?.movedFrom
      ? {
          cwd: startEnv().projectRoot(thread.repo!),
          workspace: startWorkspace(thread.repo),
        }
      : {};
  return start(
    thread,
    provider,
    controlsOf(thread),
    seed ? `${seed}\n\n${prompt}` : prompt,
    {
      resume,
      ...(forkAt && { forkAt }),
      ...(switchFrom && { switchFrom }),
      useApiKey: onApiKey || thread.live?.isOnApiKey || undefined,
      ...(images && { images }),
      ...(skills && { skills }),
      ...remake,
    },
  );
}

/** A switch waits for your next message, which starts the new provider whether or not the old session still runs. */
const isSwitching = (thread: Thread) => !!pendingSwitch(thread);

/** A worktree thread whose agent ran in a worktree that's gone from the list (Settings › Git and worktrees cleanup, Clean up settled worktrees). */
function isCleanedUp(thread: Thread) {
  if (
    !thread.repo ||
    workspaceMode(thread.repo) !== 'worktree' ||
    !thread.live?.cwd
  )
    return false;
  const root = startEnv().projectRoot(thread.repo);
  return !!root && thread.live.cwd !== root && !startEnv().worktreePath(thread);
}

/** The project folder itself, where a worktree of a new branch is made; a folderless chat has none. */
function threadCwdRoot(thread: Thread) {
  return thread.repo
    ? (startEnv().projectRoot(thread.repo) ?? undefined)
    : undefined;
}

/** A real thread, not a demo one; its agent may or may not run in this launch. */
function isLive(state: State, threadId: string) {
  return !!state.threads.find((t) => t.id === threadId)?.live;
}

/** A live thread whose agent runs in this launch of Mochi. */
function hasAgent(state: State, threadId: string) {
  const live = state.threads.find((t) => t.id === threadId)?.live;
  return !!live && !live.isDetached;
}
