import { Context, Effect, Layer, PubSub, Schema, Stream } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';
import { Relay } from '@mochi/schema';

const PageKey = { threadId: Schema.String, tabId: Schema.String };

/**
 * The browser tabs a device watches on this computer belong to the window that owns the store, as the terminals do: the device
 * opens one (`browser-open`), the window hosts the page as its own tab would be and feeds its frames here (`browser.feed`), and
 * a device with the `operate` scope subscribes to `browser.frames`.
 */
export class BrowserRpcs extends RpcGroup.make(
  Rpc.make('browser.feed', {
    payload: { ...PageKey, frame: Relay.BrowserFrame },
  }),
  Rpc.make('browser.close', { payload: PageKey }),
  /** The latest frame, then each new one; ends when the page closes. A subscriber may come before the first frame. */
  Rpc.make('browser.frames', {
    payload: PageKey,
    success: Relay.BrowserFrame,
    stream: true,
  }),
) {}

type Frame = typeof Relay.BrowserFrame.Type;

interface Watched {
  latest: Frame | null;
  /** `null` once the page closes: its streams end. */
  changed: PubSub.PubSub<Frame | null>;
}

export class Browsers extends Context.Service<Browsers>()(
  'mochi/core/Browsers',
  {
    make: Effect.sync(() => {
      const pages = new Map<string, Watched>();
      const keyOf = (threadId: string, tabId: string) => `${threadId}/${tabId}`;

      const pageOf = (threadId: string, tabId: string) =>
        Effect.gen(function* () {
          const key = keyOf(threadId, tabId);
          const known = pages.get(key);
          if (known) return known;
          const page: Watched = {
            latest: null,
            changed: yield* PubSub.sliding<Frame | null>(1),
          };
          pages.set(key, page);
          return page;
        });

      const feed = (threadId: string, tabId: string, frame: Frame) =>
        Effect.gen(function* () {
          const page = yield* pageOf(threadId, tabId);
          page.latest = frame;
          PubSub.publishUnsafe(page.changed, frame);
        });

      const close = (threadId: string, tabId: string) =>
        Effect.sync(() => {
          const key = keyOf(threadId, tabId);
          const page = pages.get(key);
          if (!page) return;
          pages.delete(key);
          PubSub.publishUnsafe(page.changed, null);
        });

      /** Keyed by thread and tab: only the window hosting that tab feeds it. */
      const frames = (threadId: string, tabId: string) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const page = yield* pageOf(threadId, tabId);
            // Subscribed before reading the latest, so a frame fed in between isn't missed.
            const next = yield* PubSub.subscribe(page.changed);
            return Stream.concat(
              Stream.fromIterable(page.latest ? [page.latest] : []),
              Stream.fromSubscription(next),
            ).pipe(Stream.takeWhile((frame): frame is Frame => frame !== null));
          }),
        );

      return { feed, close, frames };
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
