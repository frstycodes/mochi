import { queryOptions } from '@tanstack/react-query';
import { host } from '../host/index.ts';
import { queryKeys } from '../queryKeys.ts';

export function turnDiffQuery(cwd: string | null, from: string | undefined, to: string | undefined, latest?: number) {
  return queryOptions({
    queryKey: queryKeys.chat.turnDiff(cwd, from, to ?? `now@${latest}`),
    queryFn: () => host.git.turnDiff(cwd!, from!, to),
    enabled: !!(cwd && from && (latest !== undefined || to)),
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  });
}
