import type { Page } from '../browser/pages.ts';
import { DEVICES, RESPONSIVE } from '../browser/devices.ts';
import { dialogNote } from '../browser/dialog.ts';
import { displayUrl, normalizeUrl } from '../browser/url.ts';
import type {
  BrowserAct,
  BrowserSnapshot,
  BrowserWait,
} from '../host/types/browser.ts';
import { authorName, type EventGlyph, type PaneTab } from '../model.ts';
import type { ToolContext, ToolSpec } from './tools.ts';
import type { ToolName } from './toolTable.ts';

const LOAD_TIMEOUT_MS = 15_000;
const VIEW_TIMEOUT_MS = 5_000;
// After a click or key, give a navigation the page starts a moment to begin before waiting on it.
const SETTLE_MS = 300;
const POLL_MS = 100;
// Claude rejects images over 5 MB; base64 runs 4/3 of that (same cap as `electron/ipc/agent.ts`).
const MAX_IMAGE_CHARS = 6_900_000;

// browser_batch runs these through `runTool`, so it lives beside it (`tools.ts`).
type BrowserToolName = Exclude<
  Extract<ToolName, `browser_${string}`>,
  'browser_batch'
>;

/** The in-app browser tools: only the caller's own pane tabs, through `env.browser` (main's native views). */
export const BROWSER_TOOLS = {
  browser_tabs: {
    run: ({ state, caller, env }) => {
      const pane = state().panes.find((p) => p.threadId === caller.id);
      return {
        result: browserTabs({ state, caller }).map((t) => {
          const page = env.pages.get(pageKey(caller.id, t.id));
          return {
            tabId: t.id,
            url: page?.url ?? t.url ?? '',
            title: page?.title ?? t.title ?? '',
            isLoading: !!page?.isLoading,
            isActive: pane?.activeTab === t.id,
          };
        }),
      };
    },
  },
  browser_open: {
    run: async (ctx) => {
      const { args, caller, dispatch, env } = ctx;
      const url = normalizeUrl(args.url);
      const existing = !args.newTab && activeBrowserTab(ctx);
      if (existing) {
        const { key, page } = await live(ctx, existing);
        env.pages.update(key, { url, error: null });
        await env.browser.navigate(page.hostId!, url);
      } else
        dispatch({
          type: 'pane-open-tab',
          threadId: caller.id,
          kind: 'browser',
          url,
          isBackground: true,
        });
      const tab = existing || browserTabs(ctx).at(-1)!;
      const { key } = await live(ctx, tab);
      const page = await loaded(ctx, key);
      const isLocal = isLocalUrl(url);
      return {
        changed: isLocal
          ? 'opened a page'
          : 'opened a page outside your machine',
        glyph: 'browse',
        site: url,
        isFinal: true,
        result: pageResult(tab, page),
      };
    },
  },
  browser_snapshot: {
    run: async (ctx) => {
      const { key, tab, page } = await live(ctx, tabFor(ctx));
      const snapshot = await ctx.env.browser.snapshot(page.hostId!);
      lastRefs.set(key, {
        hostId: page.hostId!,
        url: page.url,
        refs: snapshot.refs,
      });
      return { result: { ...pageResult(tab, page), snapshot: snapshot.text } };
    },
  },
  browser_click: {
    run: async (ctx) => {
      const ref = refIn(ctx, ctx.args.ref);
      const label = ref.meta.name || ref.meta.role;
      if (!isLocalUrl(ref.page.url) && IRREVERSIBLE.test(label))
        await askOnSite(ctx, ref.page.url, {
          title: `Click "${short(label)}" on ${host(ref.page.url)}?`,
          detail: `${name(ctx)} wants to click "${short(label)}" on ${host(ref.page.url)}. It may not be undoable there.`,
        });
      return act(
        ctx,
        { kind: 'click', ref: ctx.args.ref },
        `clicked "${short(ref.meta.name || ref.meta.role)}"`,
        'click',
      );
    },
  },
  browser_type: {
    run: async (ctx) => {
      const ref = refIn(ctx, ctx.args.ref);
      const label = ref.meta.name || ref.meta.role;
      // Only a password leaves with what's typed; other fields are ordinary form filling, which the user watches in the pane.
      if (ref.meta.isPassword && !isLocalUrl(ref.page.url))
        await askOnSite(ctx, ref.page.url, {
          title: `Type a password into "${short(label)}" on ${host(ref.page.url)}?`,
          detail: `${name(ctx)} wants to type a password on ${host(ref.page.url)}${ctx.args.submit ? ' and send it' : ''}.`,
        });
      await act(
        ctx,
        { kind: 'type', ref: ctx.args.ref, text: ctx.args.text },
        '',
      );
      return ctx.args.submit
        ? act(
            ctx,
            { kind: 'press', key: 'Enter' },
            `typed into "${short(label)}" and pressed Enter`,
            'type',
          )
        : {
            changed: `typed into "${short(label)}"`,
            glyph: 'type',
            site: ref.page.url,
            isFinal: true,
            result: { typed: ref.meta.isPassword ? '••••' : ctx.args.text },
          };
    },
  },
  browser_press: {
    run: async (ctx) => {
      await live(ctx, tabFor(ctx));
      return act(
        ctx,
        { kind: 'press', key: ctx.args.key },
        `pressed ${ctx.args.key}`,
        'type',
      );
    },
  },
  browser_scroll: {
    run: (ctx) =>
      act(
        ctx,
        {
          kind: 'scroll',
          ref: ctx.args.ref,
          dx: ctx.args.dx ?? 0,
          dy: ctx.args.dy ?? 600,
        },
        '',
      ),
  },
  browser_hover: {
    run: async (ctx) => {
      const ref = refIn(ctx, ctx.args.ref);
      return act(
        ctx,
        { kind: 'hover', ref: ctx.args.ref },
        `hovered "${short(ref.meta.name || ref.meta.role)}"`,
        'click',
      );
    },
  },
  browser_select: {
    run: async (ctx) => {
      const ref = refIn(ctx, ctx.args.ref);
      return act(
        ctx,
        { kind: 'select', ref: ctx.args.ref, value: ctx.args.value },
        `picked "${short(ctx.args.value)}" in "${short(ref.meta.name || ref.meta.role)}"`,
        'click',
      );
    },
  },
  browser_drag: {
    run: async (ctx) => {
      const from = refIn(ctx, ctx.args.from);
      const to = refIn(ctx, ctx.args.to);
      return act(
        ctx,
        { kind: 'drag', from: ctx.args.from, to: ctx.args.to },
        `dragged "${short(from.meta.name || from.meta.role)}" onto "${short(to.meta.name || to.meta.role)}"`,
        'click',
      );
    },
  },
  browser_upload: {
    run: async (ctx) => {
      const ref = refIn(ctx, ctx.args.ref);
      const root = ctx.env.cwdOf(ctx.caller);
      const path = resolvePath(root, ctx.args.path);
      if (!path)
        throw new Error(
          'A relative path needs a worktree, and this thread has none; pass an absolute path',
        );
      if (!root || !isInside(root, path))
        await ctx.confirm({
          title: `Upload a file from outside the worktree to ${host(ref.page.url)}?`,
          detail: `${name(ctx)} wants to put ${path} into "${short(ref.meta.name || 'the file field')}" on ${host(ref.page.url)}.`,
        });
      return act(
        ctx,
        { kind: 'upload', ref: ctx.args.ref, path },
        `put ${path.split('/').pop()} into "${ref.meta.name || 'a file field'}"`,
      );
    },
  },
  browser_wait_for: {
    run: async (ctx) => {
      const { key, tab, page } = await live(ctx, tabFor(ctx));
      const { text, selector, url } = ctx.args;
      const { isMet, waitedMs } = await ctx.env.browser.waitFor(page.hostId!, {
        text,
        selector,
        url,
        timeoutMs: ctx.args.timeoutMs ?? 5000,
      });
      return {
        result: {
          ...pageResult(tab, ctx.env.pages.get(key) ?? page),
          isMet,
          waitedMs,
        },
      };
    },
  },
  browser_eval: {
    run: async (ctx) => {
      const { key, tab, page } = await live(ctx, tabFor(ctx));
      const origin = originOf(page.url);
      if (!isLocalUrl(page.url))
        await ctx.confirm({
          title: ctx.args.purpose,
          detail: `A script on ${host(page.url)}, run as you, signed in: it can do anything you can do there.`,
          code: ctx.args.script,
        });
      const changed = `ran a script on ${origin}: ${preview(ctx.args.script)}`;
      try {
        const { value, isTruncated } = await ctx.env.browser.eval(
          page.hostId!,
          ctx.args.script,
        );
        return {
          changed,
          isFinal: true,
          result: {
            ...pageResult(tab, ctx.env.pages.get(key) ?? page),
            value,
            ...(isTruncated && {
              note: 'Cut at 20000 characters; return less, like a slice or a count',
            }),
          },
        };
      } catch (error) {
        // The run still happened, so it's logged like one that returned.
        ctx.dispatch({
          type: 'say',
          threadId: ctx.caller.id,
          entry: {
            who: ctx.caller.providers[0],
            kind: 'event',
            text: `${name(ctx)} ${changed} (threw)`,
          },
        });
        throw error;
      }
    },
  },
  browser_screenshot: {
    run: async (ctx) => {
      const { tab, page } = await live(ctx, tabFor(ctx));
      const data = (
        await ctx.env.browser.capture(page.hostId!, {
          fullPage: !!ctx.args.fullPage,
        })
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
        result: pageResult(tab, page),
        image: { data, mimeType: 'image/png' },
      };
    },
  },
  browser_console: {
    run: async (ctx) => {
      const { tab, page } = await live(ctx, tabFor(ctx));
      const logs = await ctx.env.browser.logs(page.hostId!);
      return {
        result: {
          ...pageResult(tab, page),
          console: logs.map(
            (l) =>
              `${l.level}: ${l.message}${l.source ? ` (${displayUrl(l.source)}:${l.line})` : ''}`,
          ),
        },
      };
    },
  },
  browser_back: { run: (ctx) => command(ctx, 'back', 'went back') },
  browser_forward: { run: (ctx) => command(ctx, 'forward', 'went forward') },
  browser_reload: { run: (ctx) => command(ctx, 'reload', 'reloaded the page') },
  browser_dialog: {
    run: async (ctx) => {
      const { key, tab, page } = await shown(ctx, tabFor(ctx));
      if (!page.dialog) throw new Error('No dialog is open in this tab');
      const { kind, message } = page.dialog;
      await ctx.env.browser.answerDialog(page.hostId!, {
        accept: ctx.args.accept,
      });
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      return {
        changed: `answered ${JSON.stringify(message)} with ${kind === 'confirm' && !ctx.args.accept ? 'Cancel' : 'OK'}`,
        isFinal: true,
        result: pageResult(tab, await loaded(ctx, key)),
      };
    },
  },
  browser_set_device: {
    run: async (ctx) => {
      const device =
        ctx.args.device === RESPONSIVE
          ? null
          : DEVICES.find((d) => d.id === ctx.args.device);
      if (device === undefined)
        throw new Error(
          `No device ${ctx.args.device}; use ${[RESPONSIVE, ...DEVICES.map((d) => d.id)].join(', ')}`,
        );
      const { key, tab } = await live(ctx, tabFor(ctx));
      ctx.env.pages.update(key, {
        device: device?.id ?? RESPONSIVE,
        isRotated: !!ctx.args.rotated,
      });
      return {
        changed: `set the browser to ${device?.label ?? 'responsive'}${ctx.args.rotated ? ', rotated' : ''}`,
        isFinal: true,
        result: { tabId: tab.id, device: device ?? RESPONSIVE },
      };
    },
  },
  browser_handoff: {
    run: async (ctx) => {
      const { key, tab, page } = await live(ctx, tabFor(ctx));
      const { task, doneWhen } = ctx.args;
      if (doneWhen && (await holds(ctx, page.hostId!, doneWhen)))
        throw new Error(
          'doneWhen already holds on this page; pick something that only becomes true once they finish, or leave it out',
        );
      ctx.dispatch({
        type: 'pane-select-tab',
        threadId: ctx.caller.id,
        tabId: tab.id,
      });
      ctx.env.pages.update(key, { hasTakenOver: true, handoff: task });
      try {
        const [done = 'you'] = await ctx.waitOn({
          title: task,
          detail: `${name(ctx)} carries on ${doneWhen ? "once the page shows you're done, or " : ''}when you click Done.`,
          isHandoff: true,
          approved: `Finished: ${task}`,
          denied: `Stopped waiting: ${task}`,
          until: (signal) => handedBack(ctx, key, doneWhen, signal),
        });
        if (!ctx.env.pages.get(key))
          throw new Error('The tab was closed while the user had it');
        return { result: { ...pageResult(tab, await loaded(ctx, key)), done } };
      } finally {
        if (ctx.env.pages.get(key))
          ctx.env.pages.update(key, { hasTakenOver: false, handoff: null });
      }
    },
  },
} satisfies { [K in BrowserToolName]: ToolSpec<K> };

