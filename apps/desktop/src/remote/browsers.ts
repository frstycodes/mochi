import { Effect } from 'effect';
import type { Relay } from '@mochi/schema';
import { getPage, openPage, pageKey } from '../browser/pages.ts';
import { normalizeUrl } from '../browser/url.ts';
import { coreClient } from '../host/desktop/rpc.ts';
import { host } from '../host/index.ts';
import type { CommandResult, RemoteCommand } from '../host/types/remote.ts';
import type { Thread } from '../model.ts';

type BrowserCommand = Extract<
  RemoteCommand,
  {
    type:
      | 'browser-open'
      | 'browser-input'
      | 'browser-navigate'
      | 'browser-close';
  }
>;

/** Pages devices watch, by their native view's id: the thread and tab whose frames go to Core. */
const watched = new Map<string, { threadId: string; tabId: string }>();
let isWired = false;

export const isBrowserCommand = (
  command: RemoteCommand,
): command is BrowserCommand => command.type.startsWith('browser-');

/**
 * A device's browser tab on this computer's thread: hosted here as the thread's own tab is (`pages.ts`, keyed by thread and
 * tab), so the agent's browser tools here and the device see one page, its localhost this computer's. Its frames go to Core,
 * which pushes them to the device (`browser.frames`).
 * GAP: watching mirrors the native view, so a window here showing the same tab meanwhile shows frames, not the live view.
 */
export async function runBrowserCommand(
  thread: Thread,
  command: BrowserCommand,
): Promise<CommandResult> {
  const key = pageKey(thread.id, command.tabId);
  if (command.type === 'browser-open') {
    wire();
    await openPage(key, normalizeUrl(command.url), thread.spaceId);
    const hostId = getPage(key)?.hostId;
    if (!hostId) return fail('This computer has no browser to open it in');
    watched.set(hostId, { threadId: thread.id, tabId: command.tabId });
    await host.browser.mirror(hostId, {
      width: command.width,
      height: command.height,
    });
    return { isOk: true };
  }
  const hostId = getPage(key)?.hostId;
  if (!hostId || !watched.has(hostId))
    return fail('That browser tab isn’t open on this computer');
  if (command.type === 'browser-close') {
    watched.delete(hostId);
    await host.browser.mirror(hostId, null);
    void core('browser.close', { threadId: thread.id, tabId: command.tabId });
    return { isOk: true };
  }
  if (command.type === 'browser-input')
    await host.browser.input(hostId, command.input);
  else if (typeof command.to === 'object')
    await host.browser.navigate(hostId, normalizeUrl(command.to.url));
  else await host.browser.command(hostId, command.to);
  return { isOk: true };
}

function wire() {
  if (isWired) return;
  isWired = true;
  host.browser.onEvent((event) => {
    const tab = watched.get(event.id);
    if (!tab) return;
    if (event.type === 'closed') {
      watched.delete(event.id);
      return void core('browser.close', tab);
    }
    if (event.type !== 'frame') return;
    const page = getPage(pageKey(tab.threadId, tab.tabId));
    const frame: Relay.BrowserFrame = {
      data: event.data,
      url: page?.url ?? '',
      title: page?.title ?? '',
    };
    void core('browser.feed', { ...tab, frame });
  });
}

const fail = (error: string): CommandResult => ({ isOk: false, error });

type Call = {
  'browser.feed': {
    threadId: string;
    tabId: string;
    frame: Relay.BrowserFrame;
  };
  'browser.close': { threadId: string; tabId: string };
};

/** Core's side of a watched tab, over the window's own connection so frames reach it in order. An object so tests can stand in for Core. */
export const browserCore = {
  async call<K extends keyof Call>(tag: K, payload: Call[K]) {
    const client = await coreClient();
    return Effect.runPromise(
      (client[tag] as (payload: Call[K]) => Effect.Effect<unknown, unknown>)(
        payload,
      ),
    );
  },
};
const core = <K extends keyof Call>(tag: K, payload: Call[K]) =>
  browserCore.call(tag, payload).catch(() => {});
