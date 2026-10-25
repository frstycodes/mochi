import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../queryKeys.ts';
import { host } from '../host/index.ts';
import type { Thread } from '../model.ts';

/** The live session's breakdown, read again whenever the thread's context total moves. Null with no live Claude session. */
export function useContextUsage(thread: Thread) {
  return useQuery({
    queryKey: queryKeys.agent.contextUsage(thread.id, thread.context.used),
    queryFn: () => host.agent.contextUsage(thread.id),
    enabled: thread.providers[0] === 'claude',
    placeholderData: (previous) => previous,
  });
}
