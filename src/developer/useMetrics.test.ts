import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Context, Effect, Layer, Stream } from 'effect';
import { HttpServer } from 'effect/http';
import { Capabilities } from '@mochi/schema';
import { coreUrl, makeCoreClient } from '@mochi/core/client';
import { serveCapabilities } from '@mochi/core/hostClient';
import { layerSpans } from '@mochi/core/metrics/spans';
import { layerCore } from '@mochi/core/server';
import { cpuSeries, gpuSeconds } from './chartData.ts';
import { metricsStream } from './useMetrics.ts';

const TOKEN = 'local-token';

const fake = [
  { pid: 1, type: 'Browser', cpuPercent: 3, cpuSeconds: 10, workingSetKb: 204_800 },
  { pid: 2, type: 'GPU', name: 'GPU Process', cpuPercent: 12, cpuSeconds: 4.5, workingSetKb: 102_400 },
] satisfies Capabilities.ProcessMetric[];

test('fake metrics from main come through Core\'s stream, with Core\'s own counters, and the page reads them', async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(layerCore({ port: 0, tokens: new Map([[TOKEN, Capabilities.allScopes]]), origins: [] }).pipe(Layer.provide(layerSpans)));
        const port = (Context.get(context, HttpServer.HttpServer).address as { port: number }).port;
        const main = yield* makeCoreClient(coreUrl(port, TOKEN));
        yield* serveCapabilities(main, ['metrics'], async () => fake).pipe(Effect.forkScoped);
        const window = yield* makeCoreClient(coreUrl(port, TOKEN, 7));
        yield* Effect.sleep(50);
        yield* window.run({ command: 'true', args: [] });
        yield* window['events.append']({ type: 'test.event', threadId: 'thread-1', payload: {} });
        yield* Effect.sleep(50);

        const [sample] = yield* metricsStream(window).pipe(Stream.take(1), Stream.runCollect);
        assert.deepEqual(sample!.processes, fake);
        assert.deepEqual(sample!.spawns, [{ binary: 'true', perMinute: 1 }]);
        assert.deepEqual(sample!.events, [{ threadId: 'thread-1', perSecond: 0.1 }]);
        assert.ok(sample!.spans.length > 0, 'RPC handlers end spans');

        assert.deepEqual(cpuSeries([sample!]).map(({ total, gpu }) => ({ total, gpu })), [{ total: 15, gpu: 12 }]);
        assert.equal(gpuSeconds(sample), 4.5);
      }),
    ),
  );
});
