import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, onTestFinished, test, vi } from 'vite-plus/test';
import { restoreScrollScript } from './reload.ts';

afterEach(() => vi.useRealTimers());

// One fake window, page and renderer; the stubbed `electron` hands them to views.ts.
class FakeDebugger extends EventEmitter {
  calls: string[] = [];
  scroll = { x: 0, y: 1500 };
  frame = 'A';
  isAttached = () => true;
  attach() {}
  async sendCommand(method: string) {
    this.calls.push(method);
    if (method === 'Runtime.evaluate') return { result: { value: this.scroll } };
    if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 800, clientHeight: 600 } };
    if (method === 'Page.captureScreenshot') return { data: this.frame };
    return {};
  }
}

class FakePage extends EventEmitter {
  debugger = new FakeDebugger();
  restored: string[] = [];
  isDestroyed = () => false;
  getURL = () => 'http://localhost:5173/';
  loadURL = async () => {};
  setWindowOpenHandler() {}
  close() {}
  async executeJavaScriptInIsolatedWorld(_world: number, [{ code }]: { code: string }[]) {
    this.restored.push(code);
  }
}

const fake = (() => {
  const win = Object.assign(new EventEmitter(), {
    isShown: true,
    isVisible: () => win.isShown,
    isMinimized: () => false,
    isDestroyed: () => false,
    getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    contentView: { addChildView() {}, removeChildView() {} },
  });
  const owner = { id: 1, frames: 0, isDestroyed: () => false, getZoomFactor: () => 1, send: () => owner.frames++ };
  return { win, owner, page: null as FakePage | null };
})();

async function openView() {
  vi.doMock('electron', () => ({
    app: { getPath: () => '/tmp' },
    BrowserWindow: { fromWebContents: () => fake.win },
    screen: { getDisplayMatching: () => ({ scaleFactor: 1 }) },
    session: { fromPartition: () => ({ on() {}, setPermissionRequestHandler() {}, setPermissionCheckHandler() {} }) },
    WebContentsView: class {
      webContents = fake.page;
      setVisible() {}
      setBounds() {}
      setBorderRadius() {}
    },
  }));
  onTestFinished(() => vi.doUnmock('electron'));
  const views = await import('./views.ts');
  const page = (fake.page = new FakePage());
  const { id } = views.createView(fake.owner as never, 'http://localhost:5173/', 'space');
  onTestFinished(() => views.destroyView(fake.owner as never, id));
  return { views, id, page };
}

// Lets the awaits in a capture or a CDP read run.
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('auto-reload reads the outgoing page as a navigation starts and restores it on load', async () => {
  const { views, id, page } = await openView();
  views.setAutoReload(fake.owner as never, id, mkdtempSync(join(tmpdir(), 'views-')));
  page.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
  page.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
  await settle();
  assert.equal(page.debugger.calls.filter((m) => m === 'Runtime.evaluate').length, 0, 'same-document and subframe navigations read nothing');

  page.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  await settle();
  page.emit('did-finish-load');
  assert.deepEqual(page.restored, [restoreScrollScript({ x: 0, y: 1500 })]);

  views.setAutoReload(fake.owner as never, id, null);
  page.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  await settle();
  assert.equal(page.debugger.calls.filter((m) => m === 'Runtime.evaluate').length, 1, 'stopped auto-reload reads nothing');
});

test('the mirror backs off while frames repeat, sends only changes, and stops while the window is hidden', async () => {
  const { views, id, page } = await openView();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const captures = () => page.debugger.calls.filter((m) => m === 'Page.captureScreenshot').length;
  const tick = async (ms: number) => {
    vi.advanceTimersByTime(ms);
    await settle();
  };
  await views.setViewMirror(fake.owner as never, id, { width: 800, height: 600 });
  await settle();
  assert.equal(fake.owner.frames, 1);

  for (const ms of [100, 200, 400, 800, 800]) await tick(ms);
  assert.equal(captures(), 6, 'unchanged captures back off 100 → 800 ms');
  assert.equal(fake.owner.frames, 1, 'an unchanged frame is not sent again');

  page.debugger.frame = 'B';
  await tick(800);
  await tick(100);
  assert.equal(fake.owner.frames, 2);
  assert.equal(captures(), 8, 'a change brings the rate back to 100 ms');

  fake.win.isShown = false;
  await tick(200);
  const paused = captures();
  await tick(10_000);
  assert.equal(captures(), paused, 'a hidden window gets no captures');

  fake.win.isShown = true;
  fake.win.emit('show');
  await settle();
  assert.equal(captures(), paused + 1, "the window's show resumes it at once");
  await views.setViewMirror(fake.owner as never, id, null);
});
