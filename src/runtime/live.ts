import { threadCwd } from '../host/cwd.ts';
import type { AgentImage, AgentStartOptions } from '../host/types/agent.ts';
import type { Provider, Thread } from '../model.ts';
import type { Action, State } from '../store/index.tsx';
import { agentOptions, controlsOf, DEFAULT_CONTROLS, type ThreadControls } from './controls.ts';

export const CONTINUE_PROMPT = 'Continue where you left off.';
/** The composer marks a held-key message with this in the transcript; the agent gets the message without it. */
export const QUEUED_PREFIX = 'Queued: ';

export type AgentCall = { method: 'start'; threadId: string; options: AgentStartOptions } | { method: 'send'; threadId: string; text: string; images?: AgentImage[] } | { method: 'interrupt' | 'stop'; threadId: string };

/** The `host.agent` calls an action makes for live threads; demo threads make none. `next` is the state after the action. */
export function agentCalls(state: State, action: Action, next: () => State): AgentCall[] {
  switch (action.type) {
    case 'create':
      // A scheduled thread waits for its first run; main starts it then.
      if (action.schedule) return [];
    // falls through
    case 'drift-new-thread':
    case 'sidechat-promote':
      return next()
        .threads.filter((t) => t.live && !state.threads.some((s) => s.id === t.id))
        .flatMap((t) => start(t, t.providers[0], controlsOf(t), t.goal, { worktree: t.repo?.branch }));
    case 'send': {
      const thread = state.threads.find((t) => t.id === action.threadId);
      const text = action.prompt ?? action.text.replace(QUEUED_PREFIX, '');
      const images = action.images?.length ? { images: action.images } : {};
      if (!thread?.live) return [];
      return thread.live.isDetached ? reattach(thread, text, undefined, images.images) : [{ method: 'send', threadId: thread.id, text, ...images }];
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
    case 'settle':
      return hasAgent(state, action.threadId) ? [{ method: 'stop', threadId: action.threadId }] : [];
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

function start(thread: Thread, provider: Provider, controls: ThreadControls, prompt: string, extra?: Pick<AgentStartOptions, 'model' | 'resume' | 'useApiKey' | 'worktree' | 'images'>): AgentCall[] {
  const cwd = runFolder(thread);
  if (cwd === undefined) return [];
  return [{ method: 'start', threadId: thread.id, options: { provider, spaceId: thread.spaceId, cwd, prompt, ...agentOptions(controls, provider), ...extra } }];
}

/** How the scheduler starts this thread's agent: as a first start would, in the thread's worktree. Undefined when it can't run. */
export function scheduledStart(thread: Thread): Omit<AgentStartOptions, 'prompt'> | undefined {
  const cwd = runFolder(thread);
  const provider = thread.session?.provider ?? thread.providers[0];
  if (cwd === undefined) return;
  return { provider, spaceId: thread.spaceId, cwd, worktree: thread.repo?.branch, ...agentOptions(controlsOf(thread), provider) };
}

/** A project with no folder on disk can't run (undefined); a folderless chat (null) runs in a folder main makes for it. */
function runFolder(thread: Thread) {
  const cwd = thread.live?.cwd ?? threadCwd(thread);
  if (thread.repo && !cwd) return undefined;
  return cwd ?? null;
}

/** A thread restored after a restart: its agent starts again on the session it had, with this message as the prompt. */
function reattach(thread: Thread, prompt: string, onApiKey?: boolean, images?: AgentImage[]) {
  const provider = thread.session?.provider ?? thread.providers[0];
  return start(thread, provider, controlsOf(thread), prompt, { resume: thread.session?.id, useApiKey: onApiKey || thread.live?.isOnApiKey || undefined, ...(images && { images }) });
}

/** A live thread whose agent runs in this launch of Mochi. */
function hasAgent(state: State, threadId: string) {
  const live = state.threads.find((t) => t.id === threadId)?.live;
  return !!live && !live.isDetached;
}
