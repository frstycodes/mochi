import { threadCwd } from '../host/cwd.ts';
import type { AgentStartOptions } from '../host/types/agent.ts';
import type { Provider, Thread } from '../model.ts';
import type { Action, State } from '../store/index.tsx';
import { agentOptions, controlsOf, DEFAULT_CONTROLS, type ThreadControls } from './controls.ts';

export const CONTINUE_PROMPT = 'Continue where you left off.';
/** The composer marks a held-key message with this in the transcript; the agent gets the message without it. */
export const QUEUED_PREFIX = 'Queued: ';

export type AgentCall = { method: 'start'; threadId: string; options: AgentStartOptions } | { method: 'send'; threadId: string; text: string } | { method: 'interrupt' | 'stop'; threadId: string };

/** The `host.agent` calls an action makes for live threads; demo threads make none. `next` is the state after the action. */
export function agentCalls(state: State, action: Action, next: () => State): AgentCall[] {
  switch (action.type) {
    case 'create':
    case 'drift-new-thread':
    case 'sidechat-promote':
      return next()
        .threads.filter((t) => t.live && !state.threads.some((s) => s.id === t.id))
        .flatMap((t) => start(t, t.providers[0], controlsOf(t), t.goal, { worktree: t.repo?.branch }));
    case 'send':
      return isLive(state, action.threadId) ? [{ method: 'send', threadId: action.threadId, text: action.text.replace(QUEUED_PREFIX, '') }] : [];
    case 'resume': {
      const thread = state.threads.find((t) => t.id === action.threadId);
      if (!thread?.live) return [];
      if (!action.onApiKey) return [{ method: 'send', threadId: thread.id, text: CONTINUE_PROMPT }];
      // Restarts the same session on the key: same account folder, so `resume` finds its transcript.
      return start(thread, thread.providers[0], controlsOf(thread), CONTINUE_PROMPT, { resume: thread.session?.id, useApiKey: true });
    }
    case 'interrupt':
      return isLive(state, action.threadId) ? [{ method: 'interrupt', threadId: action.threadId }] : [];
    case 'settle':
      return isLive(state, action.threadId) ? [{ method: 'stop', threadId: action.threadId }] : [];
    case 'handoff': {
      // GAP: a one-step handoff keeps the thread's agent; one agent per thread can't run a single step elsewhere yet.
      const thread = state.threads.find((t) => t.id === action.threadId);
      if (action.stepId || !thread?.live || thread.providers[0] === action.to) return [];
      // No model: the adapter picks the Settings default (Claude) or the harness's own (Codex).
      return [{ method: 'stop', threadId: thread.id }, ...start(thread, action.to, DEFAULT_CONTROLS[action.to], action.summary, { model: undefined })];
    }
    default:
      return [];
  }
}

function start(thread: Thread, provider: Provider, controls: ThreadControls, prompt: string, extra?: Pick<AgentStartOptions, 'model' | 'resume' | 'useApiKey' | 'worktree'>): AgentCall[] {
  // A project with no folder on disk can't run; a folderless chat runs in a folder main makes for it.
  const cwd = thread.live?.cwd ?? threadCwd(thread);
  if (thread.repo && !cwd) return [];
  return [{ method: 'start', threadId: thread.id, options: { provider, spaceId: thread.spaceId, cwd: cwd ?? null, prompt, ...agentOptions(controls, provider), ...extra } }];
}

function isLive(state: State, threadId: string) {
  return !!state.threads.find((t) => t.id === threadId)?.live;
}
