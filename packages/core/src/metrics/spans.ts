import { Effect, Layer, Tracer } from 'effect';
import type { SpanRecord } from './schema.ts';

const KEPT = 50;
const recent: (typeof SpanRecord.Type)[] = [];

/** The last finished spans, newest first. */
export const recentSpans = (): ReadonlyArray<typeof SpanRecord.Type> => recent;

/** Records each span as it ends, then hands it to whichever tracer is already installed (Effect's native one, or the OTLP exporter beneath this layer). */
export const layerSpans = Layer.effect(Tracer.Tracer)(
  Effect.map(Effect.service(Tracer.Tracer), (inner) =>
    Tracer.make({
      ...inner,
      span(options) {
        const span = inner.span.call(inner, options);
        const end = span.end.bind(span);
        span.end = (endTime, exit) => {
          end(endTime, exit);
          // The page's own sampling (its `capabilities` round trip) would fill the list.
          if (span.name.startsWith('capabilities.')) return;
          recent.unshift({
            name: span.name,
            durationMs: Number(endTime - options.startTime) / 1e6,
            endedAt: Date.now(),
            isOk: exit._tag === 'Success',
          });
          recent.length = Math.min(recent.length, KEPT);
        };
        return span;
      },
    }),
  ),
);
