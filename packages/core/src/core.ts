import { Effect, Layer } from 'effect';
import { NodeRuntime } from '@effect/platform-node';
import { Capabilities } from '@mochi/schema';
import { layerLog } from './log.ts';
import { layerCore } from './server.ts';

// Core's entry: main forks it as a utilityProcess, and plain `node` runs it too (tests). Main picks the port and the token.
const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Core needs ${name}`);
  return value;
};

const options = {
  port: Number(env('MOCHI_CORE_PORT')),
  tokens: new Map([[env('MOCHI_CORE_TOKEN'), Capabilities.allScopes]]),
  origins: (process.env.MOCHI_CORE_ORIGINS ?? '').split(',').filter(Boolean),
  userData: env('MOCHI_CORE_DATA'),
};

const program = Effect.logInfo('Core started').pipe(
  Effect.annotateLogs({ source: 'core', pid: process.pid, port: options.port }),
  Effect.andThen(Layer.launch(layerCore(options))),
);

NodeRuntime.runMain(program.pipe(Effect.provide(layerLog(env('MOCHI_LOG_FILE')))));
