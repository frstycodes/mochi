import { Cause, Effect, Fiber, Stream } from 'effect';
import type { CoreClient } from '../client.ts';
import type { IrohHint } from './iroh.ts';
import { queuedReader, type RawLink } from './link.ts';

type IrohCalls = Pick<
  CoreClient,
  'remote.irohDial' | 'remote.irohSend' | 'remote.irohClose'
>;

/**
 * A machine's EndpointId dialled through Core's iroh endpoint, as a `RawLink` in main: Core holds the one endpoint bound to
 * this computer's key and forwards bytes; pairing and its encryption still run here, so Core relays ciphertext. Resolves
 * once Core's connection opened; rejects with Core's reason when it couldn't.
 */
export function irohThroughCore(
  client: IrohCalls,
  publicKey: string,
  hint: IrohHint = {},
): Promise<RawLink> {
  return new Promise((resolve, reject) => {
    const reader = queuedReader();
    const closeListeners: ((code: number, reason: string) => void)[] = [];
    let id: number | undefined;
    let isOpen = false;
    let writing = Promise.resolve();
    const closed = (code: number, reason: string) => {
      if (!isOpen) return;
      isOpen = false;
      for (const listener of closeListeners) listener(code, reason);
    };
    const link: RawLink = {
      send(bytes) {
        if (!isOpen || id === undefined) return;
        const at = id;
        // One at a time: concurrent calls could reach Core out of order.
        writing = writing
          .then(() =>
            Effect.runPromise(client['remote.irohSend']({ id: at, bytes })),
          )
          .catch(() => {});
      },
      close(code, reason) {
        if (!isOpen || id === undefined) return;
        const at = id;
        closed(code, reason);
        writing = writing
          .then(() =>
            Effect.runPromise(
              client['remote.irohClose']({ id: at, code, reason }),
            ),
          )
          .catch(() => {})
          .then(() => void Effect.runFork(Fiber.interrupt(fiber)));
      },
      onMessage: reader.set,
      onClose: (listener) => void closeListeners.push(listener),
      isOpen: () => isOpen,
    };
    const fiber = Effect.runFork(
      client['remote.irohDial']({
        publicKey,
        ...(hint.relay && { relay: hint.relay }),
        ...(hint.addresses && { addresses: hint.addresses }),
      }).pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            if (event._tag === 'open') {
              id = event.id;
              isOpen = true;
              return resolve(link);
            }
            if (event._tag === 'message') return reader.deliver(event.bytes);
            closed(event.code, event.reason);
          }),
        ),
        Effect.matchCause({
          onSuccess: () => closed(1006, 'Core ended the link'),
          onFailure: (cause) => {
            const reason = String(Cause.squash(cause));
            if (id === undefined) return reject(new Error(reason));
            closed(1006, reason);
          },
        }),
      ),
    );
  });
}
