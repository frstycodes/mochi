import { existsSync } from 'node:fs';
import type {
  Browser,
  BrowserContext,
  CDPSession,
  Dialog,
  Page,
} from 'playwright-core';
import { Schema } from 'effect';
import { definitionOf } from '@mochi/schema';
import type {
  BrowserAct,
  BrowserCommand,
  BrowserEmulation,
  BrowserEvent,
  BrowserLog,
  BrowserWait,
  ScrollPosition,
} from '@mochi/domain/host/types/browser';
import { dialogNote } from '../../../../apps/desktop/src/browser/dialog.ts';
import { push } from '../agents/events.ts';
import type { Call, LocalCapability } from '../hostServer.ts';
import {
  evalResult,
  EVAL_TIMEOUT_MS,
  withTimeout,
  type CdpEvaluate,
} from './evaluate.ts';

// Loaded with the first view, so `mochi serve` doesn't load Playwright until a browser tool runs.
const drive = () => import('./drive.ts');

/** What every browser tool answers on a computer where Chromium can't be found, downloaded or started. */
export const NO_BROWSER = 'this computer has no browser';

/** Starts the Chromium Core drives; rejects when there is none to start. */
export type Launcher = () => Promise<Browser>;

/**
 * Playwright's headless Chromium, downloaded into `browsersPath` the first time it's needed (the registry `npx playwright
 * install` uses), so `mochi serve` ships without it.
 */
export const chromiumLauncher =
  (browsersPath: string | undefined): Launcher =>
  async () => {
    // The registry reads its folder once, when first loaded; nothing in Core loads it before this.
    if (browsersPath) process.env['PLAYWRIGHT_BROWSERS_PATH'] ??= browsersPath;
    const { registry } = await import('playwright-core/lib/coreBundle');
    const shell = registry.registry.findExecutable('chromium-headless-shell');
    if (!shell) throw new Error('Playwright has no headless Chromium here');
    const path = () => shell.executablePath('javascript');
    if (!existsSync(path() ?? '')) await registry.registry.install([shell]);
    const executablePath = path();
    if (!executablePath || !existsSync(executablePath))
      throw new Error('Headless Chromium did not install');
    const { chromium } = await import('playwright-core');
    return chromium.launch({ executablePath, headless: true });
  };

interface View {
  page: Page;
  cdp: Promise<CDPSession>;
  /** The window that opened it, so its events go back there; unset for a browser page Core serves. */
  windowId: number | undefined;
  /** Counts snapshots; an agent ref carries the one it came from. */
  generation: number;
  logs: BrowserLog[];
  dialog: Dialog | null;
  error: string | null;
  mirror: Mirror | null;
}

interface Mirror {
  timer: NodeJS.Timeout | null;
  delay: number;
  last: string | null;
}

// Apart from main's `view-N`, so a view made here never collides with one main makes after it connects.
const FIRST_ID = 1_000_000;
const LOG_LIMIT = 200;
const NAVIGATE_TIMEOUT_MS = 15_000;
// As main's mirror: every 100 ms while the page changes, backing off to 800 ms while it doesn't.
const MIRROR_INTERVAL_MS = 100;
const MIRROR_IDLE_MS = 800;
const MIRROR_QUALITY = 70;
const PEEK_QUALITY = 85;
const LOG_LEVELS = {
  debug: 'debug',
  log: 'info',
  info: 'info',
  warning: 'warning',
  error: 'error',
} as const satisfies Record<string, BrowserLog['level']>;

/**
 * `browserView` served by Core from headless Chromium, for a backend with no Electron main (`mochi serve`). Chromium starts
 * on the first `browser.create`, never at launch. Its views are the same `host.browser.*` calls the desktop's Electron views
 * answer; what needs a window (bounds, devtools, find, the picker) does nothing, and the page is seen through `mirror`'s
 * frames, which go out on the push stream as `browser:onEvent` like every Core push.
 */