/** Local means this machine or a dev domain: the agent browses those freely; anything else is logged, and forms there ask. */
export function isLocalUrl(url: string) {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol === 'about:' || protocol === 'file:') return true;
    return (
      /^(localhost|0\.0\.0\.0|\[::1\]|127(\.\d{1,3}){3})$/.test(hostname) ||
      /\.(localhost|test)$/.test(hostname)
    );
  } catch {
    return false;
  }
}

export const pageKey = (threadId: string, tabId: string) =>
  `${threadId}/${tabId}`;

/** Each page's latest snapshot refs, so a click knows it's a submit button before acting. Stale once the view or URL changes. */
const lastRefs = new Map<
  string,
  { hostId: string; url: string; refs: BrowserSnapshot['refs'] }
>();

type Ctx = ToolContext<{ tabId?: string; [arg: string]: unknown }>;

/**
 * Clicks that may not be undoable on someone else's site ask first: paying, sending, publishing, deleting. Ordinary steps
 * (Next, Create, Save, Continue, Allow, Sign in) go through; the user watches them in the pane.
 */
const IRREVERSIBLE =
  /\b(pay|buy|purchase|order|checkout|check out|subscribe|send|publish|post|delete|remove|transfer|merge|deploy|withdraw|cancel (my )?(subscription|account)|close (my )?account)\b/i;

