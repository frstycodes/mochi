import {
  Context,
  Deferred,
  Effect,
  Layer,
  Queue,
  Schema,
  Stream,
  SubscriptionRef,
} from 'effect';
import {
  Capabilities as Contract,
  definitionOf,
  hostTags,
} from '@mochi/schema';

type Call = Omit<Contract.CapabilityCall, 'id'>;

/** A served call's failure when its client went away before answering: the next client serving the name takes it. */
export const DISCONNECTED = 'The client serving this call disconnected';

/**
 * Clients that registered capabilities, and Core's calls into them. The latest client to register a name serves it; when it
 * goes, the one before it does, so closing a window never leaves a call waiting while another still serves the name.
 */
export class Capabilities extends Context.Service<Capabilities>()(
  'mochi/core/Capabilities',
  {
    make: Effect.gen(function* () {
      /** Per name, the serving clients' queues, latest last. */
      const providers = new Map<
        Contract.CapabilityName,
        Queue.Queue<Contract.CapabilityCall>[]
      >();
      const pending = new Map<
        number,
        {
          deferred: Deferred.Deferred<unknown, string>;
          queue: Queue.Queue<Contract.CapabilityCall>;
        }
      >();
      let nextId = 0;
      /** The names a client serves now, in registration order; `backend.info` pushes it again when it changes. */
      const offered = yield* SubscriptionRef.make<
        ReadonlyArray<Contract.CapabilityName>
      >([]);
      const publish = Effect.suspend(() =>
        SubscriptionRef.set(offered, [...providers.keys()]),
      );

      const failPending = (queue: Queue.Queue<Contract.CapabilityCall>) => {
        for (const [id, entry] of pending) {
          if (entry.queue !== queue) continue;
          pending.delete(id);
          Deferred.doneUnsafe(entry.deferred, Effect.fail(DISCONNECTED));
        }
      };

      /** The calls for `names`, until the stream ends, which unregisters them. */
      const serve = (names: ReadonlyArray<Contract.CapabilityName>) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const queue = yield* Queue.unbounded<Contract.CapabilityCall>();
            for (const name of names)
              providers.set(name, [...(providers.get(name) ?? []), queue]);
            yield* publish;
            const unregister = Effect.gen(function* () {
              for (const name of names) {
                const rest = (providers.get(name) ?? []).filter(
                  (q) => q !== queue,
                );
                if (rest.length) providers.set(name, rest);
                else providers.delete(name);
              }
              yield* publish;
              failPending(queue);
            });
            return Stream.fromQueue(queue).pipe(Stream.ensuring(unregister));
          }),
        );

      const reply = ({ id, value, error }: Contract.CapabilityReply) =>
        Effect.sync(() => {
          const entry = pending.get(id);
          if (!entry) return;
          pending.delete(id);
          Deferred.doneUnsafe(
            entry.deferred,
            error === undefined ? Effect.succeed(value) : Effect.fail(error),
          );
        });

      /** Fails with `CapabilityUnavailable` when no connected client offers `capability`, else with the client's message; a client that leaves mid-call hands it to the next. */
      const call = (
        request: Call,
      ): Effect.Effect<unknown, string | Contract.CapabilityUnavailable> =>
        Effect.gen(function* () {
          const queue = providers.get(request.capability)?.at(-1);
          if (!queue)
            return yield* new Contract.CapabilityUnavailable({
              capability: request.capability,
            });
          const id = nextId++;
          const deferred = yield* Deferred.make<unknown, string>();
          pending.set(id, { deferred, queue });
          Queue.offerUnsafe(queue, { ...request, id });
          return yield* Deferred.await(deferred).pipe(
            Effect.ensuring(Effect.sync(() => pending.delete(id))),
          );
        }).pipe(
          Effect.catch((error) =>
            error === DISCONNECTED && providers.has(request.capability)
              ? call(request)
              : Effect.fail(error),
          ),
        );

      /** Whether a connected client serves `name` now. */
      const offers = (name: Contract.CapabilityName) => providers.has(name);

      return { serve, reply, call, offers, offered };
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** `host.*` handlers for one connection: each call goes, JSON-encoded, to the client serving its namespace's capability. */
export const hostHandlers = (
  capabilities: Capabilities['Service'],
  windowId: number | undefined,
) =>
  Object.fromEntries(
    hostTags.map((tag) => {
      const { input, output } = definitionOf(tag);
      const [namespace] = tag.split('.') as [string];
      const handler = (args: ReadonlyArray<unknown>) =>
        Effect.gen(function* () {
          const encoded = (yield* Schema.encodeUnknownEffect(
            Schema.toCodecJson(input),
          )(args)) as ReadonlyArray<unknown>;
          const value = yield* capabilities.call({
            capability: Contract.capabilityOf(namespace),
            method: tag,
            args: encoded,
            windowId,
          });
          return yield* Schema.decodeUnknownEffect(Schema.toCodecJson(output))(
            value,
          );
        }).pipe(
          Effect.mapError((error) =>
            error instanceof Contract.CapabilityUnavailable
              ? error
              : messageOf(error),
          ),
        );
      return [tag, handler];
    }),
  );