export function headlessBrowser(launch: Launcher): LocalCapability {
  const views = new Map<string, View>();
  const contexts = new Map<string, Promise<BrowserContext>>();
  let browser: Promise<Browser> | null = null;
  let hasFailed = false;
  let nextId = FIRST_ID;

  const started = () => {
    if (hasFailed) return Promise.reject(new Error(NO_BROWSER));
    return (browser ??= launch().then(
      (b) => {
        // A crash drops everything; the next create starts a new one.
        b.on('disconnected', () => {
          browser = null;
          contexts.clear();
          for (const id of views.keys()) closed(id);
        });
        return b;
      },
      (error: unknown) => {
        hasFailed = true;
        browser = null;
        console.warn('Headless Chromium is unavailable:', error);
        throw new Error(NO_BROWSER);
      },
    ));
  };

  // Per space, as main's `persist:space-<id>` partitions. GAP: kept in memory, so logins don't outlive Core.
  const contextFor = (spaceId: string) => {
    const existing = contexts.get(spaceId);
    if (existing) return existing;
    const made = started().then((b) => b.newContext());
    made.catch(() => contexts.delete(spaceId));
    contexts.set(spaceId, made);
    return made;
  };

  const emit = (view: View, event: BrowserEvent) =>
    push({
      channel: 'browser:onEvent',
      payload: event,
      ...(view.windowId === undefined ? {} : { windowId: view.windowId }),
    });

  const register = (page: Page, windowId: number | undefined) => {
    const id = `view-${++nextId}`;
    const view: View = {
      page,
      cdp: page.context().newCDPSession(page),
      windowId,
      generation: 0,
      logs: [],
      dialog: null,
      error: null,
      mirror: null,
    };
    view.cdp.catch(() => {});
    views.set(id, view);
    wire(id, view);
    return id;
  };

  const wire = (id: string, view: View) => {
    const { page } = view;
    const state = () => void sendState(id, view);
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      view.error = null;
      state();
    });
    page.on('load', state);
    page.on('domcontentloaded', state);
    page.on('console', (message) => {
      const level =
        LOG_LEVELS[message.type() as keyof typeof LOG_LEVELS] ?? 'info';
      const { url, lineNumber } = message.location();
      const log = {
        level,
        message: message.text(),
        source: url,
        line: lineNumber,
      };
      view.logs = [...view.logs, log].slice(-LOG_LIMIT);
      if (level === 'error' || level === 'warning')
        emit(view, { id, type: 'console', ...log, level });
    });
    // Left open for the agent's browser_dialog, as main does: Playwright would dismiss it at once with no listener.
    page.on('dialog', (dialog) => {
      const kind = dialog.type() === 'alert' ? 'alert' : 'confirm';
      if (dialog.type() !== 'alert' && dialog.type() !== 'confirm')
        return void dialog.dismiss().catch(() => {});
      view.dialog = dialog;
      emit(view, { id, type: 'dialog', kind, message: dialog.message() });
    });
    page.on('popup', (popup) => {
      const viewId = register(popup, view.windowId);
      emit(view, { id, type: 'popup', viewId, url: popup.url() });
    });
    page.on('close', () => {
      if (!views.has(id)) return;
      emit(view, { id, type: 'closed' });
      closed(id);
    });
  };

  const closed = (id: string) => {
    const view = views.get(id);
    if (!view) return;
    stopMirror(view);
    views.delete(id);
  };

  const sendState = async (id: string, view: View) => {
    const history = await view.cdp
      .then(
        (cdp) =>
          cdp.send('Page.getNavigationHistory') as Promise<{
            currentIndex: number;
            entries: unknown[];
          }>,
      )
      .catch(() => null);
    if (!views.has(id)) return;
    emit(view, {
      id,
      type: 'state',
      url: view.page.url(),
      title: await view.page.title().catch(() => ''),
      isLoading: false,
      canGoBack: !!history && history.currentIndex > 0,
      canGoForward:
        !!history && history.currentIndex < history.entries.length - 1,
      error: view.error,
      favicon: null,
    });
    kickMirror(id, view);
  };

  /** Waits for the page's DOM, so a snapshot right after reads the new page; a failed load is the page's state, not the call's. */
  const load = async (id: string, view: View, go: () => Promise<unknown>) => {
    view.error = null;
    await go().catch((error: unknown) => {
      view.error = (
        error instanceof Error ? error.message : String(error)
      ).split('\n')[0]!;
    });
    await sendState(id, view);
  };

  const get = (id: string) => {
    const view = views.get(id);
    if (!view) throw new Error(`browser: unknown view ${id}`);
    return view;
  };

  const sendFrame = async (id: string, view: View) => {
    const mirror = view.mirror;
    if (!mirror) return;
    mirror.timer = null;
    const shot = await view.page
      .screenshot({ type: 'jpeg', quality: MIRROR_QUALITY, scale: 'css' })
      .then((b) => b.toString('base64'))
      .catch(() => null);
    if (view.mirror !== mirror || !views.has(id)) return;
    const isChanged = !!shot && shot !== mirror.last;
    if (isChanged) {
      mirror.last = shot;
      emit(view, { id, type: 'frame', data: `data:image/jpeg;base64,${shot}` });
    }
    mirror.delay = isChanged
      ? MIRROR_INTERVAL_MS
      : Math.min(mirror.delay * 2, MIRROR_IDLE_MS);
    mirror.timer = setTimeout(() => void sendFrame(id, view), mirror.delay);
  };

  /** Back to full rate, capturing now unless a capture is already under way. */
  const kickMirror = (id: string, view: View) => {
    const mirror = view.mirror;
    if (!mirror || !mirror.timer) return;
    clearTimeout(mirror.timer);
    mirror.delay = MIRROR_INTERVAL_MS;
    void sendFrame(id, view);
  };

  const stopMirror = (view: View) => {
    if (view.mirror?.timer) clearTimeout(view.mirror.timer);
    view.mirror = null;
  };

  const evaluate = async (view: View, expression: string) =>
    evalResult(
      await withTimeout(
        view.cdp.then(
          (cdp) =>
            cdp.send('Runtime.evaluate', {
              expression,
              replMode: true,
              awaitPromise: true,
              returnByValue: true,
              userGesture: true,
              timeout: EVAL_TIMEOUT_MS,
            }) as Promise<CdpEvaluate>,
        ),
      ),
    );

  /** Playwright's action waits for the dialog it opened to be answered; the agent gets the dialog back as a note instead. */
  const dialogOpened = (view: View, signal: AbortSignal) =>
    new Promise<{ note: string }>((resolve) => {
      const onDialog = (dialog: Dialog) =>
        resolve({ note: dialogNote(dialogOf(dialog)) });
      view.page.on('dialog', onDialog);
      signal.addEventListener('abort', () => view.page.off('dialog', onDialog));
    });

  const command = (view: View, which: BrowserCommand) => {
    const { page } = view;
    const options = {
      timeout: NAVIGATE_TIMEOUT_MS,
      waitUntil: 'commit',
    } as const;
    switch (which) {
      case 'back':
        return page.goBack(options);
      case 'forward':
        return page.goForward(options);
      case 'reload':
      case 'hard-reload':
        return page.reload(options);
      case 'stop':
        return page.evaluate(() => window.stop());
    }
  };

  const emulate = async (view: View, e: BrowserEmulation) => {
    if (e.width && e.height)
      await view.page.setViewportSize({ width: e.width, height: e.height });
    await view.page.emulateMedia({
      colorScheme: e.colorScheme,
      reducedMotion: e.reducedMotion ? 'reduce' : 'no-preference',
    });
  };

  const scroll = async (view: View, to: ScrollPosition | null) => {
    if (to) await view.page.evaluate(({ x, y }) => scrollTo(x, y), to);
    return view.page.evaluate(() => ({
      x: Math.round(scrollX),
      y: Math.round(scrollY),
    }));
  };

  // Each takes its method's arguments, already checked against `browserRpc` by Core's host handlers.
  const methods: Record<
    string,
    (args: never, windowId: number | undefined) => unknown
  > = {
    create: async (
      [{ url, spaceId }]: [{ url: string; spaceId: string }],
      windowId,
    ) => {
      const page = await (await contextFor(spaceId)).newPage();
      const id = register(page, windowId);
      const view = get(id);
      await load(id, view, () =>
        page.goto(url, {
          timeout: NAVIGATE_TIMEOUT_MS,
          waitUntil: 'domcontentloaded',
        }),
      );
      return { id };
    },
    destroy: async ([id]: [string]) => {
      const view = views.get(id);
      if (!view) return;
      closed(id);
      await view.page.close().catch(() => {});
    },
    navigate: ([id, url]: [string, string]) => {
      const view = get(id);
      return load(id, view, () =>
        view.page.goto(url, {
          timeout: NAVIGATE_TIMEOUT_MS,
          waitUntil: 'domcontentloaded',
        }),
      );
    },
    command: ([id, which]: [string, BrowserCommand]) => {
      const view = get(id);
      return load(id, view, () => command(view, which));
    },
    mirror: ([id, viewport]: [
      string,
      { width: number; height: number } | null,
    ]) => {
      const view = get(id);
      stopMirror(view);
      if (!viewport) return;
      view.mirror = { timer: null, delay: MIRROR_INTERVAL_MS, last: null };
      return view.page
        .setViewportSize({
          width: Math.round(viewport.width),
          height: Math.round(viewport.height),
        })
        .then(() => sendFrame(id, view));
    },
    emulate: ([id, e]: [string, BrowserEmulation]) => emulate(get(id), e),
    capture: async ([id, { fullPage }]: [string, { fullPage: boolean }]) =>
      `data:image/png;base64,${(await get(id).page.screenshot({ fullPage })).toString('base64')}`,
    peek: async ([id]: [string]) =>
      `data:image/jpeg;base64,${(await get(id).page.screenshot({ type: 'jpeg', quality: PEEK_QUALITY })).toString('base64')}`,
    snapshot: async ([id]: [string]) => {
      const view = get(id);
      if (view.dialog) throw new Error(dialogNote(dialogOf(view.dialog)));
      const { snapshotPage } = await drive();
      return snapshotPage(view.page, () => ++view.generation);
    },
    act: async ([id, act]: [string, BrowserAct]) => {
      const view = get(id);
      if (view.dialog) throw new Error(dialogNote(dialogOf(view.dialog)));
      const { rethrowForAgent, runAct } = await drive();
      const done = new AbortController();
      return Promise.race([
        runAct(view.page, view.generation, act),
        dialogOpened(view, done.signal),
      ])
        .catch(rethrowForAgent)
        .finally(() => {
          done.abort();
          kickMirror(id, view);
        });
    },
    logs: ([id]: [string]) => get(id).logs,
    eval: ([id, script]: [string, string]) => evaluate(get(id), script),
    waitFor: async ([id, until]: [string, BrowserWait]) => {
      const start = Date.now();
      const { waitOnPage } = await drive();
      return waitOnPage(get(id).page, until, start);
    },
    answerDialog: async ([id, { accept }]: [string, { accept: boolean }]) => {
      const view = get(id);
      const dialog = view.dialog;
      if (!dialog) throw new Error('No dialog is open in this tab');
      view.dialog = null;
      await (accept ? dialog.accept() : dialog.dismiss());
      emit(view, { id, type: 'dialog', kind: null });
    },
    scroll: ([id, to]: [string, ScrollPosition | null]) => scroll(get(id), to),
    clearData: async ([spaceId]: [string]) => {
      const context = await contexts.get(spaceId)?.catch(() => null);
      await context?.clearCookies();
      await context?.clearPermissions();
    },
    pick: () => null,
    defaultBrowser: () => '',
    suggest: () => [],
    // A headless page has no window to place, zoom, search in or show devtools for.
    setBounds: () => undefined,
    setZoom: () => undefined,
    devtools: () => undefined,
    cancelPick: () => undefined,
    find: () => undefined,
    stopFind: () => undefined,
    menuCommand: () => undefined,
    autoReload: () => undefined,
    compareStop: () => undefined,
    compareStart: () => {
      throw new Error('Comparing branches needs the desktop app');
    },
    openExternal: () => {
      throw new Error('This computer has no browser window to open links in');
    },
    showDownload: () => {
      throw new Error('This computer saves no downloads to show');
    },
  };

  return {
    owns: ({ args }) => typeof args[0] === 'string' && views.has(args[0]),
    async call({ method, args, windowId }: Call) {
      const name = method.replace(/^browser\./, '');
      const run = methods[name];
      if (!run) throw new Error(`browser: no ${name} here`);
      if (hasFailed && name !== 'defaultBrowser' && name !== 'suggest')
        throw new Error(NO_BROWSER);
      // JSON both ways, as a client's answer is (main's `mainCapabilities`).
      const { input, output } = definitionOf(method) as {
        input: Schema.Codec<ReadonlyArray<unknown>, unknown>;
        output: Schema.Codec<unknown, unknown>;
      };
      const decoded = Schema.decodeUnknownSync(Schema.toCodecJson(input))(args);
      return Schema.encodeUnknownSync(Schema.toCodecJson(output))(
        await run(decoded as never, windowId),
      );
    },
    isAvailable: () => !hasFailed,
  };
}

const dialogOf = (dialog: Dialog) => ({
  kind: dialog.type() === 'alert' ? ('alert' as const) : ('confirm' as const),
  message: dialog.message(),
});