// Sites the user said not to ask about again, per thread, for this run of Mochi.
const trusted = new Map<string, Set<string>>();

/** Asks on a card unless the user already trusted this site for the thread; the card offers that trust. */
async function askOnSite(
  ctx: ToolContext<unknown>,
  url: string,
  approval: { title: string; detail: string },
) {
  const site = host(url);
  const thread = ctx.caller.id;
  if (trusted.get(thread)?.has(site)) return;
  const options = await ctx.confirm({
    ...approval,
    options: [
      { id: 'trust', label: `Don't ask again on ${site} in this thread` },
    ],
  });
  if (options.includes('trust'))
    trusted.set(thread, new Set([...(trusted.get(thread) ?? []), site]));
}

/** Opens `url` in a new background tab of the caller's pane, loaded, for a tool that hands the agent a page to act on. */
export async function openInNewTab(ctx: ToolContext<unknown>, url: string) {
  const c = ctx as Ctx;
  c.dispatch({
    type: 'pane-open-tab',
    threadId: c.caller.id,
    kind: 'browser',
    url,
    isBackground: true,
  });
  const tab = browserTabs(c).at(-1)!;
  const { key } = await live(c, tab);
  return pageResult(tab, await loaded(c, key));
}

/** The view behind one of the caller's browser tabs (`tabId`, else the active one), opening one at `url` when it has none. */
export async function tabView(
  ctx: ToolContext<unknown>,
  tabId: string | undefined,
  url: string,
) {
  const c = ctx as Ctx;
  const id =
    tabId ?? activeBrowserTab(c)?.id ?? (await openInNewTab(ctx, url)).tabId;
  return (await live(c, tabFor({ ...c, args: { tabId: id } }))).page.hostId!;
}

