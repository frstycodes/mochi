import { Effect, Stream } from 'effect';
import { AGENT_PREFIX, COMMAND_TYPE, type LoggedEvent, type ReplicaItem } from '@mochi/domain';
import { coreClient } from '../host/desktop/rpc.ts';
import { host } from '../host/index.ts';
import type { ReplicaLog } from './replica.ts';

/** Core's `replica` stream and its log: the desktop app. */
export function coreLog(): ReplicaLog {
  return {
    follow(afterSequence, onItem, onEnd) {
      const abort = new AbortController();
      const follow = Effect.promise(() => coreClient()).pipe(
        Effect.flatMap((core) => Stream.runForEach(core.replica({ afterSequence }), (item) => Effect.sync(() => onItem(item as ReplicaItem)))),
      );
      Effect.runPromise(follow, { signal: abort.signal }).then(
        () => onEnd(),
        (error: unknown) => !abort.signal.aborted && onEnd(error),
      );
      return () => abort.abort();
    },
    append: async ({ commandId, threadId, action }) => Effect.runPromise((await coreClient())['events.append']({ type: COMMAND_TYPE, threadId, payload: action, commandId })),
  };
}

/**
 * The web build has no Core: the page logs its own commands and its mock agents' events, and starts empty each load. Items
 * arrive on a microtask, as Core's would after a round trip.
 */
export function pageLog(): ReplicaLog {
  let sequence = 0;
  const followers = new Set<(item: ReplicaItem) => void>();
  const emit = (event: Omit<LoggedEvent, 'sequence' | 'at'>) => {
    const item: ReplicaItem = { _tag: 'event', event: { ...event, sequence: ++sequence, at: Date.now() } };
    queueMicrotask(() => followers.forEach((follower) => follower(item)));
  };
  host.agent.onEvent((event) => emit({ type: `${AGENT_PREFIX}${event.type}`, threadId: event.threadId, payload: event, commandId: null }));
  return {
    follow(_afterSequence, onItem) {
      followers.add(onItem);
      queueMicrotask(() => onItem({ _tag: 'snapshot', sequence, saved: null, context: null }));
      return () => void followers.delete(onItem);
    },
    append: async ({ commandId, threadId, action }) => emit({ type: COMMAND_TYPE, threadId, payload: action, commandId }),
  };
}
