import { Context, Effect, Layer, PubSub, Stream } from 'effect';
import type { Relay } from '@mochi/schema';
import type { BrowserEvent } from '@mochi/domain/host/types/browser';
import type { State } from '../../../../apps/desktop/src/store/types.ts';
import { onPush } from '../agents/events.ts';
import { Capabilities } from '../hostServer.ts';
import { Commands } from '../store/commands.ts';
import { Projection } from '../store/projection.ts';
import { PageUnknown } from './browsers.ts';

type Frame = typeof Relay.BrowserFrame.Type;
type Navigation = typeof Relay.BrowserNavigation.Type;
type Key = { threadId: string; tabId: string };

interface Page extends Key {
  view: string;
  url: string;
  title: string;
  latest: Frame | null;
  /** A device streams it (`browser-open` until `browser-close`); its open again is a resize. */
  isWatched: boolean;
  /** `null` once the tab closes: its streams end. */
  changed: PubSub.PubSub<Frame | null>;
}

export class Browsers extends Context.Service<Browsers>()(
  'mochi/core/Browsers',
  {
    make: Effect.gen(function* () {
      const capabilities = yield* Capabilities;
      const commands = yield* Commands;
      const projection = yield* Projection;
      const pages = new Map<string, Page>();
      const keyOf = ({ threadId, tabId }: Key) => `${threadId}/${tabId}`;
      const byView = (view: string) =>
        [...pages.values()].find((p) => p.view === view);

      const call = (method: string, args: unknown[]) =>
        capabilities
          .call({ capability: 'browserView', method, args })
          .pipe(Effect.orDie);
      const record = (page: Page) =>
        commands
          .submit({
            type: 'browser-tab',
            threadId: page.threadId,
            tab: { id: page.tabId, url: page.url, title: page.title },
          })
          .pipe(Effect.ignore);

      const threadOf = (threadId: string) =>
        projection.current.pipe(
          Effect.map((p) =>
            (p.domain as unknown as State).threads.find(
              (t) => t.id === threadId,
            ),
          ),
        );

      const page = (key: Key) =>
        Effect.suspend(() => {
          const found = pages.get(keyOf(key));
          return found
            ? Effect.succeed(found)
            : Effect.fail(new PageUnknown(key));
        });

      /** The device that last opened, touched or navigated a page drives it: the page lays out at that device's viewport. */
      const drive = (page: Page) => call('browser.drive', [page.view]);

      const open = (
        key: Key & {
          url: string;
          viewport?: { width: number; height: number };
        },
      ) =>
        Effect.gen(function* () {
          const existing = pages.get(keyOf(key));
          const found = existing ?? (yield* create(key));
          if (!key.viewport) return found.view;
          yield* call('browser.mirror', [found.view, key.viewport]);
          if (!found.isWatched) yield* drive(found);
          found.isWatched = true;
          return found.view;
        });

      const create = (key: Key & { url: string }) =>
        Effect.gen(function* () {
          const thread = yield* threadOf(key.threadId);
          if (!thread) return yield* new PageUnknown(key);
          const folded = thread.browserTabs?.find((t) => t.id === key.tabId);
          // A tab the thread already has (opened before a restart) reopens where it was.
          const url = folded?.url || key.url || 'about:blank';
          const { id } = (yield* call('browser.create', [
            { url, spaceId: thread.spaceId },
          ])) as { id: string };
          const page: Page = {
            ...key,
            view: id,
            url,
            title: folded?.title ?? '',
            latest: null,
            isWatched: false,
            changed: yield* PubSub.sliding<Frame | null>(1),
          };
          pages.set(keyOf(key), page);
          yield* record(page);
          return page;
        });

      const heard = (event: BrowserEvent) =>
        Effect.gen(function* () {
          const page = byView(event.id);
          if (!page) return;
          if (event.type === 'state') {
            const url = event.url || page.url;
            if (url === page.url && event.title === page.title) return;
            Object.assign(page, { url, title: event.title });
            return yield* record(page);
          }
          if (event.type === 'frame') {
            page.latest = {
              data: event.data,
              url: page.url,
              title: page.title,
            };
            return void PubSub.publishUnsafe(page.changed, page.latest);
          }
          if (event.type !== 'closed') return;
          pages.delete(keyOf(page));
          PubSub.publishUnsafe(page.changed, null);
          yield* commands
            .submit({
              type: 'browser-tab-close',
              threadId: page.threadId,
              tabId: page.tabId,
            })
            .pipe(Effect.ignore);
        });

      // Headless Chromium's events come on Core's own push stream; main's come as `page.event`.
      onPush(({ channel, payload }) => {
        if (channel === 'browser:onEvent')
          Effect.runFork(heard(payload as BrowserEvent));
      });

      const input = (key: Key & { input: unknown }) =>
        page(key).pipe(
          Effect.tap((p) => call('browser.input', [p.view, key.input])),
          Effect.flatMap(drive),
          Effect.asVoid,
        );

      const navigate = (key: Key & { to: Navigation }) =>
        page(key).pipe(
          Effect.tap((p) =>
            typeof key.to === 'object'
              ? call('browser.navigate', [p.view, key.to.url])
              : call('browser.command', [p.view, key.to]),
          ),
          Effect.flatMap(drive),
          Effect.asVoid,
        );

      // GAP: one viewport per page; a second device watching resizes the first's frames, and the last to stop stops both.
      const unwatch = (key: Key) =>
        Effect.suspend(() => {
          const found = pages.get(keyOf(key));
          if (!found) return Effect.void;
          found.isWatched = false;
          return call('browser.mirror', [found.view, null]);
        }).pipe(Effect.asVoid);

      /** Keyed by the thread a device was shown, so a made-up tab id of another thread's gets nothing. */
      const watch = (key: Key) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const found = yield* page(key);
            // Subscribed before reading the latest, so a frame in between isn't missed.
            const next = yield* PubSub.subscribe(found.changed);
            return Stream.concat(
              Stream.fromIterable(found.latest ? [found.latest] : []),
              Stream.fromSubscription(next),
            ).pipe(Stream.takeWhile((frame): frame is Frame => frame !== null));
          }),
        );

      return { open, input, navigate, unwatch, watch, heard };
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
