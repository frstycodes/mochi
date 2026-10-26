import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { AgentEvent } from '../../../../apps/desktop/src/host/types/agent.ts';
import { runGit, topLevel } from '../git/run.ts';
import { statusPaths } from '../watch/watch.ts';

/** A worktree's changed paths (as `git status` lists them) with each one's size and mtime. */
export type Snapshot = Map<string, string>;

// GAP: a dev server, a watcher or a parallel command writing during the call counts as the call's change.
const MAX_STATS = 2_000;

/**
 * Tracks each shell command's files: a snapshot at its start and its end, and `emit` gets the paths that differ once it ended.
 * Commands only (not edit tools): an Edit or Write already names its file.
 */
export function trackCommandFiles(
  cwdOf: (threadId: string) => string | undefined,
  emit: (event: AgentEvent) => void,
) {
  const before = new Map<string, Promise<Snapshot | undefined>>();
  return (event: AgentEvent) => {
    if (event.type !== 'tool') return;
    const key = `${event.threadId}:${event.id}`;
    if (event.phase === 'start') {
      const cwd = event.command && cwdOf(event.threadId);
      if (cwd)
        before.set(
          key,
          snapshot(cwd).catch(() => undefined),
        );
      return;
    }
    const start = before.get(key);
    if (!start) return;
    before.delete(key);
    const cwd = cwdOf(event.threadId);
    if (!cwd) return;
    void Promise.all([start, snapshot(cwd).catch(() => undefined)]).then(
      ([from, to]) => {
        const files = from && to ? changedPaths(from, to) : [];
        if (files.length)
          emit({
            threadId: event.threadId,
            type: 'tool-files',
            id: event.id,
            files,
          });
      },
    );
  };
}

export async function snapshot(cwd: string): Promise<Snapshot> {
  const top = await topLevel(cwd);
  const status = await runGit(top, [
    '--no-optional-locks',
    'status',
    '--porcelain=v2',
    '-z',
    '--untracked-files=all',
  ]);
  const paths = statusPaths(status).slice(0, MAX_STATS);
  const stats = await Promise.all(
    paths.map((p) =>
      stat(path.join(top, p)).then(
        (s) => `${s.size}:${s.mtimeMs}`,
        () => '-',
      ),
    ),
  );
  return new Map(paths.map((p, i) => [p, stats[i]!]));
}

/** Paths changed between two snapshots: newly changed, changed again, or back to clean. */
export function changedPaths(from: Snapshot, to: Snapshot) {
  const paths = new Set([...from.keys(), ...to.keys()]);
  return [...paths].filter((p) => from.get(p) !== to.get(p)).sort();
}
