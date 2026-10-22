import { Effect, Layer, Queue, Schedule, Stream } from 'effect';
import { RpcServer } from 'effect/rpc';
import { NodeServices } from '@effect/platform-node';
import { Cache } from './cache.ts';
import { CoreRpcs } from './rpc.ts';
import { asRunError, Run } from './run.ts';
import { layerRunner, type CorePort } from './transport.ts';

const HandlersLive = CoreRpcs.toLayer(Effect.gen(function* () {
  const run = yield* Run;
  return {
    ping: () => Effect.succeed('pong'),
    ticks: ({ intervalMs }) => Stream.fromSchedule(Schedule.spaced(intervalMs)),
    log: ({ level, source, message }) => Effect.logWithLevel(level)(message).pipe(Effect.annotateLogs({ source })),
    run: ({ command, args, timeoutMs, ...options }) =>
      run.run(command, args, { ...options, timeout: timeoutMs }).pipe(Effect.mapError(asRunError(command))),
    spawn: ({ command, args, timeoutMs, ...options }) => run.spawn(command, args, { ...options, timeout: timeoutMs }),
    stdin: ({ id, data }) => run.write(id, data),
    signal: ({ id, signal }) => run.signal(id, signal as NodeJS.Signals),
  };
}));

/** Everything Core runs, serving RPC to each port offered to `ports`. */
export const layerCore = (ports: Queue.Dequeue<CorePort>) =>
  Layer.mergeAll(
    RpcServer.layer(CoreRpcs).pipe(Layer.provide(HandlersLive), Layer.provide(Run.layer), Layer.provide(RpcServer.layerProtocolWorkerRunner), Layer.provide(layerRunner(ports))),
    Cache.layer,
  ).pipe(Layer.provide(NodeServices.layer));
