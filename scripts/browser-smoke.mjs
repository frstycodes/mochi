// Run: pnpm exec electron scripts/browser-smoke.mjs
// Drives a WebContentsView with playwright-core through electron/browser/relay.ts and prints
// PASS/FAIL per check (counted in the exit code) and INFO lines (recorded behaviour, not asserted).
import {
  app,
  BrowserWindow,
  session,
  WebContentsView,
  webContents,
} from 'electron';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const PARTITION = 'persist:smoke';
const WEB_PREFERENCES = {
  partition: PARTITION,
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  webSecurity: true,
};
const BOUNDS = { x: 0, y: 0, width: 900, height: 700 };
const WATCHDOG_MS = 180_000;
// Set to a directory to save full-screen captures while dialogs are open (macOS screencapture).
const SCREENSHOT_DIR = process.env.SMOKE_SCREENSHOT_DIR;

let failures = 0;

const log = (status, name, detail = '') =>
  console.log(`${status} ${name}${detail ? ` ${detail}` : ''}`);
const info = (name, detail) => log('INFO', name, detail);

async function check(name, fn) {
  try {
    log('PASS', name, (await fn()) ?? '');
  } catch (error) {
    failures++;
    log(
      'FAIL',
      name,
      error instanceof Error ? error.message.split('\n')[0] : String(error),
    );
  }
}

async function probe(name, fn) {
  try {
    info(name, (await fn()) ?? 'ok');
  } catch (error) {
    info(
      name,
      `threw: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
    );
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = (promise, ms, label = 'timeout') =>
  Promise.race([promise, sleep(ms).then(() => label)]);

function screenshot(name) {
  if (!SCREENSHOT_DIR) return Promise.resolve();
  return new Promise((resolve) =>
    execFile('screencapture', ['-x', join(SCREENSHOT_DIR, `${name}.png`)], () =>
      resolve(),
    ),
  );
}

function waitFor(emitter, event, ms) {
  return withTimeout(
    once(emitter, event).then((args) => args),
    ms,
    null,
  );
}

main().catch((error) => {
  console.error('FATAL', error);
  app.exit(2);
});

async function main() {
  setTimeout(() => {
    console.error(`FATAL watchdog: smoke did not finish in ${WATCHDOG_MS}ms`);
    app.exit(2);
  }, WATCHDOG_MS).unref();

  await app.whenReady();
  const relayModule = await loadRelay();
  const origins = await startServers();
  const downloads = await mkdtemp(join(tmpdir(), 'mochi-smoke-'));

  const win = new BrowserWindow({
    ...BOUNDS,
    show: true,
    title: 'browser-smoke',
  });
  const view = createView(win);
  const wc = view.webContents;
  await wc.loadURL(`${origins.a}/browser-smoke.html`);
  wc.debugger.attach('1.3');

  await probeDialogWithoutPlaywright(origins);
  await checkDownload(wc, downloads);
  await probeHiddenBeforeConnect(win, wc);
  await setMobileMetrics(wc);

  let session_ = await connect(relayModule, wc);
  const { page } = session_;

  await checkSinglePage(session_, wc);
  await checkMetricsSurvive(page, wc);
  await checkTargetId(wc);
  await checkActions(page, downloads);
  await checkDialogs(page);
  await checkDownload(wc, downloads, 'i2.download-with-playwright-connected');
  await checkCrossOrigin(page, wc, origins);
  await probeHiddenWindow(page, win);
  await checkPopup(page, wc, win);
  session_ = await checkCrash(relayModule, session_, wc);

  await session_.close();
  await checkPlaywrightModule(origins);
  await checkViewsModule(origins, downloads);
  await checkViewsDialogs(origins);
  await checkViewsPopup(origins);
  origins.close();
  console.log(
    failures ? `DONE ${failures} failing check(s)` : 'DONE all checks passed',
  );
  app.exit(failures ? 1 : 0);
}

// g. Electron's Node strips TS types natively (Node 24 in Electron 44), so the relay imports as-is.
async function loadRelay() {
  let relay;
  await check('g.relay-ts-import', async () => {
    relay = await import('../electron/browser/relay.ts');
    assert(typeof relay.serveRelay === 'function', 'serveRelay missing');
    return `node=${process.versions.node} typescript=${process.features.typescript}`;
  });
  if (!relay)
    throw new Error('relay could not be loaded; remaining checks need it');
  return relay;
}

function createView(win, bounds = BOUNDS) {
  const view = new WebContentsView({ webPreferences: WEB_PREFERENCES });
  win.contentView.addChildView(view);
  view.setBounds(bounds);
  return view;
}

async function startServers() {
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
    return { server, url: `http://${host}:${server.address().port}` };
  };
  // Different hosts make a different site, which is what forces a renderer swap.
  const a = await serve('127.0.0.1');
  const b = await serve('localhost');
  return {
    a: a.url,
    b: b.url,
    close: () => (a.server.close(), b.server.close()),
  };
}

async function connect(relayModule, wc) {
  const target = {
    send: (method, params, sessionId) =>
      wc.debugger.sendCommand(method, params, sessionId),
    targetId: () =>
      wc.debugger
        .sendCommand('Target.getTargetInfo')
        .then((r) => r.targetInfo.targetId),
    url: () => wc.getURL(),
    title: () => wc.getTitle(),
    userAgent: () => wc.getUserAgent(),
  };
  const relay = await relayModule.serveRelay(target);
  const onMessage = (_event, method, params, sessionId) =>
    relay.event(method, params, sessionId);
  wc.debugger.on('message', onMessage);
  const browser = await chromium.connectOverCDP(relay.endpoint, {
    timeout: 10_000,
  });
  const page = browser.contexts()[0]?.pages()[0];
  return {
    browser,
    page,
    close: async () => {
      wc.debugger.off('message', onMessage);
      await withTimeout(
        browser.close().catch(() => {}),
        3000,
      );
      relay.close();
    },
  };
}

// e1. JS dialogs with no Playwright connected. Each runs in its own window, destroyed afterwards,
// because Electron's native dialog box outlives the dialog being answered over CDP.
async function probeDialogWithoutPlaywright(origins) {
  const dialogWindow = async (webPreferences = WEB_PREFERENCES) => {
    const win = new BrowserWindow({
      x: 950,
      y: 0,
      width: 420,
      height: 300,
      show: true,
      title: 'dialog',
    });
    const view = new WebContentsView({ webPreferences });
    win.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 420, height: 300 });
    await view.webContents.loadURL(`${origins.a}/browser-smoke.html`);
    return { win, wc: view.webContents };
  };

  const raw = await dialogWindow();
  const started = Date.now();
  const pending = raw.wc.executeJavaScript("alert('x'); 'returned'");
  await sleep(1000);
  await screenshot('e1a-alert-no-debugger');
  info(
    'e1a.alert-no-debugger',
    `executeJavaScript -> ${JSON.stringify(await withTimeout(pending, 2000))} after ${Date.now() - started}ms`,
  );
  raw.win.destroy();

  const hooked = await dialogWindow();
  hooked.wc.debugger.attach('1.3');
  await hooked.wc.debugger.sendCommand('Page.enable');
  const opening = waitFor(hooked.wc.debugger, 'message', 3000);
  const evaluation = hooked.wc.executeJavaScript("confirm('y')");
  const message = await opening;
  info(
    'e1b.own-debugger-event',
    message
      ? `${message[1]} ${JSON.stringify(message[2])}`
      : 'no debugger message in 3s',
  );
  await sleep(500);
  await screenshot('e1b-confirm-open');
  await probe('e1b.own-debugger-handle', async () => {
    await hooked.wc.debugger.sendCommand('Page.handleJavaScriptDialog', {
      accept: true,
    });
    return `confirm() -> ${JSON.stringify(await withTimeout(evaluation, 3000))}`;
  });
  await sleep(500);
  await screenshot('e1b-confirm-after-handle');
  hooked.win.destroy();

  const silenced = await dialogWindow({
    ...WEB_PREFERENCES,
    disableDialogs: true,
  });
  silenced.wc.debugger.attach('1.3');
  await silenced.wc.debugger.sendCommand('Page.enable');
  const silencedOpening = waitFor(silenced.wc.debugger, 'message', 2000);
  const silencedResult = withTimeout(
    silenced.wc.executeJavaScript("confirm('z')"),
    2000,
  );
  const silencedMessage = await silencedOpening;
  info(
    'e1c.disableDialogs-own-debugger',
    `event=${silencedMessage ? silencedMessage[1] : 'none'} confirm() -> ${JSON.stringify(await silencedResult)}`,
  );
  silenced.win.destroy();
}

