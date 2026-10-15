import { agentImage } from '../chat/images.ts';
import { projectRoot, threadCwd } from '../host/cwd.ts';
import type { AgentImage, AgentStartOptions, StartWorkspace } from '../host/types/agent.ts';
import { firstPrompt, type Provider, type Thread } from '../model.ts';
import { startWorkspace, workspaceMode } from '../git/workspace.ts';
import { worktreePath } from '../git/worktrees.ts';
import { sourcePrompt } from '../sources.ts';
import type { Action, State } from '../store/index.tsx';
import { agentOptions, controlsOf, DEFAULT_CONTROLS, type ThreadControls } from './controls.ts';
import { backgroundPrompt, backgroundSession, isRunning, withNotes } from './subagents.ts';

export const CONTINUE_PROMPT = 'Continue where you left off.';

export type AgentCall =
  | { method: 'start'; threadId: string; options: AgentStartOptions }
  | { method: 'send'; threadId: string; text: string; images?: AgentImage[]; skills?: string[]; speed?: string; steer?: boolean }
  | { method: 'compact'; threadId: string; focus: string }
  | { method: 'interrupt' | 'stop'; threadId: string }
  | { method: 'stopSubagent'; threadId: string; subagentId: string };

/** The `host.agent` calls an action makes for live threads; demo threads make none. `next` is the state after the action. */
export function agentCalls(state: State, action: Action, next: () => State): AgentCall[] {
  switch (action.type) {
    case 'create':
      // A scheduled thread waits for its first run; main starts it then.
      if (action.schedule) return [];
    // falls through
    case 'drift-new-thread':
    case 'sidechat-promote': {
      const first = action.type === 'create' ? { prompt: action.prompt, skills: action.skills?.length ? action.skills : undefined } : {};
      const sent = action.type === 'create' ? [...(action.referenceImages ?? []), ...(action.images ?? []).map(agentImage)] : [];
      const images = sent.length > 0 ? { images: sent } : {};
      return next()
        .threads.filter((t) => t.live && !state.threads.some((s) => s.id === t.id))
        .flatMap((t) => start(t, t.providers[0], controlsOf(t), first.prompt ?? firstPrompt(t), { workspace: startWorkspace(t.repo), ...(first.skills && { skills: first.skills }), ...images }));
    }
    case 'send': {
      const thread = state.threads.find((t) => t.id === action.threadId);
      if (!thread?.live) return [];
      const text = withNotes(thread, action.prompt ?? action.text);
      const images = action.images?.length ? { images: action.images } : {};
      const skills = action.skills?.length ? { skills: action.skills } : {};
      // Every message carries the thread's speed, so a change in the composer applies from the next one.
      const speed = thread.controls ? { speed: controlsOf(thread).speed } : {};
      if (thread.live.isDetached) return reattach(thread, text, undefined, images.images, skills.skills);
      const steer = action.steers && thread.live.isWorking ? { steer: true } : {};
      return [{ method: 'send', threadId: thread.id, text, ...images, ...skills, ...speed, ...steer }];
    }
    case 'compact':
      return hasAgent(state, action.threadId) ? [{ method: 'compact', threadId: action.threadId, focus: action.focus }] : [];
    case 'source-add': {
      const thread = state.threads.find((t) => t.id === action.threadId);
      if (thread?.sources.some((s) => s.label === action.source.label)) return [];
      return agentCalls(state, { type: 'send', threadId: action.threadId, text: sourcePrompt(action.source), reason: '' }, next);
    }
    case 'resume': {
      const thread = state.threads.find((t) => t.id === action.threadId);
      if (!thread?.live) return [];
      if (thread.live.isDetached) return reattach(thread, CONTINUE_PROMPT, action.onApiKey);
      if (!action.onApiKey) return [{ method: 'send', threadId: thread.id, text: CONTINUE_PROMPT }];
      // Restarts the same session on the key: same account folder, so `resume` finds its transcript.
      return start(thread, thread.providers[0], controlsOf(thread), CONTINUE_PROMPT, { resume: thread.session?.id, useApiKey: true });
    }
    case 'interrupt':
      return hasAgent(state, action.threadId) ? [{ method: 'interrupt', threadId: action.threadId }] : [];
    case 'rewind':
    case 'rewind-message':
    case 'rewind-undo': {
      // The next message starts the agent again on the rewound session (`reattach`).
      const threadId = action.type === 'rewind-undo' ? state.rewindUndo?.threadId : action.threadId;
      return threadId && hasAgent(state, threadId) ? [{ method: 'stop', threadId }] : [];
    }
    case 'settle':
      return [...(hasAgent(state, action.threadId) ? [{ method: 'stop' as const, threadId: action.threadId }] : []), ...stopBackground(state, [action.threadId])];
    case 'delete':
      return [...action.threadIds.filter((id) => hasAgent(state, id)).map((threadId) => ({ method: 'stop' as const, threadId })), ...stopBackground(state, action.threadIds)];
    case 'bg-start': {
      const thread = state.threads.find((t) => t.id === action.threadId);
      if (!thread?.live) return [];
      const { agent } = action;
      const cwd = agent.hasOwnWorktree ? threadCwdRoot(thread) : runFolder(thread);
      if (cwd === undefined) return [];
      const controls = agent.provider === thread.providers[0] ? controlsOf(thread) : DEFAULT_CONTROLS[agent.provider];
      // Its own worktree branches off the thread's branch, so it starts from the thread's work.
      const workspace: StartWorkspace | undefined = agent.hasOwnWorktree && thread.repo ? { mode: 'worktree', branch: `${thread.repo.branch}-${agent.id}`, base: thread.repo.branch } : undefined;
      const options: AgentStartOptions = { provider: agent.provider, spaceId: thread.spaceId, cwd, prompt: backgroundPrompt(agent), ...agentOptions(controls, agent.provider), ...(agent.model && { model: agent.model }), ...(workspace && { workspace }) };
      return [{ method: 'start', threadId: backgroundSession(thread.id, agent.id), options }];
    }
    case 'bg-stop': {
      const subagent = state.threads.find((t) => t.id === action.threadId)?.subagents?.find((s) => s.id === action.subagentId);
      if (!subagent || !isRunning(subagent)) return [];
      if (subagent.sessionId) return [{ method: 'stop', threadId: subagent.sessionId }];
      return hasAgent(state, action.threadId) ? [{ method: 'stopSubagent', threadId: action.threadId, subagentId: subagent.id }] : [];
    }
    case 'agent': {
      // A background agent's session ends with its first turn: the report is in, nobody will send it more.
      const { event } = action;
      if (event.type !== 'turn-end' && event.type !== 'limit') return [];
      const isBackground = state.threads.some((t) => t.subagents?.some((s) => s.sessionId === event.threadId && isRunning(s)));
      return isBackground ? [{ method: 'stop', threadId: event.threadId }] : [];
    }
    case 'handoff': {
      // GAP: a one-step handoff keeps the thread's agent; one agent per thread can't run a single step elsewhere yet.
      const thread = state.threads.find((t) => t.id === action.threadId);
      if (action.stepId || !thread?.live || thread.providers[0] === action.to) return [];
      // No model: the adapter picks the Settings default (Claude) or the harness's own (Codex).
      return [...(thread.live.isDetached ? [] : [{ method: 'stop' as const, threadId: thread.id }]), ...start(thread, action.to, DEFAULT_CONTROLS[action.to], action.summary, { model: undefined })];
    }
    default:
      return [];
  }
}

