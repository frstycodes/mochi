import type { AgentEvent, AgentSubagentEvent } from '../host/types/agent.ts';
import type { Provider, Subagent, SubagentStep, Thread } from '../model.ts';
import type { State } from '../store/index.tsx';
import { log, mapThread } from '../store/threads.ts';

/** A Mochi background agent to start for a thread (`start_background_agent`). */
export interface BackgroundStart {
  id: string;
  name: string;
  prompt: string;
  provider: Provider;
  model?: string;
  /** A worktree of its own on a new branch, else the parent's worktree, shared. */
  hasOwnWorktree: boolean;
}

/** Folds a `subagent` event into its thread: a row in `subagents` plus, on start, the activity entry the chat shows it at. */
export function applySubagent(state: State, thread: Thread, event: AgentSubagentEvent, provider: Provider): State {
  const now = state.now;
  const existing = thread.subagents?.find((s) => s.id === event.id);
  const update = (fn: (t: Thread) => Thread): State => ({
    ...state,
    threads: mapThread(state.threads, thread.id, fn),
  });
  if (event.phase === 'start') {
    if (existing) return state;
    const subagent: Subagent = {
      id: event.id,
      origin: 'native',
      provider,
      name: event.name ?? 'Agent',
      isBackground: !!event.isBackground,
      status: 'running',
      startedAt: Date.now(),
      tokens: 0,
      steps: [],
    };
    return update((t) =>
      log(
        { ...t, subagents: [...(t.subagents ?? []), patch(subagent, event)] },
        {
          at: now,
          who: provider,
          kind: 'subagent',
          text: subagent.name,
          subagentId: subagent.id,
        },
      ),
    );
  }
  // The first end wins: Codex ends a spawned agent on its parent and on its own thread, Claude on the tool result and the task.
  if (existing?.status !== 'running') return state;
  const next = patch(existing, event);
  let after = update((t) => ({
    ...t,
    subagents: t.subagents!.map((s) => (s.id === event.id ? next : s)),
    steps: withFootprint(t, event.step?.files),
  }));
  if (event.phase === 'end' && next.origin === 'mochi') after = reportBack(after, thread.id, next);
  return after;
}

/** Events from a Mochi background agent's own session, folded into its parent; null when `event` is not from one. */
export function fromBackground(state: State, event: AgentEvent, apply: (state: State, event: AgentEvent) => State): State | null {
  const owner = state.threads.find((t) => t.subagents?.some((s) => s.sessionId === event.threadId));
  if (!owner) return null;
  const subagent = owner.subagents!.find((s) => s.sessionId === event.threadId)!;
  const as = (fields: Omit<AgentSubagentEvent, 'threadId' | 'type' | 'id'>) =>
    apply(state, {
      threadId: owner.id,
      type: 'subagent',
      id: subagent.id,
      ...fields,
    });
  switch (event.type) {
    case 'worktree':
      return as({ phase: 'progress', cwd: event.path });
    case 'message':
      return as({
        phase: 'progress',
        message: event.text,
        isDelta: event.isDelta,
      });
    case 'tool':
      return as({
        phase: 'progress',
        step: {
          id: event.id,
          phase: event.phase,
          text: event.text,
          ...(event.files && { files: event.files }),
          ...(event.exitCode !== undefined && { exitCode: event.exitCode }),
        },
      });
    case 'usage': {
      const tokens = event.inputTokens + event.outputTokens;
      // Its spend is the thread's; its context is its own, so the thread's meter stays put.
      const spent = apply(state, {
        threadId: owner.id,
        type: 'usage',
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        ...(event.costUsd !== undefined && { costUsd: event.costUsd }),
      });
      return apply(spent, {
        threadId: owner.id,
        type: 'subagent',
        id: subagent.id,
        phase: 'progress',
        tokens: subagent.tokens + tokens,
      });
    }
    case 'approval':
      return apply(state, {
        ...event,
        threadId: owner.id,
        title: `${subagent.name}: ${event.title}`,
      });
    case 'question':
    case 'resolved':
      return apply(state, { ...event, threadId: owner.id });
    case 'limit':
      return as({
        phase: 'end',
        status: 'failed',
        error: 'Usage limit reached',
      });
    case 'turn-end':
      return as({
        phase: 'end',
        status: event.status === 'done' ? 'done' : event.status === 'failed' ? 'failed' : 'stopped',
        ...(event.error && { error: event.error }),
      });
    default:
      return state;
  }
}

/** Adds a Mochi background agent to its thread, running; `agentCalls` starts its session. */
export function startBackground(state: State, threadId: string, start: BackgroundStart): State {
  const thread = state.threads.find((t) => t.id === threadId);
  if (!thread) return state;
  const started = applySubagent(
    state,
    thread,
    {
      threadId,
      type: 'subagent',
      id: start.id,
      phase: 'start',
      name: start.name,
      prompt: start.prompt,
      isBackground: true,
      ...(start.model && { model: start.model }),
    },
    start.provider,
  );
  const fields = {
    origin: 'mochi',
    sessionId: backgroundSession(threadId, start.id),
    hasOwnWorktree: start.hasOwnWorktree,
  } satisfies Partial<Subagent>;
  return {
    ...started,
    threads: mapThread(started.threads, threadId, (t) => ({
      ...t,
      subagents: t.subagents?.map((s) => (s.id === start.id ? { ...s, ...fields } : s)),
    })),
  };
}

