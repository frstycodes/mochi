/** A row of the thread list. */
export interface ThreadSummary {
  readonly id: string;
  readonly title: string | null;
  readonly status: string | null;
  readonly project: string | null;
}

export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly space: string;
}

export interface Shell {
  readonly sequence: number;
  readonly threads: ReadonlyArray<ThreadSummary>;
  readonly projects: ReadonlyArray<ProjectSummary>;
}

/** One item of an event log, as Core stores it and streams it. `payload` is the event's JSON. */
export interface LoggedEvent {
  readonly sequence: number;
  readonly type: string;
  readonly threadId: string | null;
  readonly payload: unknown;
  /** Epoch ms it was logged. */
  readonly at?: number;
  /** Set for a command; a window knows its own by this (`src/store/replica.ts`). */
  readonly commandId?: string | null;
}

export type ShellItem = { readonly _tag: 'snapshot'; readonly shell: Shell } | { readonly _tag: 'event'; readonly event: LoggedEvent };

export const emptyShell: Shell = { sequence: 0, threads: [], projects: [] };

/**
 * Folds one `shell` stream item. Items at or below the current sequence are dropped; an event type this version doesn't know
 * still advances the sequence, so an older client keeps its place against a newer Core.
 */
export function projectShell(shell: Shell, item: ShellItem): Shell {
  if (item._tag === 'snapshot') return item.shell.sequence >= shell.sequence ? item.shell : shell;
  const { event } = item;
  if (event.sequence <= shell.sequence) return shell;
  const next = { ...shell, sequence: event.sequence };
  switch (event.type) {
    case 'thread.saved': {
      const summary = event.payload as ThreadSummary;
      const at = shell.threads.findIndex((t) => t.id === summary.id);
      return { ...next, threads: at === -1 ? [...shell.threads, summary] : shell.threads.map((t, i) => (i === at ? summary : t)) };
    }
    case 'thread.deleted':
      return { ...next, threads: shell.threads.filter((t) => t.id !== event.threadId) };
    case 'projects.saved':
      return { ...next, projects: (event.payload as { projects: ReadonlyArray<ProjectSummary> }).projects };
    default:
      return next;
  }
}

/** The fields a thread list shows, read tolerantly from a saved thread (`SavedThread` in src/store/saved.ts). */
export function summarizeThread(id: string, saved: unknown): ThreadSummary {
  const thread = (saved as { thread?: Record<string, unknown> } | null)?.thread ?? {};
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  return { id, title: text(thread.title), status: text(thread.status), project: text(thread.project) };
}

/** Every profile's projects from main's registry document (`projects.json`'s shape). */
export function summarizeProjects(registry: unknown): ProjectSummary[] {
  const spaces = (registry as { spaces?: Record<string, { projects?: ReadonlyArray<{ id: string; name: string; path: string }> }> } | null)?.spaces ?? {};
  return Object.entries(spaces).flatMap(([space, { projects = [] }]) => projects.map(({ id, name, path }) => ({ id, name, path, space })));
}
