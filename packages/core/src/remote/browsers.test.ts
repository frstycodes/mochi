import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { Context, Deferred, Effect, Fiber, Layer, Stream } from 'effect';
import { HttpServer } from 'effect/http';
import { Capabilities } from '@mochi/schema';
import { COMMAND_TYPE } from '@mochi/domain';
import { coreUrl, makeCoreClient } from '../client.ts';
import type { LocalCapability } from '../hostServer.ts';
import { layerCore } from '../server.ts';
import { AgentCaller } from '../store/commands.ts';

const TOKEN = 'browsers-test-token';
const THREAD = 'new-1';
const TAB = { threadId: THREAD, tabId: 'b1' };

/** Stands in for main's views (or headless Chromium): records each call, makes one view per create. */
function fakeBrowserView() {
  const calls: { method: string; args: unknown[] }[] = [];
  const capability: LocalCapability = {
    owns: () => true,
    isAvailable: () => true,
    call: async ({ method, args }) => {
      calls.push({ method, args: [...args] });
      return method === 'browser.create'
        ? { id: `view-${calls.length}` }
        : null;
    },
  };
  return { calls, capability };
}

const startCore = (browserView: LocalCapability) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      layerCore({
        port: 0,
        tokens: new Map([[TOKEN, Capabilities.allScopes]]),
        origins: [],
        browserView,
        agents: AgentCaller.layerTest,
      }),
    );
    const { port } = Context.get(context, HttpServer.HttpServer).address as {
      port: number;
    };
    const client = yield* makeCoreClient(coreUrl(port, TOKEN));
    yield* client['events.append']({
      type: COMMAND_TYPE,
      payload: {
        type: 'create',
        spaceId: 's',
        title: 'Thread',
        provider: 'claude',
        project: null,
        isLive: true,
      },
      commandId: 'c1',
    });
    return client;
  });

type Client = Effect.Success<ReturnType<typeof startCore>>;

const tabsOf = (client: Client) =>
  client.replica({ afterSequence: 0 }).pipe(
    Stream.filter((item) => item._tag === 'snapshot'),
    Stream.take(1),
    Stream.runHead,
    Effect.map((item) => {
      const saved = (
        item as unknown as {
          value: {
            saved: { threads: { id: string; browserTabs?: unknown }[] };
          };
        }
      ).value.saved;
      return saved.threads.find((t) => t.id === THREAD)?.browserTabs;
    }),
  );

it.live(
  'a thread tab opens once on this computer, folds its url and title, and streams its frames until it closes',
  () =>
    Effect.gen(function* () {
      const { calls, capability } = fakeBrowserView();
      const client = yield* startCore(capability);

      const view = yield* client['page.open']({
        ...TAB,
        url: 'http://localhost:5173/',
        viewport: { width: 800, height: 600 },
      });
      // A second open (the window showing the tab a device opened) reuses the page.
      assert.equal(
        yield* client['page.open']({ ...TAB, url: 'http://elsewhere/' }),
        view,
      );
      // The device that opened it drives it.
      assert.deepEqual(
        calls.map((c) => c.method),
        ['browser.create', 'browser.mirror', 'browser.drive'],
      );
      assert.deepEqual(calls[0]!.args, [
        { url: 'http://localhost:5173/', spaceId: 's' },
      ]);

      const subscribed = yield* Deferred.make<void>();
      const frames = yield* client['page.watch'](TAB).pipe(
        Stream.tap(() => Deferred.succeed(subscribed, undefined)),
        Stream.runCollect,
        Effect.forkChild({ startImmediately: true }),
      );
      const event = (e: object) =>
        client['page.event']({ event: { id: view, ...e } });
      yield* event({ type: 'frame', data: 'data:image/jpeg;base64,1' });
      yield* Deferred.await(subscribed);
      yield* event({
        type: 'state',
        url: 'http://localhost:5173/about',
        title: 'About',
        isLoading: false,
        canGoBack: true,
        canGoForward: false,
        error: null,
        favicon: null,
      });
      yield* event({ type: 'frame', data: 'data:image/jpeg;base64,2' });
      assert.deepEqual(yield* tabsOf(client), [
        { id: 'b1', url: 'http://localhost:5173/about', title: 'About' },
      ]);

      yield* client['page.input']({
        ...TAB,
        input: { kind: 'click', x: 10, y: 20 },
      });
      yield* client['page.navigate']({ ...TAB, to: 'back' });
      // A device resizing only resizes; one that opens again after closing drives again.
      const viewport = { width: 400, height: 700 };
      yield* client['page.open']({ ...TAB, url: '', viewport });
      yield* client['page.unwatch'](TAB);
      yield* client['page.open']({ ...TAB, url: '', viewport });
      assert.deepEqual(calls.slice(3), [
        {
          method: 'browser.input',
          args: [view, { kind: 'click', x: 10, y: 20 }],
        },
        { method: 'browser.drive', args: [view] },
        { method: 'browser.command', args: [view, 'back'] },
        { method: 'browser.drive', args: [view] },
        { method: 'browser.mirror', args: [view, viewport] },
        { method: 'browser.mirror', args: [view, null] },
        { method: 'browser.mirror', args: [view, viewport] },
        { method: 'browser.drive', args: [view] },
      ]);

      yield* event({ type: 'closed' });
      const seen = [...(yield* Fiber.join(frames))];
      assert.deepEqual(
        seen.map((f) => [f.data, f.url]),
        [
          ['data:image/jpeg;base64,1', 'http://localhost:5173/'],
          ['data:image/jpeg;base64,2', 'http://localhost:5173/about'],
        ],
      );
      assert.deepEqual(yield* tabsOf(client), []);
    }),
);

it.live(
  'a tab of a thread this computer doesn’t have, or one never opened, is refused',
  () =>
    Effect.gen(function* () {
      const { calls, capability } = fakeBrowserView();
      const client = yield* startCore(capability);
      const missing = yield* client['page.open']({
        threadId: 'nope',
        tabId: 'b1',
        url: 'http://localhost:5173/',
      }).pipe(Effect.flip);
      assert.equal(missing._tag, 'PageUnknown');
      const unopened = yield* client['page.watch'](TAB).pipe(
        Stream.runDrain,
        Effect.flip,
      );
      assert.equal(unopened._tag, 'PageUnknown');
      assert.deepEqual(calls, []);
    }),
);
