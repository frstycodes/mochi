import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';
import { Relay } from '@mochi/schema';

export class PageUnknown extends Schema.TaggedError<PageUnknown>()(
  'PageUnknown',
  { threadId: Schema.String, tabId: Schema.String },
) {}

const PageKey = { threadId: Schema.String, tabId: Schema.String };
const Viewport = Schema.Struct({ width: Schema.Number, height: Schema.Number });

/**
 * A thread's browser tabs, their pages run on this computer through `browserView` (main's views, or headless Chromium), so the
 * agent's tools, this computer's window and a paired device all name one page and localhost is this computer's. Each tab's url
 * and title fold on the thread (`browser-tab`). A device opens or shows a tab with `browser-open` and follows `page.watch`.
 */
export class BrowserRpcs extends RpcGroup.make(
  /** A thread tab's page, opened at `url` if it has none yet; the native view's id, for the window that shows it. */
  Rpc.make('page.open', {
    payload: {
      ...PageKey,
      url: Schema.String,
      viewport: Schema.optional(Viewport),
    },
    success: Schema.String,
    error: PageUnknown,
  }),
  Rpc.make('page.input', {
    payload: { ...PageKey, input: Relay.BrowserInput },
    error: PageUnknown,
  }),
  Rpc.make('page.navigate', {
    payload: { ...PageKey, to: Relay.BrowserNavigation },
    error: PageUnknown,
  }),
  /** Stops streaming its frames; the tab stays open. */
  Rpc.make('page.unwatch', { payload: PageKey }),
  /** The latest frame, then each new one; ends when the tab closes. */
  Rpc.make('page.watch', {
    payload: PageKey,
    success: Relay.BrowserFrame,
    error: PageUnknown,
    stream: true,
  }),
  /** Main's events for the views Core opened (`relayToCore` in `electron/browser/views.ts`). */
  Rpc.make('page.event', { payload: { event: Schema.Unknown } }),
) {}
