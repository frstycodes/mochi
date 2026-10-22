import type {} from 'electron';
import { Effect, Layer, Queue } from 'effect';
import { NodeRuntime } from '@effect/platform-node';
import { layerLog } from './log.ts';
import { layerCore } from './server.ts';
import type { CorePort } from './transport.ts';

// The utilityProcess entry. Main posts one port per window (and one for itself) to `parentPort`.
const program = Effect.gen(function* () {
  const ports = yield* Queue.unbounded<CorePort>();
  process.parentPort.on('message', (event) => event.ports.forEach((port) => Queue.offerUnsafe(ports, port)));
  yield* Effect.logInfo('Core started').pipe(Effect.annotateLogs({ source: 'core', pid: process.pid }));
  return yield* Layer.launch(layerCore(ports));
});

const logFile = process.env.MOCHI_LOG_FILE;
if (!logFile) throw new Error('Core needs MOCHI_LOG_FILE');
NodeRuntime.runMain(program.pipe(Effect.provide(layerLog(logFile))));
