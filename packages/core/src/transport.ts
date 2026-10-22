import { Effect, Fiber, Layer, Queue, Scope } from 'effect';
import { RpcClient } from 'effect/rpc';
import { Worker, WorkerRunner } from 'effect/workers';

// Effect RPC ships no MessagePort transport, so both ends reuse its worker protocol, which is already
// structured-clone over `postMessage`: the client sends `[0, request]` or `[1]` (close); Core answers
// `[0]` (ready) once, then `[1, response]`.

/** Electron's `MessagePortMain`, structurally, so tests can pass a fake. */
export interface CorePort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  start(): void;
  close(): void;
}

/** A `MessagePortMain` in main, or a DOM `MessagePort` in a window. */
export type ClientPort = {
  postMessage(message: unknown): void;
  start(): void;
} & ({ on(event: 'message', listener: (event: { data: unknown }) => void): unknown } | { addEventListener(event: 'message', listener: (event: { data: unknown }) => void): unknown });

/** Core's side: every port taken from `ports` is one RPC client, and a closed port disconnects it. */
export const layerRunner = (ports: Queue.Dequeue<CorePort>) =>
  Layer.succeed(WorkerRunner.WorkerRunnerPlatform)({
    start: <O, I>() =>
      Effect.gen(function* () {
        const open = new Map<number, CorePort>();
        const disconnects = yield* Queue.unbounded<number>();
        const sendUnsafe = (portId: number, message: O) => open.get(portId)?.postMessage([1, message]);
        const run = <A, E, R>(handler: (portId: number, message: I) => Effect.Effect<A, E, R> | void) =>
          Effect.scopedWith((scope) =>
            Effect.gen(function* () {
              const runFork = Effect.runForkWith(yield* Effect.context<R>());
              const track = Fiber.runIn(scope);
              let nextId = 0;
              const serve = (port: CorePort) => {
                const id = nextId++;
                open.set(id, port);
                const close = () => {
                  if (!open.delete(id)) return;
                  port.close();
                  Queue.offerUnsafe(disconnects, id);
                };
                port.on('message', ({ data }) => {
                  const [tag, message] = data as readonly [0, I] | readonly [1];
                  if (tag === 1) return close();
                  const result = handler(id, message as I);
                  if (Effect.isEffect(result)) track(runFork(result));
                });
                port.on('close', close);
                port.start();
                port.postMessage([0]);
              };
              return yield* Queue.take(ports).pipe(Effect.map(serve), Effect.forever);
            }),
          );
        return { run, sendUnsafe, send: (portId: number, message: O) => Effect.sync(() => sendUnsafe(portId, message)), disconnects };
      }),
  });

/** A client's side: one port, one long-lived "worker". Closing the layer's scope tells Core to drop it. */
export const layerClient = (port: ClientPort) =>
  RpcClient.layerProtocolWorker({ size: 1 }).pipe(
    Layer.provide(
      Layer.succeed(Worker.WorkerPlatform)(
        Worker.makePlatform<ClientPort>()({
          setup: ({ worker, scope }) => Effect.as(Scope.addFinalizer(scope, Effect.sync(() => worker.postMessage([1]))), worker),
          listen: ({ port, emit }) =>
            Effect.sync(() => {
              const onMessage = (event: { data: unknown }) => emit(event.data);
              if ('on' in port) port.on('message', onMessage);
              else port.addEventListener('message', onMessage);
              port.start();
            }),
        }),
      ),
    ),
    Layer.provide(Worker.layerSpawner(() => port)),
  );