/** The view behind `ref` from the latest snapshot of one of the caller's tabs, for main to read that element itself. */
export function refView(
  ctx: ToolContext<unknown>,
  ref: string,
  tabId?: string,
) {
  return refIn({ ...ctx, args: { tabId } } as Ctx, ref).page.hostId!;
}

function browserTabs({ state, caller }: Pick<Ctx, 'state' | 'caller'>) {
  return (
    state()
      .panes.find((p) => p.threadId === caller.id)
      ?.tabs.filter((t) => t.kind === 'browser') ?? []
  );
}

function activeBrowserTab(ctx: Pick<Ctx, 'state' | 'caller'>) {
  const tabs = browserTabs(ctx);
  const pane = ctx.state().panes.find((p) => p.threadId === ctx.caller.id);
  return (
    tabs.find((t) => t.id === pane?.drivenTab) ??
    tabs.find((t) => t.id === pane?.activeTab) ??
    tabs.at(-1)
  );
}

function tabFor(ctx: Ctx) {
  const tabs = browserTabs(ctx);
  if (ctx.args.tabId) {
    const tab = tabs.find((t) => t.id === ctx.args.tabId);
    if (!tab)
      throw new Error(
        `No browser tab ${ctx.args.tabId} in your thread; browser_tabs lists them`,
      );
    return tab;
  }
  const tab = activeBrowserTab(ctx);
  if (!tab)
    throw new Error('Your thread has no browser tab; browser_open opens one');
  return tab;
}

