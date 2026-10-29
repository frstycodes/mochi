import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { Capabilities as Contract } from '@mochi/schema';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { main } from '../agents/main.ts';
import { layerCore } from '../server.ts';
import { NEEDS_APP } from './answers.ts';
import {
  chromiumLauncher,
  headlessBrowser,
  type Launcher,
} from './headless.ts';

/** Core as `mochi serve` runs it, with no main: an agent's Mochi tool call (`main.mochiTool`) is answered by Core. */
const startHeadless = (launch: Launcher) =>
  Layer.build(
    layerCore({
      port: 0,
      tokens: new Map([['agent-token', Contract.allScopes]]),
      origins: [],
      browserView: headlessBrowser(launch),
    }),
  );

const tool = (name: string, args: Record<string, unknown>) =>
  Effect.promise(() => main.mochiTool('thread-1', name, args));

const textOf = (result: CallToolResult) => {
  const [first] = result.content;
  assert.equal(first?.type, 'text');
  return (first as { text: string }).text;
};

const PAGE = `<!doctype html><title>Counter</title>
<h1>Counter</h1>
<p id="count">Clicked 0 times</p>
<button onclick="document.getElementById('count').textContent = 'Clicked ' + ++window.n + ' times'">Add one</button>
<script>window.n = 0</script>`;

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

const installedChromium = async () => {
  const { registry } = await import('playwright-core/lib/coreBundle');
  const path = registry.registry
    .findExecutable('chromium-headless-shell')
    ?.executablePath('javascript');
  return !!path && existsSync(path);
};

it.live(
  "with no main, an agent's browser tools run on Core's headless Chromium",
  () =>
    Effect.gen(function* () {
      if (!(yield* Effect.promise(installedChromium))) {
        console.warn(
          'Skipped: no headless Chromium installed (pnpm -F @mochi/core exec playwright-core install chromium-headless-shell)',
        );
        return;
      }
      const { url } = yield* servePage;
      yield* startHeadless(chromiumLauncher(undefined));

      const opened = yield* tool('browser_open', { url });
      assert.equal(opened.isError, undefined, textOf(opened));
      assert.deepEqual(JSON.parse(textOf(opened)), {
        changed: 'Opened a page',
        tabId: 'tab-1',
        url,
        title: 'Counter',
      });

      const read = yield* tool('browser_snapshot', {});
      const snapshot = JSON.parse(textOf(read)) as {
        tabId: string;
        snapshot: string;
      };
      assert.equal(snapshot.tabId, 'tab-1');
      assert.match(snapshot.snapshot, /heading "Counter"/);
      const button = /button "Add one" \[ref=([\w-]+)\]/.exec(
        snapshot.snapshot,
      )?.[1];
      assert.ok(button, snapshot.snapshot);

      const clicked = yield* tool('browser_click', { ref: button });
      assert.equal(
        (JSON.parse(textOf(clicked)) as { changed: string }).changed,
        'Clicked "Add one"',
      );
      const waited = yield* tool('browser_wait_for', {
        text: 'Clicked 1 times',
      });
      assert.equal(
        (JSON.parse(textOf(waited)) as { isMet: boolean }).isMet,
        true,
      );

      const shot = yield* tool('browser_screenshot', {});
      assert.equal(shot.content[1]?.type, 'image');
    }).pipe(Effect.scoped),
  60_000,
);

it.live(
  'with no Chromium to start, the browser tools answer that this computer has no browser',
  () =>
    Effect.gen(function* () {
      yield* startHeadless(async () => {
        throw new Error('Executable doesn’t exist');
      });
      for (let i = 0; i < 2; i++) {
        const result = yield* tool('browser_open', {
          url: 'http://localhost:1',
        });
        assert.equal(result.isError, true);
        assert.equal(textOf(result), 'This computer has no browser');
      }
      // Once it's known, no tool tries again.
      const read = yield* tool('browser_snapshot', {});
      assert.equal(textOf(read), 'This computer has no browser');
    }).pipe(Effect.scoped),
);

it.live(
  "with no main, a Mochi tool that isn't the browser's says it needs the app",
  () =>
    Effect.gen(function* () {
      yield* startHeadless(async () => {
        throw new Error('unused');
      });
      const result = yield* tool('list_threads', {});
      assert.equal(result.isError, true);
      assert.equal(textOf(result), `list_threads ${NEEDS_APP}`);
    }).pipe(Effect.scoped),
);
