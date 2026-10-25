import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { it } from '@effect/vitest';
import { Context, Effect, Layer } from 'effect';
import { HttpServer } from 'effect/http';
import { Capabilities } from '@mochi/schema';
import { coreUrl, makeCoreClient } from '../client.ts';
import { makeHostCaller } from '../hostClient.ts';
import { layerCore } from '../server.ts';

const TOKEN = 'serve-token';

/** Core as `mochi serve` runs it: no main, and a renderer build to serve. */
const startHeadless = Effect.gen(function* () {
  const ui = mkdtempSync(path.join(tmpdir(), 'mochi-ui-'));
  writeFileSync(path.join(ui, 'index.html'), '<title>Mochi</title>');
  const context = yield* Layer.build(
    layerCore({
      port: 0,
      tokens: new Map([[TOKEN, Capabilities.allScopes]]),
      origins: [],
      ui,
    }),
  );
  return (
    Context.get(context, HttpServer.HttpServer).address as { port: number }
  ).port;
});

it.live(
  'a desktop capability with no client answers CapabilityUnavailable, typed across the socket',
  () =>
    Effect.gen(function* () {
      const port = yield* startHeadless;
      const call = makeHostCaller(yield* makeCoreClient(coreUrl(port, TOKEN)));
      for (const [tag, args, capability] of [
        ['notify.show', [{ title: 'Done' }], 'notify'],
        ['sim.list', [], 'sim'],
        ['fs.list', ['/tmp'], 'host'],
      ] as const) {
        const error = yield* Effect.promise(() =>
          call(tag, args).then(
            () => undefined,
            (error: unknown) => error,
          ),
        );
        assert.ok(error instanceof Capabilities.CapabilityUnavailable, tag);
        assert.equal(error.capability, capability);
      }
    }),
);

it.live('Core serves the UI and nothing outside its folder', () =>
  Effect.gen(function* () {
    const port = yield* startHeadless;
    const get = (route: string) =>
      Effect.promise(() =>
        fetch(`http://127.0.0.1:${port}${route}`, {
          headers: { accept: 'text/html' },
        }).then(async (response) => [response.status, await response.text()]),
      );
    assert.deepEqual(yield* get('/'), [200, '<title>Mochi</title>']);
    // A client route a browser navigates to falls back to the app.
    assert.deepEqual(yield* get('/settings'), [200, '<title>Mochi</title>']);
    const [status] = yield* get('/..%2f..%2fetc%2fpasswd');
    assert.notEqual(status, 200);
  }),
);
