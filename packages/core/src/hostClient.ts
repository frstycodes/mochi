import { Cause, Effect, Exit, Schedule, Stream } from 'effect';
import type { Capabilities } from '@mochi/schema';
import type { CoreClient } from './client.ts';

type HostClient = Record<
  string,
  (args: unknown) => Effect.Effect<unknown, unknown>
>;

const messageOf = (error: unknown) =>
  typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : String(error);

/** Calls `<namespace>.<method>` on Core: `host.*` take their argument list, Core's own procedures their payload. A failure rejects with an `Error` carrying the handler's message. */
export const makeHostCaller =
  (client: CoreClient) => async (tag: string, args: unknown) => {
    const exit = await Effect.runPromiseExit(
      (client as unknown as HostClient)[tag]!(args),
    );
    if (Exit.isSuccess(exit)) return exit.value;
    throw new Error(messageOf(Cause.squash(exit.cause)));
  };

/** Answers one capability call; a rejection reaches Core as its message. */
export type CapabilityHandler = (
  call: Capabilities.CapabilityCall,
) => Promise<unknown>;

/** Serves `names` for Core until interrupted, registering again after every reconnect. */
export const serveCapabilities = (
  client: CoreClient,
  names: ReadonlyArray<Capabilities.CapabilityName>,
  handle: CapabilityHandler,
) =>
  client['capabilities.serve']({ names }).pipe(
    Stream.runForEach((call) =>
      Effect.promise(() =>
        handle(call).then(
          (value) => ({ value }),
          (error: unknown) => ({ error: messageOf(error) }),
        ),
      ).pipe(
        Effect.flatMap((result) =>
          client['capabilities.reply']({ id: call.id, ...result }),
        ),
        // A reply fails only when the socket dropped, and Core has already failed that call.
        Effect.ignore,
        Effect.forkDetach,
      ),
    ),
    // The stream ends with the socket; a fresh one after the redial registers again.
    Effect.ignore,
    Effect.repeat(Schedule.spaced(250)),
  );