// i. Download handled by Electron's session alone, before Playwright is involved.
async function checkDownload(wc, downloads, name = 'i.download-will-download') {
  await check(name, async () => {
    const savePath = join(downloads, `${name}.txt`);
    const done = new Promise((resolve) => {
      session.fromPartition(PARTITION).once('will-download', (_event, item) => {
        item.setSavePath(savePath);
        item.once('done', (_e, state) => resolve(state));
      });
    });
    await wc.executeJavaScript("document.getElementById('download').click()");
    const state = await withTimeout(done, 5000);
    assert(state === 'completed', `download state ${state}`);
    const text = await readFile(savePath, 'utf8');
    assert(
      text === 'smoke download\n',
      `unexpected contents ${JSON.stringify(text)}`,
    );
    return savePath;
  });
}

// c0. Visibility of a hidden window with only our own debugger attached, for comparison with c1.
async function probeHiddenBeforeConnect(win, wc) {
  win.hide();
  await sleep(500);
  const state = await withTimeout(
    wc.executeJavaScript(
      "new Promise((r) => { const v = document.visibilityState; requestAnimationFrame(() => r(v + ' raf fired')); setTimeout(() => r(v + ' raf did not fire in 1s'), 1000); })",
    ),
    3000,
  );
  info(
    'c0.hidden-before-playwright',
    `win.isVisible=${win.isVisible()} visibilityState=${state}`,
  );
  win.show();
  await sleep(300);
}

// d. Set before Playwright connects, as views.ts does for device emulation.
async function setMobileMetrics(wc) {
  info(
    'd.innerWidth-before-override',
    String(await wc.executeJavaScript('window.innerWidth')),
  );
  await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
  });
}

// a.
async function checkSinglePage({ browser, page }, wc) {
  await check('a.single-page', async () => {
    const pages = browser.contexts().flatMap((context) => context.pages());
    assert(
      browser.contexts().length === 1,
      `contexts=${browser.contexts().length}`,
    );
    assert(pages.length === 1, `pages=${pages.length}`);
    assert(
      page.url() === wc.getURL(),
      `page.url()=${page.url()} wc=${wc.getURL()}`,
    );
    return page.url();
  });
}

// d.
async function checkMetricsSurvive(page, wc) {
  await check('d.metrics-survive-connect', async () => {
    info(
      'd.innerWidth-after-connect',
      String(await page.evaluate(() => window.innerWidth)),
    );
    await page.locator('#counter').click({ timeout: 5000 });
    const width = await page.evaluate(() => window.innerWidth);
    assert(width === 390, `innerWidth=${width}`);
    return `innerWidth=${width}`;
  });
  await wc.debugger.sendCommand('Emulation.clearDeviceMetricsOverride');
}

async function checkTargetId(wc) {
  await probe('targetId.Target.getTargetInfo', async () => {
    const { targetInfo } = await wc.debugger.sendCommand(
      'Target.getTargetInfo',
    );
    return `targetId=${targetInfo.targetId} type=${targetInfo.type}`;
  });
}

