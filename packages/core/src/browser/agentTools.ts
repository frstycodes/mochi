import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  decodeArgs,
  TOOL_TABLE,
  type ArgsOf,
  type ToolName,
} from '@mochi/domain/runtime/toolTable';
import type {
  BrowserAct,
  BrowserDialog,
  BrowserEvent,
  BrowserLog,
  BrowserSnapshot,
  BrowserWait,
} from '@mochi/domain/host/types/browser';
import type { AgentToolResult } from '../../../../apps/desktop/src/host/types/agent.ts';
import { dialogNote } from '../../../../apps/desktop/src/browser/dialog.ts';
import {
  IRREVERSIBLE,
  isLocalUrl,
  toUrl,
} from '../../../../apps/desktop/src/browser/sites.ts';
import { onPush } from '../agents/events.ts';
import { NEEDS_APP, NO_BROWSER } from './answers.ts';

// After a click or key, give a navigation the page starts a moment to begin, as the renderer's tools do.
const SETTLE_MS = 300;
// Claude rejects images over 5 MB; base64 runs 4/3 of that (as `runtime/browserTools.ts`).
const MAX_IMAGE_CHARS = 6_900_000;
const SEARCH_URL = 'https://duckduckgo.com/?q=';

/** A `browserView` call, JSON args in and out, as Core's capability call makes it. */
export type ViewCall = (method: string, args: unknown[]) => Promise<unknown>;

interface Options {
  call: ViewCall;
  /** Whether anything here can serve `browserView`: false once Chromium couldn't start. */
  isAvailable: () => boolean;
  /** The thread's space, for its browser profile; undefined for a thread Core doesn't know. */
  spaceOf: (thread: string) => string | undefined;
}

interface Page {
  url: string;
  title: string;
  error: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  dialog: BrowserDialog | null;
}

interface Tab {
  id: string;
  view: string;
  /** The latest snapshot's refs, stale once the URL changes. */
  refs: { url: string; refs: BrowserSnapshot['refs'] } | null;
}

interface Outcome {
  result: unknown;
  changed?: string;
  image?: AgentToolResult['image'];
}

type Run = (thread: string, args: never) => Promise<Outcome>;

/**
 * Mochi's browser tools run in Core, for a backend no Mochi app is connected to (`mochi serve`): the same tools and
 * answers as the renderer's (`runtime/browserTools.ts`), on whatever serves `browserView` here (headless Chromium). Each
 * thread has its own tabs. Nobody is here to answer a card, so what asks first in the app is refused instead, and a tab
 * can't be handed to the user.
 */
