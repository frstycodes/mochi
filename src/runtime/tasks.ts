import type { AgentTaskEvent, BackgroundTaskKind, SubagentStatus } from '../host/types/agent.ts';
import type { BackgroundTask, Provider, Subagent, Thread } from '../model.ts';
import type { Action, State } from '../store/types.ts';
import { mapThread } from '../store/threads.ts';
import { wallNow } from '../store/context.ts';

/** Folds a `task` event into its thread's `backgroundTasks`. The first end wins, like subagents'. */
export function applyTask(state: State, thread: Thread, event: AgentTaskEvent, provider: Provider): State {
  const existing = thread.backgroundTasks?.find((t) => t.id === event.id);
  const update = (fn: (tasks: BackgroundTask[]) => BackgroundTask[]): State => ({
    ...state,
    threads: mapThread(state.threads, thread.id, (t) => ({ ...t, backgroundTasks: fn(t.backgroundTasks ?? []) })),
  });
  if (event.phase === 'start') {
    if (existing) return state;
    const task: BackgroundTask = {
      id: event.id,
      kind: event.kind ?? 'shell',
      provider,
      title: event.title || event.command || 'Task',
      status: 'running',
      startedAt: wallNow(),
      ...(event.command && { command: event.command }),
      ...(event.outputFile && { outputFile: event.outputFile }),
    };
    return update((tasks) => [...tasks, task]);
  }
  if (existing?.status !== 'running') return state;
  const next: BackgroundTask = {
    ...existing,
    ...(event.outputFile && { outputFile: event.outputFile }),
    ...(event.phase === 'end' && { status: event.status ?? 'done', endedAt: wallNow(), ...(event.exitCode !== undefined && { exitCode: event.exitCode }) }),
  };
  return update((tasks) => tasks.map((t) => (t.id === event.id ? next : t)));
}

/** One row of the Background tasks card: a command, workflow or monitor, or a background agent (`subagent` set). */
export interface TaskRow {
  id: string;
  kind: BackgroundTaskKind | 'agent';
  title: string;
  status: SubagentStatus;
  startedAt: number;
  endedAt?: number;
  exitCode?: number;
  command?: string;
  outputFile?: string;
  subagent?: Subagent;
}

/** Everything the thread's agent started beside its turn, oldest first: background commands, workflows and monitors, and every agent it started (Claude's, Codex's, Mochi's own). The Background tasks tab lists them all; the summary card shows the active ones. */
export function threadTasks(thread: Thread): TaskRow[] {
  const agents = (thread.subagents ?? []).map(
    (s): TaskRow => ({ id: s.id, kind: 'agent', title: s.name, status: s.status, startedAt: s.startedAt, ...(s.endedAt !== undefined && { endedAt: s.endedAt }), subagent: s }),
  );
  return [...(thread.backgroundTasks ?? []), ...agents].sort((a, b) => a.startedAt - b.startedAt);
}

export const isActive = (task: Pick<TaskRow, 'status'>) => task.status === 'running';

export const activeTasks = (thread: Thread) => threadTasks(thread).filter(isActive);

export function stopTask(threadId: string, task: TaskRow): Action {
  return task.subagent ? { type: 'bg-stop', threadId, subagentId: task.id } : { type: 'task-stop', threadId, taskId: task.id };
}

/** A finished task's outcome in a word or two: the exit code when it failed with one. */
export function taskResult(task: Pick<TaskRow, 'status' | 'exitCode'>) {
  if (task.status === 'failed') return task.exitCode ? `Exit ${task.exitCode}` : 'Failed';
  if (task.status === 'stopped') return 'Stopped';
  return 'Done';
}