// h. Every action through refs from page.ariaSnapshot({ mode: 'ai' }).
async function checkActions(page, downloads) {
  await page.reload();
  const snapshot = await page.ariaSnapshot({ mode: 'ai', timeout: 5000 });
  const refOf = (pattern) => {
    const match = snapshot
      .split('\n')
      .find((line) => pattern.test(line))
      ?.match(/\[ref=(e\d+)\]/);
    if (!match) throw new Error(`no ref for ${pattern} in snapshot`);
    return page.locator(`aria-ref=${match[1]}`);
  };
  const text = (selector) => page.locator(selector).textContent();

  const formLines = snapshot
    .split('\n')
    .filter((line) =>
      /textbox|combobox|button "(Sign in|Upload)"|text: (Name|Password|Upload)/.test(
        line,
      ),
    );
  info('h.snapshot-form', `\n${formLines.join('\n')}`);

  await check('h.click', async () => {
    await refOf(/button "Count"/).click({ timeout: 5000 });
    assert((await text('#count')) === '1', `count=${await text('#count')}`);
  });
  await check('h.hover', async () => {
    await refOf(/button "Count"/).hover({ timeout: 5000 });
    assert(
      (await text('#hovered')) === 'hovered',
      `hovered=${await text('#hovered')}`,
    );
  });
  await check('h.focus-insertText', async () => {
    await refOf(/textbox "Name"/).focus({ timeout: 5000 });
    await page.keyboard.insertText('Ada');
    const value = await page.locator('#name').inputValue();
    assert(value === 'Ada', `value=${value}`);
  });
  await check('h.selectOption', async () => {
    await refOf(/combobox "Fruit"/).selectOption([{ label: 'Cherry' }], {
      timeout: 5000,
    });
    const value = await page.locator('#fruit').inputValue();
    assert(value === 'cherry', `value=${value}`);
  });
  await check('h.setInputFiles', async () => {
    const file = join(downloads, 'upload.txt');
    await writeFile(file, 'upload');
    await refOf(/button "Upload"/).setInputFiles(file, { timeout: 5000 });
    const name = await page
      .locator('#file')
      .evaluate((input) => input.files[0]?.name);
    assert(name === 'upload.txt', `file=${name}`);
  });
  await check('h.keyboard-press-Enter', async () => {
    await refOf(/textbox "Name"/).focus({ timeout: 5000 });
    await page.keyboard.press('Enter');
    const result = await text('#form-result');
    assert(
      result?.startsWith('submitted'),
      `form-result=${JSON.stringify(result)}`,
    );
    return result;
  });
  await check('h.dragTo', async () => {
    await refOf(/Drag me/).dragTo(refOf(/Drop here/), { timeout: 5000 });
    assert(
      (await text('#drop-result')) === 'dropped',
      `drop-result=${await text('#drop-result')}`,
    );
  });
  await check('h.mouse-wheel', async () => {
    await page.mouse.move(200, 200);
    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 800);
    await page.waitForFunction((y) => window.scrollY > y, before, {
      timeout: 3000,
    });
    return `scrollY ${before} -> ${await page.evaluate(() => window.scrollY)}`;
  });
  await check('h.getByText-waitFor', async () => {
    await page.reload();
    const started = Date.now();
    await page.getByText('Late arrival').first().waitFor({ timeout: 5000 });
    return `appeared after ${Date.now() - started}ms`;
  });
  await check('h.snapshot-submit-vs-password', async () => {
    const fresh = await page.ariaSnapshot({ mode: 'ai', timeout: 5000 });
    const submit = fresh
      .split('\n')
      .find((line) => line.includes('button "Sign in"'));
    const password = fresh
      .split('\n')
      .find((line) => line.includes('textbox "Password"'));
    assert(
      submit && password,
      'missing submit button or password textbox line',
    );
    return `submit=${submit.trim()} | password=${password.trim()} (YAML alone carries no type=submit / type=password)`;
  });
}

// e2.
async function checkDialogs(page) {
  const seen = [];
  const answer = { confirm: false, prompt: 'typed' };
  const onDialog = (dialog) => {
    seen.push(`${dialog.type()}:${dialog.message()}`);
    if (dialog.type() === 'prompt') return dialog.accept(answer.prompt);
    if (dialog.type() === 'confirm')
      return answer.confirm ? dialog.accept() : dialog.dismiss();
    return dialog.accept();
  };
  page.on('dialog', onDialog);
  const run = async (name, id, expected) =>
    check(name, async () => {
      seen.length = 0;
      await page.locator(id).click({ timeout: 5000 });
      const result = await page.locator('#dialog-result').textContent();
      assert(
        result === expected,
        `dialog-result=${JSON.stringify(result)} events=${seen.join(',')}`,
      );
      return seen.join(',');
    });
  await run('e2.alert', '#alert', 'alert done');
  answer.confirm = true;
  await run('e2.confirm-accept', '#confirm', 'confirm=true');
  answer.confirm = false;
  await run('e2.confirm-dismiss', '#confirm', 'confirm=false');
  await probe('e2.prompt', async () => {
    seen.length = 0;
    const thrown = await page.evaluate(() => {
      try {
        return `returned ${JSON.stringify(prompt('prompt message', 'default'))}`;
      } catch (error) {
        return `threw ${error.message}`;
      }
    });
    return `${thrown}; dialog events=${seen.join(',') || 'none'}`;
  });
  await probe('e2.native-box-while-playwright-listens', async () => {
    page.off('dialog', onDialog);
    const held = new Promise((resolve) =>
      page.once('dialog', (dialog) => resolve(dialog)),
    );
    const click = page.locator('#alert').click({ timeout: 5000 });
    const dialog = await withTimeout(held, 3000, null);
    if (!dialog) return 'no dialog event';
    await sleep(500);
    await screenshot('e2-alert-playwright-held');
    await dialog.accept();
    await click;
    await sleep(500);
    await screenshot('e2-alert-after-accept');
    page.on('dialog', onDialog);
    return SCREENSHOT_DIR
      ? `held 500ms, screenshot in ${SCREENSHOT_DIR}`
      : 'held 500ms (set SMOKE_SCREENSHOT_DIR to capture)';
  });
  page.off('dialog', onDialog);
}

