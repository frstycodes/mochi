import type { WebContents, WebContentsView } from 'electron';
import { chromium, type Browser, type Page } from 'playwright-core';
import { withTimeout } from '@mochi/core/browser/evaluate';
import { serveRelay } from './relay.ts';

/** What a view needs to be driven by Playwright; `views.ts`'s Entry carries it. */
export interface Automated {
  view: WebContentsView;
  automation: Automation | null;
}

interface Automation {
  connection: Promise<{ browser: Browser; page: Page }>;
  relay: Awaited<ReturnType<typeof serveRelay>> | null;
  idle: NodeJS.Timeout | undefined;
}

const CONNECT_TIMEOUT_MS = 10_000;
// A connected tab keeps painting and running timers while hidden, so an unused connection is closed.
const IDLE_MS = 60_000;
const CLOSE_TIMEOUT_MS = 3000;
// Playwright's settings outlive it on the shared debugger; left on, new frames would wait for a debugger that's gone.
const RESETS = [
  [
    'Target.setAutoAttach',
    { autoAttach: false, waitForDebuggerOnStart: false, flatten: true },
  ],
  ['Emulation.setFocusEmulationEnabled', { enabled: false }],
  ['Network.disable', {}],
  ['Runtime.disable', {}],
] as const;

// With no 'dialog' listener Playwright dismisses every dialog at once; this one leaves it to the user's sheet or browser_dialog.
const LEAVE_OPEN = () => {};

const forwarding = new WeakSet<WebContents>();
const targetIds = new WeakMap<WebContents, Promise<string>>();

/** Electron allows one debugger client per webContents: Mochi's own CDP calls and Playwright's relay share this attach. */
export async function debuggerFor(wc: WebContents) {
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
  return wc.debugger;
}

/** The view's Playwright page, connected on first use and dropped after `IDLE_MS` without a call. */
export async function pageFor(entry: Automated): Promise<Page> {
  const automation = (entry.automation ??= connect(entry));
  clearTimeout(automation.idle);
  automation.idle = setTimeout(() => dropPage(entry), IDLE_MS);
  return (await automation.connection).page;
}

export function dropPage(entry: Automated) {
  const automation = entry.automation;
  if (!automation) return;
  entry.automation = null;
  clearTimeout(automation.idle);
  automation.relay?.close();
  automation.connection
    .then(({ browser }) => withTimeout(browser.close(), CLOSE_TIMEOUT_MS))
    .catch(() => {});
  // A view whose page closed itself has no webContents left.
  const wc = entry.view.webContents as WebContents | undefined;
  if (!wc || wc.isDestroyed() || !wc.debugger.isAttached()) return;
  for (const [method, params] of RESETS)
    wc.debugger.sendCommand(method, params).catch(() => {});
}

function connect(entry: Automated): Automation {
  const automation = { relay: null, idle: undefined } as Automation;
  automation.connection = open(entry, automation);
  automation.connection.catch(() => {
    if (entry.automation === automation) dropPage(entry);
  });
  return automation;
}

async function open(entry: Automated, automation: Automation) {
  const wc = entry.view.webContents;
  const dbg = await debuggerFor(wc);
  forwardEvents(entry, wc);
  const relay = await serveRelay({
    send: (method, params, sessionId) =>
      dbg.sendCommand(method, params, sessionId),
    targetId: () => targetIdOf(wc),
    url: () => wc.getURL(),
    title: () => wc.getTitle(),
    userAgent: () => wc.getUserAgent(),
  });
  if (entry.automation !== automation) {
    relay.close();
    throw new Error('The browser tab closed');
  }
  automation.relay = relay;
  // noDefaults keeps Playwright off Mochi's media emulation, so focus emulation (hidden windows still take input) is set here.
  await dbg.sendCommand('Emulation.setFocusEmulationEnabled', {
    enabled: true,
  });
  const browser = await chromium.connectOverCDP(relay.endpoint, {
    timeout: CONNECT_TIMEOUT_MS,
    isLocal: true,
    noDefaults: true,
  });
  const page = browser.contexts()[0]?.pages()[0];
  if (!page) throw new Error('Playwright found no page in this tab');
  page.on('dialog', LEAVE_OPEN);
  return { browser, page };
}

function forwardEvents(entry: Automated, wc: WebContents) {
  if (forwarding.has(wc)) return;
  forwarding.add(wc);
  wc.debugger.on('message', (_event, method, params, sessionId) =>
    entry.automation?.relay?.event(method, params, sessionId),
  );
}

// Stable across renderer swaps and a crash plus reload.
function targetIdOf(wc: WebContents) {
  const cached = targetIds.get(wc);
  if (cached) return cached;
  const id = wc.debugger
    .sendCommand('Target.getTargetInfo')
    .then((r: { targetInfo: { targetId: string } }) => r.targetInfo.targetId);
  id.catch(() => targetIds.delete(wc));
  targetIds.set(wc, id);
  return id;
}
