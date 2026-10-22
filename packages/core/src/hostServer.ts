import { Effect, Layer, Queue } from 'effect';
import { RpcServer } from 'effect/rpc';
import { HostRpcs, hostTags } from '@mochi/schema';
import { layerRunner, type CorePort } from './transport.ts';

/** Runs `<namespace>.<method>` with the already-decoded arguments. A rejection reaches the caller as its message. */
export type HostCall = (tag: string, args: ReadonlyArray<unknown>) => Promise<unknown>;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const HandlersLive = (call: HostCall) =>
  HostRpcs.toLayer(
    Object.fromEntries(hostTags.map((tag) => [tag, (args: ReadonlyArray<unknown>) => Effect.tryPromise({ try: () => call(tag, args), catch: messageOf })])) as never,
  );

/** Serves the `host.*` methods to every port offered to `ports`; decoding the arguments is what validates them. */
export const layerHost = (ports: Queue.Dequeue<CorePort>, call: HostCall) =>
  RpcServer.layer(HostRpcs).pipe(
    Layer.provide(HandlersLive(call)),
    Layer.provide(RpcServer.layerProtocolWorkerRunner),
    Layer.provide(layerRunner(ports)),
  ) as Layer.Layer<never>;