// b.
async function checkCrossOrigin(page, wc, origins) {
  await check('b.cross-origin-same-page', async () => {
    const pidBefore = wc.getOSProcessId();
    const targetBefore = (await wc.debugger.sendCommand('Target.getTargetInfo'))
      .targetInfo.targetId;
    await page.goto(`${origins.b}/browser-smoke.html`, { timeout: 10_000 });
    const pidAfter = wc.getOSProcessId();
    const targetAfter = (await wc.debugger.sendCommand('Target.getTargetInfo'))
      .targetInfo.targetId;
    const snapshot = await page.ariaSnapshot({ mode: 'ai', timeout: 5000 });
    assert(
      snapshot.includes('button "Count"'),
      'snapshot missing Count button',
    );
    await page.locator('#counter').click({ timeout: 5000 });
    assert(
      (await page.locator('#count').textContent()) === '1',
      'counter did not increment',
    );
    return `pid ${pidBefore} -> ${pidAfter} (swapped=${pidBefore !== pidAfter}) targetId stable=${targetBefore === targetAfter} url=${page.url()}`;
  });
}

// c. Exploratory: records whether Playwright's actionability checks pass with the page not visible.
async function probeHiddenWindow(page, win) {
  const tryClick = async (name, action) =>
    probe(name, async () => {
      const before = Number(await page.locator('#count').textContent());
      const started = Date.now();
      try {
        await action();
      } catch (error) {
        return `threw after ${Date.now() - started}ms: ${error.message.split('\n')[0]}`;
      }
      const after = Number(await page.locator('#count').textContent());
      return `ok in ${Date.now() - started}ms, count ${before} -> ${after}`;
    });
  const visibility = () => page.evaluate(() => document.visibilityState);

  const rafFires = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => resolve('raf fired'));
          setTimeout(() => resolve('raf did not fire in 1s'), 1000);
        }),
    );
  win.hide();
  await sleep(500);
  info(
    'c1.state',
    `win.isVisible=${win.isVisible()} visibilityState=${await withTimeout(visibility(), 3000)} ${await withTimeout(rafFires(), 3000)}`,
  );
  await tryClick('c1.hidden-click', () =>
    page.locator('#counter').click({ timeout: 5000 }),
  );
  await tryClick('c1.hidden-click-force', () =>
    page.locator('#counter').click({ timeout: 5000, force: true }),
  );
  await tryClick('c1.hidden-dispatchEvent', () =>
    page
      .locator('#counter')
      .dispatchEvent('click', undefined, { timeout: 5000 }),
  );
  await probe('c1.hidden-ariaSnapshot', async () => {
    const snapshot = await page.ariaSnapshot({ mode: 'ai', timeout: 5000 });
    return `${snapshot.split('\n').length} lines`;
  });

  win.show();
  const cover = new BrowserWindow({ ...BOUNDS, show: true, title: 'cover' });
  cover.focus();
  win.showInactive();
  cover.moveTop();
  await sleep(800);
  info(
    'c2.state',
    `visibilityState=${await withTimeout(visibility(), 3000)} ${await withTimeout(rafFires(), 3000)}`,
  );
  info('c2.focused', `win=${win.isFocused()} cover=${cover.isFocused()}`);
  await tryClick('c2.behind-click', () =>
    page.locator('#counter').click({ timeout: 5000 }),
  );
  cover.destroy();
  win.show();
  win.focus();
  await sleep(300);
}

// f. Popups as WebContentsViews keep window.opener.
async function checkPopup(page, wc, win) {
  const attempts = [];
  wc.setWindowOpenHandler(() => ({
    action: 'allow',
    outlivesOpener: true,
    createWindow: (options) => {
      attempts.push(
        `options.webContents=${options.webContents ? 'present' : 'absent'}`,
      );
      let popup;
      try {
        popup = new WebContentsView(options);
        attempts.push('new WebContentsView(options) ok');
      } catch (error) {
        attempts.push(`new WebContentsView(options) threw: ${error.message}`);
        popup = new WebContentsView({ webContents: options.webContents });
        attempts.push('new WebContentsView({ webContents }) ok');
      }
      win.contentView.addChildView(popup);
      popup.setBounds({ x: 500, y: 400, width: 380, height: 280 });
      return popup.webContents;
    },
  }));
  await check('f.popup-opener-postMessage', async () => {
    await page.locator('#open-popup').click({ timeout: 5000 });
    try {
      await page
        .locator('#popup-result')
        .getByText('opener got hi')
        .waitFor({ timeout: 5000 });
    } finally {
      info('f.createWindow', attempts.join('; ') || 'createWindow not called');
    }
    return 'opener received postMessage';
  });
  const popupWc = webContents
    .getAllWebContents()
    .find((c) => c.getURL().endsWith('/popup.html'));
  info(
    'f.popup-webContents',
    popupWc
      ? `url=${popupWc.getURL()} status=${await popupWc.executeJavaScript("document.getElementById('status').textContent")}`
      : 'not found',
  );
  info('f.playwright-pages-after-popup', String(page.context().pages().length));
  popupWc?.close();
}

// j.
async function checkCrash(relayModule, session_, wc) {
  const { page } = session_;
  const pageEvents = [];
  page.on('crash', () => pageEvents.push('crash'));
  page.on('close', () => pageEvents.push('close'));
  const detached = [];
  wc.debugger.on('detach', (_e, reason) => detached.push(reason));

  const targetBefore = (await wc.debugger.sendCommand('Target.getTargetInfo'))
    .targetInfo.targetId;
  await check('j.render-process-gone', async () => {
    const gone = waitFor(wc, 'render-process-gone', 5000);
    wc.forcefullyCrashRenderer();
    const args = await gone;
    assert(args, 'render-process-gone did not fire in 5s');
    return `reason=${args[1].reason}`;
  });
  await sleep(1000);
  info('j.playwright-page-events', pageEvents.join(',') || 'none');
  info(
    'j.debugger-after-crash',
    `attached=${wc.debugger.isAttached()} detach=${detached.join(',') || 'none'}`,
  );
  await session_.close();

  const loaded = waitFor(wc, 'did-finish-load', 10_000);
  wc.reload();
  await loaded;
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
  const targetAfter = (await wc.debugger.sendCommand('Target.getTargetInfo'))
    .targetInfo.targetId;
  info('j.targetId-after-reload', `stable=${targetBefore === targetAfter}`);

  let fresh = session_;
  await check('j.reconnect-after-reload', async () => {
    fresh = await connect(relayModule, wc);
    await fresh.page.locator('#counter').click({ timeout: 5000 });
    const count = await fresh.page.locator('#count').textContent();
    assert(count === '1', `count=${count}`);
    return `pages=${fresh.browser.contexts()[0].pages().length}`;
  });
  return fresh;
}

