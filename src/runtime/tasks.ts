import type { AgentTaskEvent, BackgroundTaskKind, SubagentStatus } from '../host/types/agent.ts';
import type { BackgroundTask, Provider, Subagent, Thread } from '../model.ts';
import type { State } from '../store/index.tsx';
import { mapThread } from '../store/threads.ts';

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
      startedAt: Date.now(),
      ...(event.command && { command: event.command }),
      ...(event.outputFile && { outputFile: event.outputFile }),
    };
    return update((tasks) => [...tasks, task]);
  }
  if (existing?.status !== 'running') return state;
  const next: BackgroundTask = {
    ...existing,
    ...(event.outputFile && { outputFile: event.outputFile }),
    ...(event.phase === 'end' && { status: event.status ?? 'done', endedAt: Date.now(), ...(event.exitCode !== undefined && { exitCode: event.exitCode }) }),
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
  outputFile?: string;
  subagent?: Subagent;
}

/** Everything running behind the thread, oldest first: its agent's background commands and the agents it left running (Claude's, Codex's, Mochi's own). Foreground subagents end with their turn, so they're not here. */
export function threadTasks(thread: Thread): TaskRow[] {
  const agents = (thread.subagents ?? [])
    .filter((s) => s.isBackground)
    .map((s): TaskRow => ({ id: s.id, kind: 'agent', title: s.name, status: s.status, startedAt: s.startedAt, ...(s.endedAt !== undefined && { endedAt: s.endedAt }), subagent: s }));
  return [...(thread.backgroundTasks ?? []), ...agents].sort((a, b) => a.startedAt - b.startedAt);
}

export const runningTasks = (thread: Thread) => threadTasks(thread).filter((t) => t.status === 'running').length;

/** A finished task's outcome in a word or two: the exit code when it failed with one. */
export function taskResult(task: Pick<TaskRow, 'status' | 'exitCode'>) {
  if (task.status === 'failed') return task.exitCode ? `Exit ${task.exitCode}` : 'Failed';
  if (task.status === 'stopped') return 'Stopped';
  return 'Done';
}

/** Elapsed time as a short age, like Claude's task rows: "45s", "8m", "2h". */
export function shortElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`;
}
