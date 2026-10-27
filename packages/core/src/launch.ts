import { Effect, Layer, Option } from 'effect';
import { NodeHttpClient } from '@effect/platform-node';
import { Otlp } from 'effect/observability';
import { layerLog } from './log.ts';
import { layerSpans } from './metrics/spans.ts';
import { layerCore, type ServerOptions } from './server.ts';

export interface LaunchOptions extends ServerOptions {
  readonly logFile: string;
  /** An OpenTelemetry collector's base URL: spans are exported there too. */
  readonly otlpUrl: Option.Option<URL>;
}

/** Runs Core until interrupted: the desktop entry (`core.ts`) and `mochi serve` (`serve/serve.ts`) both end here. */
export const launchCore = ({ logFile, otlpUrl, ...options }: LaunchOptions) => {
  // Spans always reach the developer page; with an OTLP URL they are exported too.
  const exporter = Option.match(otlpUrl, {
    onNone: () => Layer.empty,
    onSome: (url) =>
      Otlp.layerJson({
        baseUrl: url.href,
        resource: { serviceName: 'mochi-core' },
      }).pipe(Layer.provide(NodeHttpClient.layerNodeHttp)),
  });
  return Effect.logInfo('Core started').pipe(
    Effect.annotateLogs({
      source: 'core',
      pid: process.pid,
      host: options.host ?? '127.0.0.1',
      port: options.port,
    }),
    Effect.andThen(Layer.launch(layerCore(options))),
    Effect.provide(
      Layer.mergeAll(
        layerSpans.pipe(Layer.provide(exporter)),
        layerLog(logFile),
      ),
    ),
  );
};