/** `shown`, for a page no dialog blocks: every tool but browser_dialog would wait on its answer. */
async function live(ctx: Ctx, tab: PaneTab) {
  const found = await shown(ctx, tab);
  if (found.page.dialog) throw new Error(dialogNote(found.page.dialog));
  // What they type there (a password, a code) is theirs: nothing reads or acts on the tab until they're done.
  if (found.page.handoff)
    throw new Error(
      `The user has this tab for "${found.page.handoff}"; browser_handoff returns once they're done`,
    );
  return found;
}

const HANDOFF_POLL_MS = 500;

/**
 * 'you' once they give the tab back in the pane; 'detected' once `doneWhen` holds on a loaded page two polls running, so
 * a redirect passing through doesn't count. Rejects once the card is answered.
 */
async function handedBack(
  ctx: Ctx,
  key: string,
  doneWhen: Omit<BrowserWait, 'timeoutMs'> | undefined,
  signal: AbortSignal,
) {
  let wasMet = false;
  while (!signal.aborted) {
    await new Promise((r) => setTimeout(r, HANDOFF_POLL_MS));
    const page = ctx.env.pages.get(key);
    if (!page?.hasTakenOver) return 'you';
    const isMet =
      !!doneWhen &&
      !page.isLoading &&
      (await holds(ctx, page.hostId!, doneWhen));
    if (isMet && wasMet) return 'detected';
    wasMet = isMet;
  }
  throw new Error('The card was answered');
}

/** Whether `until` holds right now; a page mid-navigation, or a bad selector, reads as not yet. */
const holds = (
  ctx: Ctx,
  hostId: string,
  until: Omit<BrowserWait, 'timeoutMs'>,
) =>
  ctx.env.browser.waitFor(hostId, { ...until, timeoutMs: 1 }).then(
    (r) => r.isMet,
    () => false,
  );

/** Marks the tab as driven, so it floats unless it's already in front, and waits for its native view. Off screen, the view is opened hidden: CDP drives and captures it without a window. */
async function shown(ctx: Ctx, tab: PaneTab) {
  const { state, caller, dispatch, env } = ctx;
  const key = pageKey(caller.id, tab.id);
  env.pages.open(key, tab.url ?? '', caller.spaceId);
  if (state().panes.find((p) => p.threadId === caller.id)?.drivenTab !== tab.id)
    dispatch({ type: 'pane-drive', threadId: caller.id, tabId: tab.id });
  const page = await until(
    () => env.pages.get(key)?.hostId && env.pages.get(key),
    VIEW_TIMEOUT_MS,
  );
  if (!page)
    throw new Error(
      env.isDesktop
        ? 'The browser tab did not start in time; try again'
        : 'Driving the browser needs the Mochi desktop app',
    );
  return { key, tab, page };
}

