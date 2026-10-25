import { Effect, Layer } from 'effect';
import { NodeHttpClient, NodeRuntime } from '@effect/platform-node';
import { Otlp } from 'effect/observability';
import { Capabilities } from '@mochi/schema';
import { layerLog } from './log.ts';
import { layerSpans } from './metrics/spans.ts';
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

// Spans always reach the developer page; with MOCHI_OTLP_URL set (an OpenTelemetry collector's base URL) they are exported too.
const exporter = process.env.MOCHI_OTLP_URL
  ? Otlp.layerJson({
      baseUrl: process.env.MOCHI_OTLP_URL,
      resource: { serviceName: 'mochi-core' },
    }).pipe(Layer.provide(NodeHttpClient.layerUndici))
  : Layer.empty;

NodeRuntime.runMain(
  program.pipe(
    Effect.provide(
      Layer.mergeAll(
        layerSpans.pipe(Layer.provide(exporter)),
        layerLog(env('MOCHI_LOG_FILE')),
      ),
    ),
  ),
);
