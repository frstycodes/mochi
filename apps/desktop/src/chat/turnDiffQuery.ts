import { queryOptions } from '@tanstack/react-query';
import { host } from '../host/index.ts';
import type { DiffFile } from '../host/types/git.ts';
import { queryKeys } from '../queryKeys.ts';
import { askMachine, type ThreadIo } from '../remote/threadIo.ts';

/** One turn's files, from this computer's worktree or the thread's owner (`turn-diff`); a finished turn's never change. */
export function turnDiffQuery(
  io: ThreadIo | null,
  from: string | undefined,
  to: string | undefined,
  latest?: number,
) {
  const toOrNow = to ?? `now@${latest}`;
  return queryOptions({
    queryKey:
      io?.kind === 'remote'
        ? queryKeys.remote.read(io.machine.id, [
            io.threadId,
            'turn-diff',
            from,
            toOrNow,
          ])
        : queryKeys.chat.turnDiff(io?.root ?? null, from, toOrNow),
    queryFn: async (): Promise<DiffFile[]> => {
      if (io?.kind !== 'remote') return host.git.turnDiff(io!.root, from!, to);
      const { machine, threadId } = io;
      const diff = await askMachine(machine.id, {
        type: 'turn-diff',
        threadId,
        from: from!,
        to,
      });
      return diff.turnFiles;
    },
    enabled:
      !!(io && from && (latest !== undefined || to)) &&
      (io.kind === 'local' || io.machine.status === 'online'),
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  });
}