export function agentBrowserTools({ call, isAvailable, spaceOf }: Options) {
  const tabs = new Map<string, Tab[]>();
  const pages = new Map<string, Page>();
  let nextTab = 0;

  onPush(({ channel, payload }) => {
    if (channel !== 'browser:onEvent') return;
    const event = payload as BrowserEvent;
    const page = pages.get(event.id);
    if (!page) return;
    if (event.type === 'state') {
      const { url, title, error, canGoBack, canGoForward } = event;
      Object.assign(page, { url, title, error, canGoBack, canGoForward });
    } else if (event.type === 'dialog')
      page.dialog = event.kind
        ? { kind: event.kind, message: event.message }
        : null;
    else if (event.type === 'closed') forget(event.id);
  });

  const forget = (view: string) => {
    pages.delete(view);
    for (const [thread, list] of tabs)
      tabs.set(
        thread,
        list.filter((t) => t.view !== view),
      );
  };

  const tabFor = (thread: string, tabId: string | undefined) => {
    const list = tabs.get(thread) ?? [];
    const tab = tabId ? list.find((t) => t.id === tabId) : list.at(-1);
    if (!tab)
      throw new Error(
        tabId
          ? `No browser tab ${tabId} in your thread; browser_tabs lists them`
          : 'Your thread has no browser tab; browser_open opens one',
      );
    return { tab, page: pages.get(tab.view)! };
  };

  /** `tabFor`, for a page no dialog blocks: every tool but browser_dialog would wait on its answer. */
  const live = (thread: string, tabId: string | undefined) => {
    const found = tabFor(thread, tabId);
    if (found.page.dialog) throw new Error(dialogNote(found.page.dialog));
    return found;
  };

  const pageResult = (tab: Tab) => {
    const page = pages.get(tab.view);
    return {
      tabId: tab.id,
      url: page?.url ?? '',
      title: page?.title ?? '',
      ...(page?.error && { error: page.error }),
    };
  };

  const refIn = (thread: string, tabId: string | undefined, ref: string) => {
    const { tab, page } = tabFor(thread, tabId);
    const meta = tab.refs?.url === page.url ? tab.refs.refs[ref] : undefined;
    if (!meta)
      throw new Error(
        `No ref ${ref} from a snapshot of this tab; call browser_snapshot first`,
      );
    return { meta, url: page.url };
  };

  /** What asks on a card in the app: refused here, where nobody can answer one. */
  const refuse = (what: string): never => {
    throw new Error(
      `${what} asks the user first, and no Mochi app is open on this computer to ask; do it on a local page, or once the app is open`,
    );
  };

  const act = async (
    thread: string,
    tabId: string | undefined,
    action: BrowserAct,
    changed: string,
  ): Promise<Outcome> => {
    const { tab } = live(thread, tabId);
    const { note } = (await call('browser.act', [tab.view, action])) as {
      note?: string;
    };
    await settle();
    await refresh(tab);
    return {
      ...(changed && { changed }),
      result: { ...pageResult(tab), ...(note && { note }) },
    };
  };

  const command = async (
    thread: string,
    tabId: string | undefined,
    which: 'back' | 'forward' | 'reload',
    changed: string,
  ): Promise<Outcome> => {
    const { tab, page } = live(thread, tabId);
    if (
      (which === 'back' && !page.canGoBack) ||
      (which === 'forward' && !page.canGoForward)
    )
      throw new Error(`Nothing to go ${which} to in this tab`);
    await call('browser.command', [tab.view, which]);
    await settle();
    await refresh(tab);
    return { changed, result: pageResult(tab) };
  };

  const label = (meta: { name: string; role: string }) =>
    short(meta.name || meta.role);

  const tools: {
    [K in BrowserTool]: (thread: string, args: Args<K>) => Promise<Outcome>;
  } = {
    browser_tabs: async (thread) => ({
      result: (tabs.get(thread) ?? []).map((tab, i, list) => ({
        ...pageResult(tab),
        isLoading: false,
        isActive: i === list.length - 1,
      })),
    }),
    browser_open: async (thread, args) => {
      const url = toUrl(args.url, SEARCH_URL);
      const list = tabs.get(thread) ?? [];
      const existing = !args.newTab && list.at(-1);
      let tab: Tab;
      if (existing) {
        tab = existing;
        pages.get(tab.view)!.error = null;
        await call('browser.navigate', [tab.view, url]);
      } else {
        const space = spaceOf(thread) ?? 'default';
        const { id } = (await call('browser.create', [
          { url, spaceId: space },
        ])) as { id: string };
        tab = { id: `tab-${++nextTab}`, view: id, refs: null };
        // `create` resolved after its load's state event, which came before the page was known here.
        pages.set(id, {
          url,
          title: '',
          error: null,
          canGoBack: false,
          canGoForward: false,
          dialog: null,
        });
        await refresh(tab);
        tabs.set(thread, [...list, tab]);
      }
      return {
        changed: isLocalUrl(url)
          ? 'opened a page'
          : 'opened a page outside your machine',
        result: pageResult(tab),
      };
    },
    browser_snapshot: async (thread, args) => {
      const { tab, page } = live(thread, args.tabId);
      const snapshot = (await call('browser.snapshot', [
        tab.view,
      ])) as BrowserSnapshot;
      tab.refs = { url: page.url, refs: snapshot.refs };
      return { result: { ...pageResult(tab), snapshot: snapshot.text } };
    },
    browser_click: async (thread, args) => {
      const { meta, url } = refIn(thread, args.tabId, args.ref);
      if (!isLocalUrl(url) && IRREVERSIBLE.test(meta.name || meta.role))
        refuse(`Clicking "${label(meta)}" on ${host(url)}`);
      return act(
        thread,
        args.tabId,
        { kind: 'click', ref: args.ref },
        `clicked "${label(meta)}"`,
      );
    },
    browser_type: async (thread, args) => {
      const { meta, url } = refIn(thread, args.tabId, args.ref);
      if (meta.isPassword && !isLocalUrl(url))
        refuse(`Typing a password on ${host(url)}`);
      await act(
        thread,
        args.tabId,
        { kind: 'type', ref: args.ref, text: args.text },
        '',
      );
      return args.submit
        ? act(
            thread,
            args.tabId,
            { kind: 'press', key: 'Enter' },
            `typed into "${label(meta)}" and pressed Enter`,
          )
        : {
            changed: `typed into "${label(meta)}"`,
            result: { typed: meta.isPassword ? '••••' : args.text },
          };
    },
    browser_press: (thread, args) =>
      act(
        thread,
        args.tabId,
        { kind: 'press', key: args.key },
        `pressed ${args.key}`,
      ),
    browser_scroll: (thread, args) =>
      act(
        thread,
        args.tabId,
        {
          kind: 'scroll',
          ref: args.ref,
          dx: args.dx ?? 0,
          dy: args.dy ?? 600,
        },
        '',
      ),
    browser_hover: async (thread, args) => {
      const { meta } = refIn(thread, args.tabId, args.ref);
      return act(
        thread,
        args.tabId,
        { kind: 'hover', ref: args.ref },
        `hovered "${label(meta)}"`,
      );
    },
    browser_select: async (thread, args) => {
      const { meta } = refIn(thread, args.tabId, args.ref);
      return act(
        thread,
        args.tabId,
        { kind: 'select', ref: args.ref, value: args.value },
        `picked "${short(args.value)}" in "${label(meta)}"`,
      );
    },
    browser_drag: async (thread, args) => {
      const from = refIn(thread, args.tabId, args.from).meta;
      const to = refIn(thread, args.tabId, args.to).meta;
      return act(
        thread,
        args.tabId,
        { kind: 'drag', from: args.from, to: args.to },
        `dragged "${label(from)}" onto "${label(to)}"`,
      );
    },
    browser_wait_for: async (thread, args) => {
      const { tab } = live(thread, args.tabId);
      const { text, selector, url } = args;
      const until: BrowserWait = {
        text,
        selector,
        url,
        timeoutMs: args.timeoutMs ?? 5000,
      };
      const { isMet, waitedMs } = (await call('browser.waitFor', [
        tab.view,
        until,
      ])) as { isMet: boolean; waitedMs: number };
      await refresh(tab);
      return { result: { ...pageResult(tab), isMet, waitedMs } };
    },
    browser_eval: async (thread, args) => {
      const { tab, page } = live(thread, args.tabId);
      if (!isLocalUrl(page.url)) refuse(`A script on ${host(page.url)}`);
      const { value, isTruncated } = (await call('browser.eval', [
        tab.view,
        args.script,
      ])) as { value: string; isTruncated: boolean };
      return {
        changed: `ran a script on ${page.url}`,
        result: {
          ...pageResult(tab),
          value,
          ...(isTruncated && {
            note: 'Cut at 20000 characters; return less, like a slice or a count',
          }),
        },
      };
    },
    browser_screenshot: async (thread, args) => {
      const { tab } = live(thread, args.tabId);
      const data = (
        (await call('browser.capture', [
          tab.view,
          { fullPage: !!args.fullPage },
        ])) as string
      ).replace(/^data:image\/png;base64,/, '');
      if (!data)
        throw new Error(
          'The capture came back empty; try again, or read the page with browser_snapshot',
        );
      if (data.length > MAX_IMAGE_CHARS)
        throw new Error(
          'That screenshot is over the 5 MB an image can be; take the viewport (fullPage: false) or scroll and take several',
        );
      return {
        result: pageResult(tab),
        image: { data, mimeType: 'image/png' },
      };
    },
    browser_console: async (thread, args) => {
      const { tab } = live(thread, args.tabId);
      const logs = (await call('browser.logs', [tab.view])) as BrowserLog[];
      return {
        result: {
          ...pageResult(tab),
          console: logs.map(
            (l) =>
              `${l.level}: ${l.message}${l.source ? ` (${l.source}:${l.line})` : ''}`,
          ),
        },
      };
    },
    browser_back: (thread, args) =>
      command(thread, args.tabId, 'back', 'went back'),
    browser_forward: (thread, args) =>
      command(thread, args.tabId, 'forward', 'went forward'),
    browser_reload: (thread, args) =>
      command(thread, args.tabId, 'reload', 'reloaded the page'),
    browser_dialog: async (thread, args) => {
      const { tab, page } = tabFor(thread, args.tabId);
      if (!page.dialog) throw new Error('No dialog is open in this tab');
      const { kind, message } = page.dialog;
      await call('browser.answerDialog', [tab.view, { accept: args.accept }]);
      await settle();
      return {
        changed: `answered ${JSON.stringify(message)} with ${kind === 'confirm' && !args.accept ? 'Cancel' : 'OK'}`,
        result: pageResult(tab),
      };
    },
    browser_batch: async (thread, args) => {
      const steps: { name: string; result: unknown }[] = [];
      let image: Outcome['image'];
      for (const [i, { name, input = {} }] of args.actions.entries()) {
        const result =
          !name.startsWith('browser_') || name === 'browser_batch'
            ? fail('A batch runs browser_* tools other than browser_batch')
            : await run(thread, name, input);
        if (result.isError)
          throw new Error(
            JSON.stringify({
              steps,
              failed: { step: i + 1, name, error: result.text },
            }),
          );
        image = result.image ?? image;
        steps.push({ name, result: JSON.parse(result.text) });
      }
      return { result: { steps }, ...(image && { image }) };
    },
  };

  /** Reads the page's URL and title now: a click's navigation lands after its state event may have been read. */
  const refresh = async (tab: Tab) => {
    const page = pages.get(tab.view);
    if (!page) return;
    const { value } = (await call('browser.eval', [
      tab.view,
      '({ url: location.href, title: document.title })',
    ]).catch(() => ({ value: '' }))) as { value: string };
    if (value) Object.assign(page, JSON.parse(value));
  };

  const settle = () => new Promise((r) => setTimeout(r, SETTLE_MS));

  /** One browser tool for `thread`, answered as the renderer's `runTool` answers: JSON text, an image, or an error. */
  async function run(
    thread: string,
    name: string,
    args: unknown,
  ): Promise<AgentToolResult> {
    if (!isBrowserTool(name)) return fail(`${name} ${NEEDS_APP}`);
    if (!isAvailable()) return fail(capitalize(NO_BROWSER));
    const parsed = decodeArgs(TOOL_TABLE[name].shape, args);
    if ('error' in parsed) return fail(parsed.error);
    try {
      const outcome = await (tools[name] as Run)(thread, parsed.args as never);
      return {
        text: JSON.stringify(
          outcome.changed
            ? {
                changed: capitalize(outcome.changed),
                ...(outcome.result as object),
              }
            : outcome.result,
        ),
        ...(outcome.image && { image: outcome.image }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return fail(message === NO_BROWSER ? capitalize(NO_BROWSER) : message);
    }
  }

  return run;
}

/** The browser tools Core runs; browser_set_device and browser_upload need the app's pane and worktree, browser_handoff its user. */
const BROWSER_TOOLS = [
  'browser_tabs',
  'browser_open',
  'browser_snapshot',
  'browser_click',
  'browser_type',
  'browser_press',
  'browser_scroll',
  'browser_hover',
  'browser_select',
  'browser_drag',
  'browser_wait_for',
  'browser_eval',
  'browser_screenshot',
  'browser_console',
  'browser_back',
  'browser_forward',
  'browser_reload',
  'browser_dialog',
  'browser_batch',
] as const satisfies ToolName[];

type BrowserTool = (typeof BROWSER_TOOLS)[number];
type Args<K extends BrowserTool> = ArgsOf<(typeof TOOL_TABLE)[K]['shape']>;

const isBrowserTool = (name: string): name is BrowserTool =>
  (BROWSER_TOOLS as readonly string[]).includes(name);

const fail = (text: string): AgentToolResult => ({ text, isError: true });

const capitalize = (text: string) => text[0]!.toUpperCase() + text.slice(1);

/** An element's name as a line quotes it: the first 40 characters. */
function short(name: string) {
  const line = name.replace(/\s+/g, ' ').trim();
  return line.length > 40 ? `${line.slice(0, 39).trimEnd()}…` : line;
}

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** A Mochi tool's answer as MCP content, as main's `callMochi` (electron/mcp/server.ts) makes it. */
export const toCallToolResult = (result: AgentToolResult): CallToolResult => ({
  content: [
    { type: 'text', text: result.text },
    ...(result.image
      ? [
          {
            type: 'image' as const,
            data: result.image.data,
            mimeType: result.image.mimeType,
          },
        ]
      : []),
  ],
  isError: result.isError,
});
