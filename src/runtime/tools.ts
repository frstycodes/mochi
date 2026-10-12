import { STEP_STATUSES, type AgentToolCall, type AgentToolResult } from '../host/types/agent.ts';
import type { Provider, Size, StepStatus, Thread } from '../model.ts';
import { draftFrom } from '../goals/edit.ts';
import { projectRef } from '../projects.ts';
import type { Action, State } from '../store/index.tsx';

type Reduce = (state: State, action: Action) => State;
type Outcome = { action?: Action; result: (next: State) => unknown };

/**
 * Runs a Mochi tool an agent called, as the store action the UI would dispatch for the same change. `reduce` is the
 * store's reducer; `next` is the state after `action`, so the caller dispatches `action` and keeps `next` as current.
 * An agent only sees and changes threads in its own thread's profile.
 */
export function runTool(state: State, call: AgentToolCall, reduce: Reduce): { action?: Action; next: State; result: AgentToolResult } {
  const caller = state.threads.find((t) => t.id === call.threadId);
  if (!caller) return { next: state, result: { text: `No thread ${call.threadId}`, isError: true } };
  if (!Object.hasOwn(TOOLS, call.name)) return { next: state, result: { text: `No Mochi tool ${call.name}`, isError: true } };
  try {
    const { action, result }: Outcome = TOOLS[call.name as ToolName](state, caller, call.args);
    const next = action ? reduce(state, action) : state;
    return { action, next, result: { text: JSON.stringify(result(next)) } };
  } catch (error) {
    return { next: state, result: { text: error instanceof Error ? error.message : String(error), isError: true } };
  }
}

const TOOLS = {
  get_goal(state, caller, args) {
    const thread = target(state, caller, args.threadId);
    return { result: () => goalOf(thread) };
  },
  set_step_status(state, caller, args) {
    const thread = target(state, caller, args.threadId);
    const step = thread.steps.find((s) => s.id === args.stepId);
    if (!step) throw new Error(`No step ${String(args.stepId)} in "${thread.title}"; get_goal lists the step ids`);
    if (!STEP_STATUSES.includes(args.status as StepStatus)) throw new Error(`status must be one of ${STEP_STATUSES.join(', ')}`);
    const action: Action = { type: 'step-status', threadId: thread.id, stepId: step.id, status: args.status as StepStatus, by: caller.providers[0] };
    return { action, result: (next) => goalOf(threadIn(next, thread.id)) };
  },
  add_step(state, caller, args) {
    const thread = target(state, caller, args.threadId);
    const title = String(args.title ?? '').trim();
    if (!title) throw new Error('title is required');
    const size = (args.size ?? 1) as Size;
    if (![1, 2, 3].includes(size)) throw new Error('size must be 1, 2 or 3');
    const draft = draftFrom(thread);
    draft.steps.push({ title, size, gate: false, isRemoved: false, isLocked: false });
    const action: Action = { type: 'edit-goal', threadId: thread.id, draft, by: caller.providers[0] };
    return { action, result: (next) => goalOf(threadIn(next, thread.id)) };
  },
  list_threads(state, caller) {
    return { result: () => state.threads.filter((t) => t.spaceId === caller.spaceId).map(summary) };
  },
  create_thread(state, caller, args) {
    const prompt = String(args.prompt ?? '').trim();
    if (!prompt) throw new Error('prompt is required');
    const provider = (args.provider ?? caller.providers[0]) as Provider;
    if (provider !== 'claude' && provider !== 'codex') throw new Error('provider must be claude or codex');
    const action: Action = {
      type: 'create',
      title: prompt,
      provider,
      project: projectRef(caller.repo),
      controls: provider === caller.providers[0] ? caller.controls : undefined,
      isLive: !!caller.live,
      isBackground: true,
    };
    return { action, result: (next) => summary(next.threads.find((t) => !state.threads.some((s) => s.id === t.id))!) };
  },
} satisfies Record<string, (state: State, caller: Thread, args: Record<string, unknown>) => Outcome>;

export type ToolName = keyof typeof TOOLS;

function target(state: State, caller: Thread, threadId: unknown) {
  if (threadId === undefined) return caller;
  const thread = state.threads.find((t) => t.id === threadId && t.spaceId === caller.spaceId);
  if (!thread) throw new Error(`No thread ${String(threadId)} in this profile; list_threads lists them`);
  return thread;
}

function threadIn(state: State, id: string) {
  return state.threads.find((t) => t.id === id)!;
}

function goalOf(thread: Thread) {
  return { threadId: thread.id, title: thread.title, goal: thread.goal, status: thread.status, steps: thread.steps.map((s) => ({ id: s.id, title: s.title, status: s.status, size: s.size })) };
}

function summary(thread: Thread) {
  return { id: thread.id, title: thread.title, status: thread.status, provider: thread.providers[0], project: thread.repo?.project ?? null };
}
