import { Context, Deferred, Effect, Layer, Queue, Schema, Stream } from 'effect';
import { Capabilities as Contract, definitionOf, hostTags } from '@mochi/schema';

type Call = Omit<Contract.CapabilityCall, 'id'>;

/** Clients that registered capabilities, and Core's calls into them. The latest client to register a name serves it. */
export class Capabilities extends Context.Service<Capabilities>()('mochi/core/Capabilities', {
  make: Effect.sync(() => {
    const providers = new Map<Contract.CapabilityName, Queue.Queue<Contract.CapabilityCall>>();
    const pending = new Map<number, { deferred: Deferred.Deferred<unknown, string>; queue: Queue.Queue<Contract.CapabilityCall> }>();
    let nextId = 0;

    const failPending = (queue: Queue.Queue<Contract.CapabilityCall>) => {
      for (const [id, entry] of pending) {
        if (entry.queue !== queue) continue;
        pending.delete(id);
        Deferred.doneUnsafe(entry.deferred, Effect.fail('The client serving this call disconnected'));
      }
    };

    /** The calls for `names`, until the stream ends, which unregisters them. */
    const serve = (names: ReadonlyArray<Contract.CapabilityName>) =>
      Stream.unwrap(
        Effect.map(Queue.unbounded<Contract.CapabilityCall>(), (queue) => {
          for (const name of names) providers.set(name, queue);
          const unregister = Effect.sync(() => {
            for (const name of names) if (providers.get(name) === queue) providers.delete(name);
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
        Deferred.doneUnsafe(entry.deferred, error === undefined ? Effect.succeed(value) : Effect.fail(error));
      });

    /** Fails with a message when no connected client offers `capability`. */
    const call = (request: Call) =>
      Effect.gen(function* () {
        const queue = providers.get(request.capability);
        if (!queue) return yield* Effect.fail(`No connected client offers ${request.capability}`);
        const id = nextId++;
        const deferred = yield* Deferred.make<unknown, string>();
        pending.set(id, { deferred, queue });
        Queue.offerUnsafe(queue, { ...request, id });
        return yield* Deferred.await(deferred).pipe(Effect.ensuring(Effect.sync(() => pending.delete(id))));
      });

    return { serve, reply, call };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** `host.*` handlers for one connection: each call goes, JSON-encoded, to the client serving its namespace's capability. */
export const hostHandlers = (capabilities: Capabilities['Service'], windowId: number | undefined) =>
  Object.fromEntries(
    hostTags.map((tag) => {
      const { input, output } = definitionOf(tag);
      const [namespace] = tag.split('.') as [string];
      const handler = (args: ReadonlyArray<unknown>) =>
        Effect.gen(function* () {
          const encoded = (yield* Schema.encodeUnknownEffect(Schema.toCodecJson(input))(args)) as ReadonlyArray<unknown>;
          const value = yield* capabilities.call({ capability: Contract.capabilityOf(namespace), method: tag, args: encoded, windowId });
          return yield* Schema.decodeUnknownEffect(Schema.toCodecJson(output))(value);
        }).pipe(Effect.mapError(messageOf));
      return [tag, handler];
    }),
  );
