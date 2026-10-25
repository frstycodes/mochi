// Electron main for tests/e2e/browser.spec.ts. Hosts the WebContentsViews and the electron/browser modules under
// test and exposes one RPC, globalThis.smoke.call, that the spec reaches through ElectronApplication.evaluate.
import {
  app,
  BrowserWindow,
  session,
  WebContentsView,
  webContents,
} from 'electron';
import { once } from 'node:events';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const PARTITION = 'persist:smoke';
const WEB_PREFERENCES = {
  partition: PARTITION,
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  webSecurity: true,
};
const BOUNDS = { x: 0, y: 0, width: 900, height: 700 };

// Windows come and go during a run; the app must outlive them.
app.on('window-all-closed', () => {});

const withTimeout = (promise, ms, label = 'timeout') =>
  Promise.race([
    promise,
    new Promise((resolve) => setTimeout(resolve, ms, label)),
  ]);
const waitFor = (emitter, event, ms) =>
  withTimeout(
    once(emitter, event).then((args) => args),
    ms,
    null,
  );
const errorMessage = (error) =>
  error instanceof Error ? error.message : String(error);

const ready = (async () => {
  await app.whenReady();
  const serve = async (host) => {
    const server = createServer(async (req, res) => {
      const path = new URL(req.url, 'http://x').pathname;
      if (path === '/download') {
        res.writeHead(200, {
          'content-type': 'text/plain',
          'content-disposition': 'attachment; filename="smoke.txt"',
        });
        return res.end('smoke download\n');
      }
      if (path === '/popup.html') {
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end(
          '<!doctype html><title>Smoke popup</title><p id="status"></p><script>' +
            "document.getElementById('status').textContent = window.opener ? 'has opener' : 'no opener';" +
            "if (window.opener) window.opener.postMessage('hi', '*');</script>" +
            '<button id="ping" type="button" onclick="window.opener.postMessage(\'ping\', \'*\')">Ping opener</button>' +
            '<button id="close" type="button" onclick="window.close()">Close me</button>',
        );
      }
      try {
        const body = await readFile(join(FIXTURES, path.replace(/^\/+/, '')));
        res.writeHead(200, {
          'content-type': path.endsWith('.html')
            ? 'text/html'
            : 'application/octet-stream',
        });
        res.end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return `http://${host}:${server.address().port}`;
  };
  // Different hosts make a different site, which is what forces a renderer swap.
  return {
    a: await serve('127.0.0.1'),
    b: await serve('localhost'),
    downloads: await mkdtemp(join(tmpdir(), 'mochi-smoke-')),
    relay: await import('../../electron/browser/relay.ts'),
    views: await import('../../electron/browser/views.ts'),
    playwright: await import('../../electron/browser/playwright.ts'),
  };
})();

const createView = (win, webPreferences = WEB_PREFERENCES, bounds = BOUNDS) => {
  const view = new WebContentsView({ webPreferences });
  win.contentView.addChildView(view);
  view.setBounds(bounds);
  return view;
};

// The bare view: our own debugger attached, Playwright joining through the CDP relay.
const main = {};

const mainApi = {
  async open() {
    const { a } = await ready;
    main.win = new BrowserWindow({ ...BOUNDS, show: true, title: 'smoke' });
    main.wc = createView(main.win).webContents;
    await main.wc.loadURL(`${a}/browser-smoke.html`);
    main.wc.debugger.attach('1.3');
  },
  async info() {
    const { targetInfo } = await main.wc.debugger.sendCommand(
      'Target.getTargetInfo',
    );
    return {
      url: main.wc.getURL(),
      targetId: targetInfo.targetId,
      type: targetInfo.type,
      pid: main.wc.getOSProcessId(),
    };
  },
  async download(name) {
    const { downloads } = await ready;
    const savePath = join(downloads, `${name}.txt`);
    const done = new Promise((resolve) => {
      session.fromPartition(PARTITION).once('will-download', (_event, item) => {
        item.setSavePath(savePath);
        item.once('done', (_e, state) => resolve(state));
      });
    });
    await main.wc.executeJavaScript(
      "document.getElementById('download').click()",
    );
    const state = await withTimeout(done, 5000);
    return {
      state,
      text: state === 'completed' ? await readFile(savePath, 'utf8') : null,
    };
  },
  setHidden: (hidden) => (hidden ? main.win.hide() : main.win.show()),
  isVisible: () => main.win.isVisible(),
  // Our own view of visibility, with no Playwright involved.
  visibility: () =>
    withTimeout(
      main.wc.executeJavaScript(
        "new Promise((r) => { const v = document.visibilityState; requestAnimationFrame(() => r(v + ' raf fired')); setTimeout(() => r(v + ' raf did not fire in 1s'), 1000); })",
      ),
      3000,
    ),
  innerWidth: () => main.wc.executeJavaScript('window.innerWidth'),
  // Set before Playwright connects, as views.ts does for device emulation.
  setMobileMetrics: () =>
    main.wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
    }),
  clearMetrics: () =>
    main.wc.debugger.sendCommand('Emulation.clearDeviceMetricsOverride'),
  async connect() {
    const { relay } = await ready;
    const wc = main.wc;
    main.relay = await relay.serveRelay({
      send: (method, params, sessionId) =>
        wc.debugger.sendCommand(method, params, sessionId),
      targetId: () =>
        wc.debugger
          .sendCommand('Target.getTargetInfo')
          .then((r) => r.targetInfo.targetId),
      url: () => wc.getURL(),
      title: () => wc.getTitle(),
      userAgent: () => wc.getUserAgent(),
    });
    main.onMessage = (_event, method, params, sessionId) =>
      main.relay.event(method, params, sessionId);
    wc.debugger.on('message', main.onMessage);
    return main.relay.endpoint;
  },
  disconnect() {
    main.wc.debugger.off('message', main.onMessage);
    main.relay.close();
  },
  installPopupHandler() {
    main.popupAttempts = [];
    main.wc.setWindowOpenHandler(() => ({
      action: 'allow',
      outlivesOpener: true,
      createWindow: (options) => {
        const attempts = main.popupAttempts;
        attempts.push(
          `options.webContents=${options.webContents ? 'present' : 'absent'}`,
        );
        let popup;
        try {
          popup = new WebContentsView(options);
          attempts.push('new WebContentsView(options) ok');
        } catch (error) {
          attempts.push(
            `new WebContentsView(options) threw: ${errorMessage(error)}`,
          );
          popup = new WebContentsView({ webContents: options.webContents });
          attempts.push('new WebContentsView({ webContents }) ok');
        }
        main.win.contentView.addChildView(popup);
        popup.setBounds({ x: 500, y: 400, width: 380, height: 280 });
        return popup.webContents;
      },
    }));
  },
  popupAttempts: () => main.popupAttempts,
  async popup() {
    const popupWc = webContents
      .getAllWebContents()
      .find((c) => c.getURL().endsWith('/popup.html'));
    if (!popupWc) return null;
    const status = await popupWc.executeJavaScript(
      "document.getElementById('status').textContent",
    );
    return { url: popupWc.getURL(), status };
  },
  closePopup: () =>
    webContents
      .getAllWebContents()
      .find((c) => c.getURL().endsWith('/popup.html'))
      ?.close(),
  cover() {
    main.cover = new BrowserWindow({ ...BOUNDS, show: true, title: 'cover' });
    main.cover.focus();
    main.win.showInactive();
    main.cover.moveTop();
  },
  focus: () => ({
    win: main.win.isFocused(),
    cover: main.cover.isFocused(),
  }),
  uncover() {
    main.cover.destroy();
    main.win.show();
    main.win.focus();
  },
  async crash() {
    const gone = waitFor(main.wc, 'render-process-gone', 5000);
    main.wc.forcefullyCrashRenderer();
    const args = await gone;
    return args && args[1].reason;
  },
  async reload() {
    const loaded = waitFor(main.wc, 'did-finish-load', 10_000);
    main.wc.reload();
    await loaded;
    if (!main.wc.debugger.isAttached()) main.wc.debugger.attach('1.3');
  },
  debuggerAttached: () => main.wc.debugger.isAttached(),
};

// JS dialogs with no Playwright connected. Each runs in its own window, destroyed afterwards,
// because Electron's native dialog box outlives the dialog being answered over CDP.
const dialogWindow = async (webPreferences = WEB_PREFERENCES) => {
  const { a } = await ready;
  const win = new BrowserWindow({
    x: 950,
    y: 0,
    width: 420,
    height: 300,
    show: true,
    title: 'dialog',
  });
  const view = createView(win, webPreferences, {
    x: 0,
    y: 0,
    width: 420,
    height: 300,
  });
  await view.webContents.loadURL(`${a}/browser-smoke.html`);
  return { win, wc: view.webContents };
};

const dialogsApi = {
  async alertWithoutDebugger() {
    const raw = await dialogWindow();
    const started = Date.now();
    const pending = raw.wc.executeJavaScript("alert('x'); 'returned'");
    const result = await withTimeout(pending, 3000);
    raw.win.destroy();
    return `executeJavaScript -> ${JSON.stringify(result)} after ${Date.now() - started}ms`;
  },
  async confirmWithOwnDebugger() {
    const hooked = await dialogWindow();
    hooked.wc.debugger.attach('1.3');
    await hooked.wc.debugger.sendCommand('Page.enable');
    const opening = waitFor(hooked.wc.debugger, 'message', 3000);
    const evaluation = hooked.wc.executeJavaScript("confirm('y')");
    const message = await opening;
    await hooked.wc.debugger.sendCommand('Page.handleJavaScriptDialog', {
      accept: true,
    });
    const result = await withTimeout(evaluation, 3000);
    hooked.win.destroy();
    return `${message ? `${message[1]} ${JSON.stringify(message[2])}` : 'no debugger message in 3s'}; confirm() -> ${JSON.stringify(result)}`;
  },
  async confirmWithDialogsDisabled() {
    const silenced = await dialogWindow({
      ...WEB_PREFERENCES,
      disableDialogs: true,
    });
    silenced.wc.debugger.attach('1.3');
    await silenced.wc.debugger.sendCommand('Page.enable');
    const opening = waitFor(silenced.wc.debugger, 'message', 2000);
    const result = withTimeout(
      silenced.wc.executeJavaScript("confirm('z')"),
      2000,
    );
    const message = await opening;
    const out = `event=${message ? message[1] : 'none'} confirm() -> ${JSON.stringify(await result)}`;
    silenced.win.destroy();
    return out;
  },
};

// electron/browser/playwright.ts on a bare view.
const pw = {};

const pwApi = {
  async open() {
    const { a } = await ready;
    pw.win = new BrowserWindow({
      ...BOUNDS,
      show: true,
      title: 'playwright.ts',
    });
    pw.view = createView(pw.win);
    await pw.view.webContents.loadURL(`${a}/browser-smoke.html`);
    pw.entry = { view: pw.view, automation: null };
  },
  async reuse() {
    const { playwright } = await ready;
    const [a, b] = await Promise.all([
      playwright.pageFor(pw.entry),
      playwright.pageFor(pw.entry),
    ]);
    await a.locator('#counter').click({ timeout: 5000 });
    return {
      same: a === b,
      count: await a.locator('#count').textContent(),
      url: a.url(),
    };
  },
  // Hidden while connected, then dropped: Playwright keeps a tab awake, dropping it lets it sleep again.
  async hiddenConnectedThenDropped() {
    const { playwright } = await ready;
    const page = await playwright.pageFor(pw.entry);
    pw.win.hide();
    const connected = await page.evaluate(() => document.visibilityState);
    playwright.dropPage(pw.entry);
    const visibility = () =>
      pw.view.webContents.executeJavaScript('document.visibilityState');
    // The page learns of the change asynchronously.
    const deadline = Date.now() + 3000;
    let dropped = await visibility();
    while (dropped !== 'hidden' && Date.now() < deadline)
      dropped = await visibility();
    pw.win.show();
    return { connected, dropped, automation: pw.entry.automation };
  },
  async reconnect() {
    const { playwright } = await ready;
    const page = await playwright.pageFor(pw.entry);
    await page.locator('#counter').click({ timeout: 5000 });
    return page.locator('#count').textContent();
  },
  async close() {
    const { playwright } = await ready;
    playwright.dropPage(pw.entry);
    pw.win.destroy();
  },
};

// electron/browser/views.ts as the IPC handlers call it. Each opened view keeps the events it sent its owner.
const V = new Map();
const tab = (key) => {
  const entry = V.get(key);
  if (!entry) throw new Error(`no harness view ${key}`);
  return entry;
};
const lastOf = (key, type) =>
  tab(key)
    .events.filter((e) => e.type === type)
    .at(-1);

const viewsApi = {
  async open([key, bounds]) {
    const { a, views } = await ready;
    const win = new BrowserWindow({ ...BOUNDS, show: true, title: key });
    const owner = win.webContents;
    await owner.loadURL('about:blank');
    const events = [];
    owner.send = (_channel, event) => events.push(event);
    const { id } = views.createView(owner, `${a}/browser-smoke.html`, key);
    views.setViewBounds(owner, id, { ...BOUNDS, radius: 0, ...bounds });
    const partition = session.fromPartition(`persist:space-${key}`);
    const wc = webContents
      .getAllWebContents()
      .find((c) => c.session === partition);
    const entry = { win, owner, id, events, wc, partition, sheets: 0 };
    win.on('sheet-begin', () => entry.sheets++);
    win.on('sheet-end', () => entry.sheets--);
    V.set(key, entry);
    return id;
  },
  isLoaded: ([key]) => {
    const state = lastOf(key, 'state');
    return (
      !!state &&
      !state.isLoading &&
      tab(key).wc.getURL().endsWith('browser-smoke.html')
    );
  },
  lastState: ([key]) => lastOf(key, 'state') ?? null,
  lastDialog: ([key]) => lastOf(key, 'dialog') ?? null,
  events: ([key, type]) => tab(key).events.filter((e) => e.type === type),
  allEvents: ([key]) => tab(key).events,
  sheets: ([key]) => tab(key).sheets,
  async snapshot([key, viewId]) {
    const { views } = await ready;
    const t = tab(key);
    return views.snapshotView(t.owner, viewId ?? t.id);
  },
  async act([key, action, viewId]) {
    const { views } = await ready;
    const t = tab(key);
    return views.actOnView(t.owner, viewId ?? t.id, action);
  },
  async dom([key, expression, viewId]) {
    const { views } = await ready;
    const t = tab(key);
    return JSON.parse(
      (await views.evalInView(t.owner, viewId ?? t.id, expression)).value,
    );
  },
  async run([key, command]) {
    const { views } = await ready;
    views.runCommand(tab(key).owner, tab(key).id, command);
  },
  async waitFor([key, options]) {
    const { views } = await ready;
    return views.waitForView(tab(key).owner, tab(key).id, options);
  },
  async answer([key, accept]) {
    const { views } = await ready;
    return views.answerDialogInView(tab(key).owner, tab(key).id, accept);
  },
  async setBounds([key, viewId]) {
    const { views } = await ready;
    views.setViewBounds(tab(key).owner, viewId, { ...BOUNDS, radius: 0 });
  },
  async destroyView([key, viewId]) {
    const { views } = await ready;
    views.destroyView(tab(key).owner, viewId);
  },
  async close([key]) {
    const { views } = await ready;
    const t = tab(key);
    views.destroyView(t.owner, t.id);
    t.win.destroy();
    V.delete(key);
  },
  // The user clicking in the page, not an agent action.
  userClicks: ([key, selector]) =>
    void tab(key)
      .wc.executeJavaScript(`document.querySelector('${selector}').click()`)
      .catch(() => {}),
  crash: ([key]) => tab(key).wc.forcefullyCrashRenderer(),
  setHidden: ([key, hidden]) =>
    hidden ? tab(key).win.hide() : tab(key).win.show(),
  isVisible: ([key]) => tab(key).win.isVisible(),
  webContentsCount: () => webContents.getAllWebContents().length,
  popupHardening() {
    const wc = webContents
      .getAllWebContents()
      .find((c) => c.getURL().endsWith('/popup.html'));
    if (!wc) return null;
    const prefs = wc.getLastWebPreferences();
    return {
      sameSession: [...V.values()].some((t) => t.partition === wc.session),
      sandbox: prefs.sandbox,
      contextIsolation: prefs.contextIsolation,
      nodeIntegration: prefs.nodeIntegration,
    };
  },
  hasPopupWebContents: () =>
    webContents
      .getAllWebContents()
      .some((c) => c.getURL().endsWith('/popup.html')),
};

const groups = {
  main: mainApi,
  dialogs: dialogsApi,
  pw: pwApi,
  views: viewsApi,
};

globalThis.smoke = {
  origins: async () => {
    const { a, b, downloads } = await ready;
    return { a, b, downloads };
  },
  // Resolves to { value } or { error } so the spec can assert on thrown messages.
  async call(method, args) {
    await ready;
    const [group, name] = method.split('.');
    try {
      const value = await groups[group][name](args);
      return { value: value ?? null };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  },
};
