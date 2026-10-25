import { Effect, Layer, Option, Redacted } from 'effect';
import { NodeHttpClient, NodeRuntime } from '@effect/platform-node';
import { Otlp } from 'effect/observability';
import { Capabilities } from '@mochi/schema';
import { coreConfig } from './config.ts';
import { layerLog } from './log.ts';
import { layerSpans } from './metrics/spans.ts';
import { layerCore } from './server.ts';

// Core's entry: main forks it as a utilityProcess, and plain `node` runs it too (tests).
const program = Effect.gen(function* () {
  const config = yield* coreConfig;
  const options = {
    port: config.port,
    tokens: new Map([[Redacted.value(config.token), Capabilities.allScopes]]),
    origins: config.origins,
    userData: config.userData,
  };
  // Spans always reach the developer page; with MOCHI_OTLP_URL set they are exported too.
  const exporter = Option.match(config.otlpUrl, {
    onNone: () => Layer.empty,
    onSome: (url) =>
      Otlp.layerJson({
        baseUrl: url.href,
        resource: { serviceName: 'mochi-core' },
      }).pipe(Layer.provide(NodeHttpClient.layerUndici)),
  });
  return yield* Effect.logInfo('Core started').pipe(
    Effect.annotateLogs({
      source: 'core',
      pid: process.pid,
      port: options.port,
    }),
    Effect.andThen(Layer.launch(layerCore(options))),
    Effect.provide(
      Layer.mergeAll(
        layerSpans.pipe(Layer.provide(exporter)),
        layerLog(config.logFile),
      ),
    ),
  );
});

NodeRuntime.runMain(program);