function start(thread: Thread, provider: Provider, controls: ThreadControls, prompt: string, extra?: Partial<Pick<AgentStartOptions, 'cwd'>> & Pick<AgentStartOptions, 'model' | 'resume' | 'forkAt' | 'useApiKey' | 'workspace' | 'images' | 'skills'>): AgentCall[] {
  const cwd = runFolder(thread);
  if (cwd === undefined) return [];
  return [{ method: 'start', threadId: thread.id, options: { provider, spaceId: thread.spaceId, cwd, prompt, ...agentOptions(controls, provider), ...extra } }];
}

/** How the scheduler starts this thread's agent: as a first start would, in the thread's worktree or project folder. Undefined when it can't run. */
export function scheduledStart(thread: Thread): Omit<AgentStartOptions, 'prompt'> | undefined {
  const cwd = runFolder(thread);
  const provider = thread.session?.provider ?? thread.providers[0];
  if (cwd === undefined) return;
  return { provider, spaceId: thread.spaceId, cwd, workspace: startWorkspace(thread.repo), ...agentOptions(controlsOf(thread), provider) };
}

/** A project with no folder on disk can't run (undefined); a folderless chat (null) runs in a folder main makes for it. */
function runFolder(thread: Thread) {
  const cwd = threadCwd(thread);
  if (thread.repo && !cwd) return undefined;
  return cwd ?? null;
}

/** A thread restored after a restart: its agent starts again on the session it had, with this message as the prompt. */
/** A send that found no agent process (it ended without Mochi noticing): start it again with `resume`, carrying the same message. */
export function resumeAfterLostProcess(thread: Thread, call: Extract<AgentCall, { method: 'send' }>): AgentCall[] {
  return thread.live ? reattach(thread, call.text, undefined, call.images, call.skills) : [];
}

function reattach(thread: Thread, prompt: string, onApiKey?: boolean, images?: AgentImage[], skills?: string[]) {
  const provider = thread.session?.provider ?? thread.providers[0];
  const restart = thread.live?.restart;
  const seed = restart && 'seed' in restart ? restart.seed : undefined;
  const resume = seed === undefined ? thread.session?.id : undefined;
  const forkAt = restart && 'forkAt' in restart ? restart.forkAt : undefined;
  // Cleanup removed its worktree: main makes it again on the same branch, at the same path, so `resume` still finds the session.
  const remake = isCleanedUp(thread) ? { cwd: projectRoot(thread.repo!), workspace: startWorkspace(thread.repo) } : {};
  return start(thread, provider, controlsOf(thread), seed ? `${seed}\n\n${prompt}` : prompt, { resume, ...(forkAt && { forkAt }), useApiKey: onApiKey || thread.live?.isOnApiKey || undefined, ...(images && { images }), ...(skills && { skills }), ...remake });
}

/** A worktree thread whose agent ran in a worktree that's gone from the list (Settings › Git cleanup, Clean up settled worktrees). */
function isCleanedUp(thread: Thread) {
  if (!thread.repo || workspaceMode(thread.repo) !== 'worktree' || !thread.live?.cwd) return false;
  const root = projectRoot(thread.repo);
  return !!root && thread.live.cwd !== root && !worktreePath(thread.id);
}

/** Mochi background agents of these threads that are still running. */
function stopBackground(state: State, threadIds: string[]): AgentCall[] {
  return state.threads.filter((t) => threadIds.includes(t.id)).flatMap((t) => (t.subagents ?? []).flatMap((s) => (s.sessionId && isRunning(s) ? [{ method: 'stop' as const, threadId: s.sessionId }] : [])));
}

/** The project folder itself, where a worktree of a new branch is made; a folderless chat has none. */
function threadCwdRoot(thread: Thread) {
  return thread.repo ? (projectRoot(thread.repo) ?? undefined) : undefined;
}

/** A live thread whose agent runs in this launch of Mochi. */
function hasAgent(state: State, threadId: string) {
  const live = state.threads.find((t) => t.id === threadId)?.live;
  return !!live && !live.isDetached;
}
