import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { it } from '@effect/vitest';
import {
  Context,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Option,
  Stream,
} from 'effect';
import { HttpServer } from 'effect/http';
import { Capabilities as Contract } from '@mochi/schema';
import type {
  BrowserEvent,
  BrowserSnapshot,
} from '@mochi/domain/host/types/browser';
import { coreUrl, makeCoreClient } from '../client.ts';
import { makeHostCaller } from '../hostClient.ts';
import { layerCore } from '../server.ts';
import {
  chromiumLauncher,
  headlessBrowser,
  NO_BROWSER,
  type Launcher,
} from './headless.ts';

const TOKEN = 'browser-token';

/** Core as `mochi serve` runs it, with no main: `browserView` is Core's own, from `launch`. */
const startHeadless = (launch: Launcher) =>
  Effect.gen(function* () {
    const browserView = headlessBrowser(launch);
    const context = yield* Layer.build(
      layerCore({
        port: 0,
        tokens: new Map([[TOKEN, Contract.allScopes]]),
        origins: [],
        browserView,
      }),
    );
    const { port } = Context.get(context, HttpServer.HttpServer).address as {
      port: number;
    };
    const client = yield* makeCoreClient(coreUrl(port, TOKEN));
    return {
      client,
      call: makeHostCaller(client),
      browserView,
    };
  });

const PAGE = `<!doctype html><title>Counter</title>
<h1>Counter</h1>
<p id="count">Clicked 0 times</p>
<button onclick="document.getElementById('count').textContent = 'Clicked ' + ++window.n + ' times'">Add one</button>
<script>window.n = 0</script>`;

/** A local page to drive, closed with the scope. */
const servePage = Effect.acquireRelease(
  Effect.promise(
    () =>
      new Promise<{ url: string; close: () => void }>((resolve) => {
        const server = createServer((_req, res) => {
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end(PAGE);
        });
        server.listen(0, '127.0.0.1', () => {
          const { port } = server.address() as { port: number };
          resolve({
            url: `http://127.0.0.1:${port}/`,
            close: () => server.close(),
          });
        });
      }),
  ),
  ({ close }) => Effect.sync(close),
);

/** The headless Chromium this Playwright wants, if it's installed here; the test never downloads one. */
const installedChromium = async () => {
  const { registry } = await import('playwright-core/lib/coreBundle');
  const path = registry.registry
    .findExecutable('chromium-headless-shell')
    ?.executablePath('javascript');
  return !!path && existsSync(path);
};

it.live(
  'a headless Core with no main drives a page: navigate, read, click, and stream its frames',
  () =>
    Effect.gen(function* () {
      if (!(yield* Effect.promise(installedChromium))) {
        console.warn(
          'Skipped: no headless Chromium installed (pnpm -F @mochi/core exec playwright-core install chromium-headless-shell)',
        );
        return;
      }
      const { url } = yield* servePage;
      const { client, call } = yield* startHeadless(
        chromiumLauncher(undefined),
      );
      const { id } = (yield* Effect.promise(() =>
        call('browser.create', [{ url, spaceId: 'test' }]),
      )) as { id: string };

      const snapshot = (yield* Effect.promise(() =>
        call('browser.snapshot', [id]),
      )) as BrowserSnapshot;
      assert.match(snapshot.text, /heading "Counter"/);
      assert.match(snapshot.text, /Clicked 0 times/);
      const button = Object.entries(snapshot.refs).find(
        ([, { role, name }]) => role === 'button' && name === 'Add one',
      )?.[0];
      assert.ok(button, snapshot.text);

      yield* Effect.promise(() =>
        call('browser.act', [id, { kind: 'click', ref: button }]),
      );
      const waited = (yield* Effect.promise(() =>
        call('browser.waitFor', [
          id,
          { text: 'Clicked 1 times', timeoutMs: 5000 },
        ]),
      )) as { isMet: boolean };
      assert.equal(waited.isMet, true);
      const evaluated = (yield* Effect.promise(() =>
        call('browser.eval', [id, 'window.n']),
      )) as { value: string };
      assert.equal(evaluated.value, '1');

      // Any interface sees the page as `mirror`'s frames on Core's push stream.
      // The stream opens with the busy threads, so its first item says it's subscribed.
      const subscribed = yield* Deferred.make<void>();
      const frame = yield* client.agentPush().pipe(
        Stream.tap(() => Deferred.succeed(subscribed, undefined)),
        Stream.filter(
          ({ channel, payload }) =>
            channel === 'browser:onEvent' &&
            (payload as BrowserEvent).type === 'frame',
        ),
        Stream.runHead,
        Effect.forkChild,
      );
      yield* Deferred.await(subscribed);
      yield* Effect.promise(() =>
        call('browser.mirror', [id, { width: 800, height: 600 }]),
      );
      const pushed = yield* Fiber.join(frame).pipe(
        Effect.timeout('10 seconds'),
      );
      const { payload } = Option.getOrThrow(pushed);
      assert.match(
        (payload as { data: string }).data,
        /^data:image\/jpeg;base64,/,
      );
      yield* Effect.promise(() => call('browser.mirror', [id, null]));
      yield* Effect.promise(() => call('browser.destroy', [id]));
    }).pipe(Effect.scoped),
  60_000,
);

it.live(
  'with no Chromium to start, browser tools answer that this computer has no browser',
  () =>
    Effect.gen(function* () {
      let launches = 0;
      const { client, call, browserView } = yield* startHeadless(async () => {
        launches++;
        throw new Error('Executable doesn’t exist');
      });
      // Nothing starts with Core: until a browser tool runs, it may have one.
      assert.equal(launches, 0);
      assert.equal(browserView.isAvailable(), true);
      const reported = () =>
        Effect.map(client['backend.info'](), (info) => info.capabilities);
      assert.deepEqual(yield* reported(), ['browserView']);
      for (let i = 0; i < 2; i++) {
        const error = yield* Effect.promise(() =>
          call('browser.create', [
            { url: 'about:blank', spaceId: 'test' },
          ]).then(
            () => undefined,
            (error: unknown) => error,
          ),
        );
        assert.ok(error instanceof Error);
        assert.equal(error.message, NO_BROWSER);
      }
      assert.equal(launches, 1);
      assert.equal(browserView.isAvailable(), false);
      assert.deepEqual(yield* reported(), []);
    }).pipe(Effect.scoped),
);
