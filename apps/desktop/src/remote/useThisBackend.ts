import {
  experimental_streamedQuery as streamedQuery,
  useQuery,
} from '@tanstack/react-query';
import { Cause, Effect, Stream } from 'effect';
import type { Backend } from '@mochi/schema';
import { coreClient } from '../host/desktop/rpc.ts';
import { host } from '../host/index.ts';
import type { DeviceKind } from '../host/types/remote.ts';
import { queryKeys } from '../queryKeys.ts';
import { THIS_DEVICE } from './DeviceIcon.tsx';

/** What the window shows for this computer until its Core has answered, or where there is no Core. */
const FALLBACK = { name: 'This computer', kind: THIS_DEVICE } as const;

/**
 * This computer as its own Core describes it (`backend.watch`), the way another machine is described by its welcome: the name
 * and icon follow a rename and the OS the Core runs on. `kind` is undefined for a headless Core, which `DeviceIcon` draws as
 * a plain computer.
 */
export function useThisBackend(): {
  name: string;
  kind: DeviceKind | undefined;
  info: Backend.BackendInfo | undefined;
} {
  const { data: info } = useQuery({
    queryKey: queryKeys.backend.info(),
    queryFn: streamedQuery<
      Backend.BackendInfo,
      Backend.BackendInfo | undefined
    >({
      streamFn: async ({ signal }) => {
        const aborted = Effect.callback<void>((resume) =>
          signal.addEventListener('abort', () => resume(Effect.void), {
            once: true,
          }),
        );
        const stream = (await coreClient())['backend.watch']().pipe(
          Stream.interruptWhen(aborted),
          Stream.catchCause((cause) =>
            Stream.fail(new Error(Cause.pretty(cause))),
          ),
        );
        return Stream.toAsyncIterable(stream);
      },
      reducer: (_, latest) => latest,
      initialValue: undefined,
      refetchMode: 'append',
    }),
    enabled: host.hasCore,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  if (!info) return { ...FALLBACK, info: undefined };
  return {
    name: info.name,
    kind: info.kind === 'server' ? undefined : info.kind,
    info,
  };
}
