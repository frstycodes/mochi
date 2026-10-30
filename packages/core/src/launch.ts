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

/**
 * Spans name RPCs and SQL statements, and a failure's cause can quote what failed, so they leave this computer only over
 * TLS: plain `http:` is for a collector on loopback.
 */
export const isSafeOtlpUrl = (url: URL) =>
  url.protocol === 'https:' ||
  (url.protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));

/** Runs Core until interrupted: the desktop entry (`core.ts`) and `mochi serve` (`serve/serve.ts`) both end here. */
export const launchCore = ({ logFile, otlpUrl, ...options }: LaunchOptions) => {
  // Spans always reach the developer page; with an OTLP URL they are exported too.
  const refusedOtlp = Option.filter(otlpUrl, (url) => !isSafeOtlpUrl(url));
  const exporter = Option.match(Option.filter(otlpUrl, isSafeOtlpUrl), {
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
    Effect.andThen(
      Option.match(refusedOtlp, {
        onNone: () => Effect.void,
        onSome: (url) =>
          Effect.logWarning(
            `Not exporting spans to ${url.origin}: MOCHI_OTLP_URL must be https unless the collector is on this computer`,
          ),
      }),
    ),
    Effect.andThen(Layer.launch(layerCore(options))),
    Effect.provide(
      Layer.mergeAll(
        layerSpans.pipe(Layer.provide(exporter)),
        layerLog(logFile),
      ),
    ),
  );
};