async function until(condition, ms, label) {
  const deadline = Date.now() + ms;
  while (!(await condition())) {
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${label}`);
    await sleep(100);
  }
}

// l. electron/browser/playwright.ts on a bare view: a connected hidden tab stays visible, a dropped one goes hidden again.
async function checkPlaywrightModule(origins) {
  const { pageFor, dropPage } =
    await import('../electron/browser/playwright.ts');
  const win = new BrowserWindow({
    ...BOUNDS,
    show: true,
    title: 'playwright.ts',
  });
  const view = createView(win);
  await view.webContents.loadURL(`${origins.a}/browser-smoke.html`);
  const entry = { view, automation: null };
  await check('l.pageFor-reuses-one-connection', async () => {
    const [a, b] = await Promise.all([pageFor(entry), pageFor(entry)]);
    assert(a === b, 'two pages for one view');
    await a.locator('#counter').click({ timeout: 5000 });
    assert(
      (await a.locator('#count').textContent()) === '1',
      'click did not land',
    );
    return a.url();
  });
  await check('l.dropPage-lets-a-hidden-tab-sleep', async () => {
    const page = await pageFor(entry);
    win.hide();
    await sleep(500);
    const connected = await page.evaluate(() => document.visibilityState);
    dropPage(entry);
    await sleep(500);
    const dropped = await view.webContents.executeJavaScript(
      'document.visibilityState',
    );
    win.show();
    assert(connected === 'visible', `connected and hidden: ${connected}`);
    assert(dropped === 'hidden', `dropped and hidden: ${dropped}`);
    assert(entry.automation === null, 'automation not cleared');
    return `connected=${connected} dropped=${dropped}`;
  });
  await check('l.reconnects-after-drop', async () => {
    const page = await pageFor(entry);
    await page.locator('#counter').click({ timeout: 5000 });
    return `count=${await page.locator('#count').textContent()}`;
  });
  dropPage(entry);
  win.destroy();
}

// k. electron/browser/views.ts end to end, as the IPC handlers call it, with refs from snapshotView.
async function checkViewsModule(origins, downloads) {
  const views = await import('../electron/browser/views.ts');
  const win = new BrowserWindow({ ...BOUNDS, show: true, title: 'views.ts' });
  const owner = win.webContents;
  await owner.loadURL('about:blank');
  const events = [];
  owner.send = (_channel, event) => events.push(event);
  const { id } = views.createView(
    owner,
    `${origins.a}/browser-smoke.html`,
    'smoke',
  );
  views.setViewBounds(owner, id, { ...BOUNDS, radius: 0 });
  const wc = webContents
    .getAllWebContents()
    .find((c) => c.session === session.fromPartition('persist:space-smoke'));
  const lastState = () => events.filter((e) => e.type === 'state').at(-1);
  const loaded = () =>
    until(
      () =>
        lastState() &&
        !lastState().isLoading &&
        wc.getURL().endsWith('browser-smoke.html'),
      10_000,
      'page load',
    );
  const dom = async (expression) =>
    JSON.parse((await views.evalInView(owner, id, expression)).value);
  const act = (a) => views.actOnView(owner, id, a);
  const fails = async (promise, pattern) => {
    const error = await promise.then(
      () => null,
      (e) => e,
    );
    assert(error, 'did not throw');
    assert(pattern.test(error.message), `message: ${error.message}`);
    return error.message;
  };
  await loaded();

  let snap;
  const refOf = (role, name) => {
    const ref = Object.entries(snap.refs).find(
      ([, meta]) => meta.role === role && meta.name === name,
    )?.[0];
    if (!ref) throw new Error(`no ${role} "${name}" in snapshot`);
    return ref;
  };
  await check('k.snapshot-isSubmit-isPassword', async () => {
    const started = Date.now();
    snap = await views.snapshotView(owner, id);
    const ms = Date.now() - started;
    const flags = (role, name) => {
      const { isSubmit, isPassword } = snap.refs[refOf(role, name)];
      return `${isSubmit ? 'S' : '-'}${isPassword ? 'P' : '-'}`;
    };
    const want = {
      'button/Sign in': 'S-',
      'textbox/Password': '-P',
      'textbox/Name': '--',
      'button/Count': '--',
      'button/Upload': '--',
      'combobox/Fruit': '--',
      'link/Download file': '--',
    };
    const got = Object.fromEntries(
      Object.keys(want).map((key) => [key, flags(...key.split('/'))]),
    );
    assert(
      JSON.stringify(got) === JSON.stringify(want),
      `flags ${JSON.stringify(got)}`,
    );
    assert(
      snap.text.includes(`[ref=${refOf('button', 'Sign in')}]`),
      'ref missing from text',
    );
    return `${Object.keys(snap.refs).length} refs in ${ms}ms, e.g. ${refOf('button', 'Sign in')}`;
  });
  await check('k.click', async () => {
    await act({ kind: 'click', ref: refOf('button', 'Count') });
    assert(
      (await dom("document.getElementById('count').textContent")) === '1',
      'count not 1',
    );
  });
  await check('k.hover', async () => {
    await act({ kind: 'hover', ref: refOf('button', 'Count') });
    assert(
      (await dom("document.getElementById('hovered').textContent")) ===
        'hovered',
      'not hovered',
    );
  });
  await check('k.type-replaces', async () => {
    await act({ kind: 'type', ref: refOf('textbox', 'Name'), text: 'Ada' });
    await act({ kind: 'type', ref: refOf('textbox', 'Name'), text: 'Grace' });
    const value = await dom("document.getElementById('name').value");
    assert(value === 'Grace', `value=${value}`);
  });
  await check('k.type-into-select', async () => {
    await act({
      kind: 'type',
      ref: refOf('combobox', 'Fruit'),
      text: 'Banana',
    });
    assert(
      (await dom("document.getElementById('fruit').value")) === 'banana',
      'not banana',
    );
  });
  await check('k.select', async () => {
    await act({
      kind: 'select',
      ref: refOf('combobox', 'Fruit'),
      value: 'Cherry',
    });
    assert(
      (await dom("document.getElementById('fruit').value")) === 'cherry',
      'not cherry',
    );
  });
  await check('k.select-errors', async () => {
    const a = await fails(
      act({ kind: 'select', ref: refOf('textbox', 'Name'), value: 'x' }),
      /not a <select>/,
    );
    const b = await fails(
      act({ kind: 'select', ref: refOf('combobox', 'Fruit'), value: 'Durian' }),
      /^No option "Durian" in that list$/,
    );
    return `${a} | ${b}`;
  });
  await check('k.upload', async () => {
    const file = join(downloads, 'views-upload.txt');
    await writeFile(file, 'upload');
    await act({ kind: 'upload', ref: refOf('button', 'Upload'), path: file });
    assert(
      (await dom("document.getElementById('file').files[0]?.name")) ===
        'views-upload.txt',
      'file not set',
    );
  });
  await check('k.upload-errors', async () => {
    const a = await fails(
      act({
        kind: 'upload',
        ref: refOf('button', 'Upload'),
        path: join(downloads, 'missing.txt'),
      }),
      /^No file at /,
    );
    const b = await fails(
      act({
        kind: 'upload',
        ref: refOf('textbox', 'Name'),
        path: join(downloads, 'views-upload.txt'),
      }),
      /not a file input/,
    );
    return `${a} | ${b}`;
  });
  await check('k.press-Enter-submits', async () => {
    await act({ kind: 'click', ref: refOf('textbox', 'Name') });
    await act({ kind: 'press', key: 'Enter' });
    const result = await dom(
      "document.getElementById('form-result').textContent",
    );
    assert(
      result.startsWith(
        'submitted name=Grace fruit=cherry file=views-upload.txt',
      ),
      `form-result=${result}`,
    );
  });
  await check('k.press-unknown-key', () =>
    fails(
      act({ kind: 'press', key: 'Hyper' }),
      /^Unknown key "Hyper"; use a single character/,
    ),
  );
  await check('k.type-into-non-text', () =>
    fails(
      act({ kind: 'type', ref: refOf('button', 'Count'), text: 'x' }),
      /^That element takes no text$/,
    ),
  );
  await check('k.drag', async () => {
    const source = Object.entries(snap.refs).find(([ref]) =>
      snap.text.includes(`[ref=${ref}]: Drag me`),
    )?.[0];
    const target = Object.entries(snap.refs).find(([ref]) =>
      snap.text.includes(`[ref=${ref}]: Drop here`),
    )?.[0];
    assert(source && target, 'drag refs missing');
    await act({ kind: 'drag', from: source, to: target });
    assert(
      (await dom("document.getElementById('drop-result').textContent")) ===
        'dropped',
      'not dropped',
    );
  });
  await check('k.scroll', async () => {
    const { note } = await act({ kind: 'scroll', dx: 0, dy: 600 });
    assert(/^Scrolled to 0, [1-9]\d* of \d+$/.test(note), `note=${note}`);
    return note;
  });
  await check('k.stale-ref', async () => {
    const old = refOf('button', 'Count');
    snap = await views.snapshotView(owner, id);
    assert(refOf('button', 'Count') !== old, 'generation did not change');
    return fails(
      act({ kind: 'click', ref: old }),
      /^No element g\d+-e\d+ on the page now; take a new browser_snapshot$/,
    );
  });
  await check('k.hidden-window-click', async () => {
    win.hide();
    await sleep(300);
    await act({ kind: 'click', ref: refOf('button', 'Count') });
    const count = await dom("document.getElementById('count').textContent");
    win.show();
    assert(count === '2', `count=${count}`);
  });
  await check('k.waitFor', async () => {
    views.runCommand(owner, id, 'reload');
    await sleep(100);
    const met = await views.waitForView(owner, id, {
      text: 'Late arrival',
      timeoutMs: 5000,
    });
    const missed = await views.waitForView(owner, id, {
      text: 'Never shows up',
      selector: '#nope',
      timeoutMs: 800,
    });
    const url = await views.waitForView(owner, id, {
      url: 'browser-smoke',
      timeoutMs: 1000,
    });
    assert(
      met.isMet && !missed.isMet && url.isMet,
      `met=${JSON.stringify(met)} missed=${JSON.stringify(missed)} url=${JSON.stringify(url)}`,
    );
    return `text after ${met.waitedMs}ms, miss after ${missed.waitedMs}ms`;
  });
  await check('k.waitFor-bad-selector', () =>
    fails(
      views.waitForView(owner, id, { selector: '[[[', timeoutMs: 1000 }),
      /selector/i,
    ),
  );
  await check('k.crash-error-then-reload-clears', async () => {
    await loaded();
    wc.forcefullyCrashRenderer();
    await until(() => lastState()?.error, 5000, 'error state');
    const error = lastState().error;
    views.runCommand(owner, id, 'reload');
    await until(
      () => lastState() && lastState().error === null && !lastState().isLoading,
      10_000,
      'error cleared',
    );
    snap = await views.snapshotView(owner, id);
    await act({ kind: 'click', ref: refOf('button', 'Count') });
    const count = await dom("document.getElementById('count').textContent");
    assert(count === '1', `count after reconnect=${count}`);
    return `error=${JSON.stringify(error)}; cleared on reload; reconnected`;
  });
  views.destroyView(owner, id);
  win.destroy();
}

// m. Dialogs through views.ts: tracked with or without Playwright, never auto-dismissed, answered by answerDialogInView,
// and Electron's native sheet closes with the answer (sheet-begin / sheet-end are macOS only).
async function checkViewsDialogs(origins) {
  const views = await import('../electron/browser/views.ts');
  const win = new BrowserWindow({
    ...BOUNDS,
    show: true,
    title: 'views.ts dialogs',
  });
  const owner = win.webContents;
  await owner.loadURL('about:blank');
  const events = [];
  owner.send = (_channel, event) => events.push(event);
  let openSheets = 0;
  win.on('sheet-begin', () => openSheets++);
  win.on('sheet-end', () => openSheets--);
  const { id } = views.createView(
    owner,
    `${origins.a}/browser-smoke.html`,
    'smoke-dialogs',
  );
  views.setViewBounds(owner, id, { ...BOUNDS, radius: 0 });
  const wc = webContents
    .getAllWebContents()
    .find(
      (c) => c.session === session.fromPartition('persist:space-smoke-dialogs'),
    );
  const lastDialog = () => events.filter((e) => e.type === 'dialog').at(-1);
  const isOpen = (kind) => lastDialog()?.kind === kind;
  const isClosed = () => lastDialog()?.kind === null;
  const dom = async (expression) =>
    JSON.parse((await views.evalInView(owner, id, expression)).value);
  const act = (a) => views.actOnView(owner, id, a);
  const answer = (accept) => views.answerDialogInView(owner, id, accept);
  const userClicks = (selector) =>
    void wc
      .executeJavaScript(`document.querySelector('${selector}').click()`)
      .catch(() => {});
  const sheetsClosed = async () => {
    if (process.platform !== 'darwin') return 'sheet events are macOS only';
    await until(
      () => openSheets === 0,
      3000,
      `native sheet to close (open=${openSheets})`,
    );
    return 'native sheet closed';
  };
  const fails = async (promise, pattern) => {
    const error = await promise.then(
      () => null,
      (e) => e,
    );
    assert(error, 'did not throw');
    assert(pattern.test(error.message), `message: ${error.message}`);
    return error.message;
  };
  await until(
    () =>
      events.some(
        (e) =>
          e.type === 'state' &&
          !e.isLoading &&
          wc.getURL().endsWith('browser-smoke.html'),
      ),
    10_000,
    'page load',
  );

  await check('m.dialog-tracked-without-playwright', async () => {
    userClicks('#alert');
    await until(() => isOpen('alert'), 3000, 'dialog event');
    assert(
      lastDialog().message === 'alert message',
      `message=${lastDialog().message}`,
    );
    await answer(true);
    await until(isClosed, 3000, 'closed event');
    assert(
      (await dom("document.getElementById('dialog-result').textContent")) ===
        'alert done',
      'alert not resolved',
    );
    return await sheetsClosed();
  });

  let snap = await views.snapshotView(owner, id);
  const refOf = (name) =>
    Object.entries(snap.refs).find(
      ([, meta]) => meta.role === 'button' && meta.name === name,
    )?.[0];

  await check(
    'm.user-dialog-not-auto-dismissed-while-playwright-connected',
    async () => {
      userClicks('#confirm');
      await until(() => isOpen('confirm'), 3000, 'dialog event');
      await sleep(1500);
      assert(
        isOpen('confirm'),
        `dialog closed on its own: ${JSON.stringify(lastDialog())}`,
      );
      await answer(true);
      await until(isClosed, 3000, 'closed event');
      const result = await dom(
        "document.getElementById('dialog-result').textContent",
      );
      assert(result === 'confirm=true', `dialog-result=${result}`);
      return `${result}; ${await sheetsClosed()}`;
    },
  );

  await check('m.agent-click-opening-alert-returns-note', async () => {
    const started = Date.now();
    const { note } = await act({ kind: 'click', ref: refOf('Alert') });
    const ms = Date.now() - started;
    assert(
      note ===
        'An alert dialog is open: "alert message"; answer it with browser_dialog',
      `note=${note}`,
    );
    assert(ms < 2000, `took ${ms}ms`);
    return `${ms}ms: ${note}`;
  });

  await check('m.actions-fail-fast-while-open', async () => {
    const started = Date.now();
    const message = await fails(
      act({ kind: 'click', ref: refOf('Count') }),
      /^An alert dialog is open: "alert message"; answer it with browser_dialog$/,
    );
    assert(Date.now() - started < 500, `took ${Date.now() - started}ms`);
    return message;
  });

  await check('m.answer-alert', async () => {
    await answer(true);
    await until(isClosed, 3000, 'closed event');
    assert(
      (await dom("document.getElementById('dialog-result').textContent")) ===
        'alert done',
      'alert not resolved',
    );
    return await sheetsClosed();
  });

  for (const accept of [true, false])
    await check(`m.answer-confirm-${accept}`, async () => {
      const { note } = await act({ kind: 'click', ref: refOf('Confirm') });
      assert(
        note?.startsWith('A confirm dialog is open: "confirm message"'),
        `note=${note}`,
      );
      await answer(accept);
      await until(isClosed, 3000, 'closed event');
      const result = await dom(
        "document.getElementById('dialog-result').textContent",
      );
      assert(result === `confirm=${accept}`, `dialog-result=${result}`);
      return `${result}; ${await sheetsClosed()}`;
    });

  await check('m.answer-without-dialog', () =>
    fails(answer(true), /^No dialog is open in this tab$/),
  );

  await probe('m.reload-while-open', async () => {
    userClicks('#confirm');
    await until(() => isOpen('confirm'), 3000, 'dialog event');
    views.runCommand(owner, id, 'reload');
    await sleep(1500);
    return `after reload: dialog=${JSON.stringify(lastDialog())} openSheets=${openSheets}`;
  });

  views.destroyView(owner, id);
  win.destroy();
}

// n. Popups through views.ts: a tab of their own that keeps window.opener, driven like any view, closed by window.close().
async function checkViewsPopup(origins) {
  const views = await import('../electron/browser/views.ts');
  const win = new BrowserWindow({
    ...BOUNDS,
    show: true,
    title: 'views.ts popups',
  });
  const owner = win.webContents;
  await owner.loadURL('about:blank');
  const events = [];
  owner.send = (_channel, event) => events.push(event);
  const { id } = views.createView(
    owner,
    `${origins.a}/browser-smoke.html`,
    'smoke-popup',
  );
  views.setViewBounds(owner, id, { ...BOUNDS, radius: 0 });
  const ses = session.fromPartition('persist:space-smoke-popup');
  const openerWc = webContents
    .getAllWebContents()
    .find((c) => c.session === ses);
  const popups = () => events.filter((e) => e.type === 'popup');
  const dom = async (viewId, expression) =>
    JSON.parse((await views.evalInView(owner, viewId, expression)).value);
  const clickByName = async (viewId, name) => {
    const snap = await views.snapshotView(owner, viewId);
    const ref = Object.entries(snap.refs).find(
      ([, meta]) => meta.role === 'button' && meta.name === name,
    )?.[0];
    assert(ref, `no button "${name}" in snapshot of ${viewId}`);
    return views.actOnView(owner, viewId, { kind: 'click', ref });
  };
  const openerResult = () =>
    dom(id, "document.getElementById('popup-result').textContent");
  const openPopup = async () => {
    const before = popups().length;
    await clickByName(id, 'Open popup');
    await until(() => popups().length > before, 5000, 'popup event');
    // The renderer gives the popup's tab bounds; a view without them lays out at 0 × 0 and nothing in it is clickable.
    views.setViewBounds(owner, popups().at(-1).viewId, {
      ...BOUNDS,
      radius: 0,
    });
    return popups().at(-1);
  };
  await until(
    () =>
      events.some(
        (e) =>
          e.type === 'state' &&
          !e.isLoading &&
          openerWc.getURL().endsWith('browser-smoke.html'),
      ),
    10_000,
    'page load',
  );

  let popup;
  await check('n.popup-event-new-view', async () => {
    popup = await openPopup();
    assert(
      popup.id === id &&
        popup.viewId !== id &&
        popup.url === `${origins.a}/popup.html`,
      `event=${JSON.stringify(popup)}`,
    );
    return JSON.stringify(popup);
  });
  if (!popup) return win.destroy();
  const popupWc = () =>
    webContents
      .getAllWebContents()
      .find((c) => c.getURL().endsWith('/popup.html'));
  await check('n.opener-gets-postMessage', async () => {
    await until(
      async () => (await openerResult()) === 'opener got hi',
      5000,
      'opener got hi',
    );
    return `popup says ${JSON.stringify(await dom(popup.viewId, "document.getElementById('status').textContent"))}`;
  });
  await check('n.popup-hardened-same-session', async () => {
    const wc = popupWc();
    const prefs = wc.getLastWebPreferences();
    const got = {
      sameSession: wc.session === ses,
      sandbox: prefs.sandbox,
      contextIsolation: prefs.contextIsolation,
      nodeIntegration: prefs.nodeIntegration,
    };
    assert(
      got.sameSession &&
        got.sandbox === true &&
        got.contextIsolation === true &&
        got.nodeIntegration === false,
      JSON.stringify(got),
    );
    return JSON.stringify(got);
  });
  await check('n.popup-state-events', async () => {
    await until(
      () =>
        events.some(
          (e) =>
            e.id === popup.viewId &&
            e.type === 'state' &&
            e.url.endsWith('/popup.html'),
        ),
      5000,
      'popup state event',
    );
  });
  await check('n.snapshot-click-in-popup', async () => {
    await clickByName(popup.viewId, 'Ping opener');
    await until(
      async () => (await openerResult()) === 'opener got ping',
      5000,
      'opener got ping',
    );
  });
  await check('n.window-close-emits-closed', async () => {
    const { note } = await clickByName(popup.viewId, 'Close me').catch(
      (error) => ({ note: `act threw: ${error.message}` }),
    );
    await until(
      () => events.some((e) => e.id === popup.viewId && e.type === 'closed'),
      5000,
      'closed event',
    );
    const gone = await views.snapshotView(owner, popup.viewId).then(
      () => 'still registered',
      (error) => error.message,
    );
    assert(/unknown view/.test(gone), gone);
    assert(!popupWc(), 'popup webContents still alive');
    return note ? `act: ${note}` : 'act resolved';
  });
  await check('n.destroy-popup-keeps-opener', async () => {
    const second = await openPopup();
    views.destroyView(owner, second.viewId);
    await sleep(300);
    assert(
      !events.some((e) => e.id === second.viewId && e.type === 'closed'),
      'destroyView emitted closed',
    );
    const count = Number(
      (await dom(id, "document.getElementById('count').textContent")) || 0,
    );
    await clickByName(id, 'Count');
    const after = Number(
      await dom(id, "document.getElementById('count').textContent"),
    );
    assert(after === count + 1, `count ${count} -> ${after}`);
  });
  await check('n.file-open-denied', async () => {
    const before = popups().length;
    const all = webContents.getAllWebContents().length;
    await clickByName(id, 'Open file popup');
    await sleep(1000);
    assert(
      popups().length === before,
      `popup events: ${JSON.stringify(popups().slice(before))}`,
    );
    assert(
      webContents.getAllWebContents().length === all,
      'a webContents was created',
    );
  });
  // Chromium opens window.open('javascript:…') as about:blank and runs the script there, so the handler only sees about:blank.
  await probe('n.javascript-open', async () => {
    const before = popups().length;
    await clickByName(id, 'Open javascript popup');
    await sleep(1000);
    const made = popups().slice(before);
    made.forEach((p) => views.destroyView(owner, p.viewId));
    return `popup events: ${JSON.stringify(made)}`;
  });

  views.destroyView(owner, id);
  win.destroy();
}
