import { mutationOptions, queryOptions } from '@tanstack/react-query';
import { host } from '../host/index.ts';
import { queryClient } from '../query.ts';
import { queryKeys } from '../queryKeys.ts';

export function libraryQuery(spaceId: string) {
  return queryOptions({ queryKey: queryKeys.library.space(spaceId), queryFn: () => host.library.list(spaceId) });
}

export const libraryMutationOptions = mutationOptions({
  mutationFn: (run: () => Promise<unknown>) => run(),
  onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.library.all() }),
});
