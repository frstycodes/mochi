import { Effect, Layer, Queue, Schedule, Stream } from 'effect';
import { RpcServer } from 'effect/rpc';
import { NodeServices } from '@effect/platform-node';
import { Cache } from './cache.ts';
import { CoreRpcs } from './rpc.ts';
import { Run } from './run.ts';
import { layerRunner, type CorePort } from './transport.ts';

const HandlersLive = CoreRpcs.toLayer({
  ping: () => Effect.succeed('pong'),
  ticks: ({ intervalMs }) => Stream.fromSchedule(Schedule.spaced(intervalMs)),
  log: ({ level, source, message }) => Effect.logWithLevel(level)(message).pipe(Effect.annotateLogs({ source })),
});

/** Everything Core runs, serving RPC to each port offered to `ports`. */
export const layerCore = (ports: Queue.Dequeue<CorePort>) =>
  Layer.mergeAll(
    RpcServer.layer(CoreRpcs).pipe(Layer.provide(HandlersLive), Layer.provide(RpcServer.layerProtocolWorkerRunner), Layer.provide(layerRunner(ports))),
    Run.layer,
    Cache.layer,
  ).pipe(Layer.provide(NodeServices.layer));
