import {
  experimental_streamedQuery as streamedQuery,
  useQuery,
} from '@tanstack/react-query';
import { Cause, Effect, Stream } from 'effect';
import type { CoreClient } from '@mochi/core/client';
import type { MetricsSnapshot } from '@mochi/core/metrics/schema';
import { coreClient } from '../host/desktop/rpc.ts';
import { host } from '../host/index.ts';
import { queryKeys } from '../queryKeys.ts';

/** About two minutes at Core's one sample a second. */
const HISTORY = 120;

/** Core's samples, one a second, until the stream is interrupted. */
export const metricsStream = (client: CoreClient) => client.metrics();

/** The last samples, oldest first. The subscription lasts while the page is open. */
export function useMetrics() {
  const metricsQuery = useQuery({
    queryKey: queryKeys.developer.metrics(),
    queryFn: streamedQuery<MetricsSnapshot, MetricsSnapshot[]>({
      streamFn: async ({ signal }) => {
        const aborted = Effect.callback<void>((resume) =>
          signal.addEventListener('abort', () => resume(Effect.void), {
            once: true,
          }),
        );
        const stream = metricsStream(await coreClient()).pipe(
          Stream.interruptWhen(aborted),
          // A failure or a defect (Core's reply failed to encode) both end the page's stream with a readable message.
          Stream.catchCause((cause) =>
            Stream.fail(new Error(Cause.pretty(cause))),
          ),
        );
        return Stream.toAsyncIterable(stream);
      },
      reducer: (history, sample) => [...history, sample].slice(-HISTORY),
      initialValue: [],
      refetchMode: 'append',
    }),
    enabled: host.isDesktop,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    // The page is the only observer; leaving it ends the subscription instead of keeping a second of polling alive.
    gcTime: 0,
  });
  const history = metricsQuery.data ?? [];
  return { history, latest: history.at(-1), error: metricsQuery.error };
}