/** Its own agent session's id in `host.agent`; main allows only letters, digits, - and _ (it names folders after it). */
export function backgroundSession(threadId: string, id: string) {
  return `${threadId}--${id}`;
}

/** What a background agent is asked: the task, and that its last message is its report. */
export function backgroundPrompt(start: BackgroundStart) {
  return `${start.prompt}\n\nYou are a background agent started by another agent's thread. Work on your own; nobody can answer questions. End with a short report of what you did and found: it is sent back to that thread.`;
}

/** The notes a thread's agent gets ahead of the next message, then cleared; a note the message already carries ("Send to thread") isn't repeated. */
export function withNotes(thread: Thread, text: string) {
  const notes = (thread.live?.notes ?? []).filter((n) => !text.includes(n));
  if (!notes.length) return text;
  // A `/command` only runs from the very start of the message.
  return text.startsWith('/') ? `${text}\n\n${notes.join('\n\n')}` : `${notes.join('\n\n')}\n\n${text}`;
}

/** How a finished agent's report reads to the parent's agent. */
export function reportOf(s: Subagent) {
  return `[${s.origin === 'mochi' ? 'Background agent' : 'Subagent'} "${s.name}" ${VERDICT[s.status]}${s.error ? `: ${s.error}` : ''}]${s.result ? `\n${s.result}` : ''}`;
}

const VERDICT = {
  done: 'finished',
  failed: 'failed',
  stopped: 'was stopped',
  running: 'is running',
} satisfies Record<Subagent['status'], string>;

/** A report's first line as plain text: markdown marks and link targets dropped. */
export function oneLine(text?: string) {
  const line = text?.split('\n').find((l) => l.trim()) ?? '';
  return line
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .replace(/^\s*(#+|[-+>]|\d+\.)\s+/, '')
    .trim();
}

export const isRunning = (s: Subagent) => s.status === 'running';

/** Background agents still running; foreground subagents end with their turn, so they don't count. */
export function runningBackground(thread: Thread) {
  return (thread.subagents ?? []).filter((s) => s.isBackground && isRunning(s)).length;
}

function patch(s: Subagent, e: AgentSubagentEvent): Subagent {
  const next: Subagent = { ...s };
  if (e.name) next.name = e.name;
  if (e.prompt) next.prompt = e.prompt;
  if (e.model) next.model = e.model;
  if (e.toolId) next.toolId = e.toolId;
  if (e.isBackground !== undefined) next.isBackground = e.isBackground;
  if (e.activity) next.activity = e.activity;
  if (e.tokens !== undefined) next.tokens = e.tokens;
  if (e.cwd) next.cwd = e.cwd;
  if (e.error) next.error = e.error;
  if (e.message) next.message = e.isDelta ? (s.message ?? '') + e.message : e.message;
  if (e.step) next.steps = withStep(s.steps, e.step);
  if (e.phase !== 'end') return next;
  return {
    ...next,
    status: e.status ?? 'done',
    endedAt: Date.now(),
    activity: undefined,
    result: e.result ?? next.message,
  };
}

function withStep(steps: SubagentStep[], step: NonNullable<AgentSubagentEvent['step']>): SubagentStep[] {
  const done = {
    ...(step.files && { files: step.files }),
    ...(step.exitCode !== undefined && { exitCode: step.exitCode }),
    ...(step.output !== undefined && { output: step.output }),
    ...(step.patch && { patch: step.patch }),
  };
  const started = { id: step.id, text: step.text, isDone: false, ...(step.description && { description: step.description }) };
  if (step.phase === 'start') return steps.some((s) => s.id === step.id) ? steps : [...steps, started];
  if (!steps.some((s) => s.id === step.id)) return [...steps, { id: step.id, text: step.text, isDone: true, ...done }];
  return steps.map((s) => (s.id === step.id ? { ...s, text: step.text, isDone: true, ...done } : s));
}

/** Files a subagent edits count toward the parent's running step, so overlap detection sees them. */
function withFootprint(t: Thread, files?: string[]) {
  if (!files?.length) return t.steps;
  return t.steps.map((s) => (s.status === 'running' ? { ...s, footprint: [...new Set([...s.footprint, ...files])] } : s));
}

/** A finished background agent tells its thread: a line in the chat now, and a note its agent gets with your next message. */
function reportBack(state: State, threadId: string, s: Subagent): State {
  return {
    ...state,
    threads: mapThread(state.threads, threadId, (t) =>
      log(
        {
          ...t,
          live: t.live && {
            ...t.live,
            notes: [...(t.live.notes ?? []), reportOf(s)],
          },
        },
        {
          at: state.now,
          who: 'harness',
          kind: 'event',
          text: `Background agent "${s.name}" ${VERDICT[s.status]}`,
          detail: 'Its report goes to the agent with your next message.',
        },
      ),
    ),
  };
}