async function loaded(ctx: Ctx, key: string) {
  const page = await until(() => {
    const p = ctx.env.pages.get(key);
    return p && !p.isLoading && p.hostId ? p : null;
  }, LOAD_TIMEOUT_MS);
  return page ?? ctx.env.pages.get(key)!;
}

function refIn(ctx: Ctx, ref: string) {
  const tab = tabFor(ctx);
  const key = pageKey(ctx.caller.id, tab.id);
  const page = ctx.env.pages.get(key);
  const last = lastRefs.get(key);
  const meta =
    last && last.hostId === page?.hostId && last.url === page.url
      ? last.refs[ref]
      : undefined;
  if (!meta || !page)
    throw new Error(
      `No ref ${ref} from a snapshot of this tab; call browser_snapshot first`,
    );
  return { meta, page };
}

async function act(
  ctx: Ctx,
  action: BrowserAct,
  changed: string,
  glyph?: EventGlyph,
) {
  const { key, tab, page } = await live(ctx, tabFor(ctx));
  const { note } = await ctx.env.browser.act(page.hostId!, action);
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  const after = await loaded(ctx, key);
  // The page shows as its favicon and host on the line (`EventLine`), never its full URL.
  return {
    ...(changed && { changed, site: after.url, ...(glyph && { glyph }) }),
    isFinal: true,
    result: { ...pageResult(tab, after), ...(note && { note }) },
  };
}

async function command(
  ctx: Ctx,
  which: 'back' | 'forward' | 'reload',
  changed: string,
) {
  const { key, tab, page } = await live(ctx, tabFor(ctx));
  if (
    (which === 'back' && !page.canGoBack) ||
    (which === 'forward' && !page.canGoForward)
  )
    throw new Error(`Nothing to go ${which} to in this tab`);
  await ctx.env.browser.command(page.hostId!, which);
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  const after = await loaded(ctx, key);
  return {
    changed,
    glyph: 'browse' as const,
    site: after.url,
    isFinal: true,
    result: pageResult(tab, after),
  };
}

/** An element's name as a line quotes it: accessible names can run long (a whole account card), so the first 40 characters. */
function short(name: string) {
  const line = name.replace(/\s+/g, ' ').trim();
  return line.length > 40 ? `${line.slice(0, 39).trimEnd()}…` : line;
}

function pageResult(tab: PaneTab, page: Page) {
  return {
    tabId: tab.id,
    url: page.url,
    title: page.title,
    ...(page.error && { error: page.error }),
  };
}

async function until<T>(
  read: () => T | null | undefined | '' | false,
  timeout: number,
): Promise<T | null> {
  const end = Date.now() + timeout;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > end) return null;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

const PREVIEW_CHARS = 80;

const preview = (script: string) => {
  const line = script.replace(/\s+/g, ' ').trim();
  return line.length > PREVIEW_CHARS
    ? `${line.slice(0, PREVIEW_CHARS - 1)}…`
    : line;
};

const originOf = (url: string) => {
  try {
    const { origin, protocol } = new URL(url);
    return origin === 'null' ? protocol : origin;
  } catch {
    return url;
  }
};

/** `path` against the worktree, with . and .. folded; null for a relative path with no worktree. */
export function resolvePath(root: string | null | undefined, path: string) {
  if (!path.startsWith('/') && !root) return null;
  const parts: string[] = [];
  for (const part of (path.startsWith('/') ? path : `${root}/${path}`).split(
    '/',
  )) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return `/${parts.join('/')}`;
}

const isInside = (root: string, path: string) =>
  path === resolvePath(root, '.') ||
  path.startsWith(`${resolvePath(root, '.')}/`);

const name = (ctx: Ctx) => authorName(ctx.caller.providers[0]);

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
