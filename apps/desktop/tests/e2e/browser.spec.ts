import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  _electron as electron,
  chromium,
  expect,
  test,
  type Browser,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

// Drives WebContentsViews hosted by browser.main.mjs through electron/browser/*: the CDP relay, playwright.ts and views.ts.
// Behaviour we only record (no assertion) goes into test annotations as `info`.
const ROOT = path.resolve(import.meta.dirname, '../..');

test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let origins: { a: string; b: string; downloads: string };
let userData: string;

test.beforeAll(async () => {
  userData = mkdtempSync(path.join(tmpdir(), 'mochi-browser-'));
  app = await electron.launch({
    cwd: ROOT,
    args: ['tests/e2e/browser.main.mjs'],
    env: { ...process.env, MOCHI_USER_DATA: userData },
  });
  // Playwright auto-dismisses a dialog nobody listens for, which would answer the ones these tests hold open.
  const holdDialogs = (page: Page) => page.on('dialog', () => {});
  app.context().on('page', holdDialogs);
  app.windows().forEach(holdDialogs);
  origins = await app.evaluate(() =>
    (globalThis as unknown as Harness).smoke.origins(),
  );
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userData, { recursive: true, force: true });
});

interface Harness {
  smoke: {
    origins: () => Promise<{ a: string; b: string; downloads: string }>;
    call: (method: string, args: unknown) => Promise<Reply<unknown>>;
  };
}

type Reply<T> = { value: T } | { error: string };

const raw = <T = unknown>(method: string, args?: unknown) =>
  app.evaluate(
    (_electron, [m, a]) => (globalThis as unknown as Harness).smoke.call(m, a),
    [method, args] as const,
  ) as Promise<Reply<T>>;

async function rpc<T = unknown>(method: string, args?: unknown): Promise<T> {
  const reply = await raw<T>(method, args);
  if ('error' in reply) throw new Error(reply.error);
  return reply.value;
}

async function rpcError(method: string, args?: unknown) {
  const reply = await raw(method, args);
  expect(reply, `${method} did not throw`).toHaveProperty('error');
  return (reply as { error: string }).error;
}

const note = (type: string, description: string) =>
  test.info().annotations.push({ type, description });

/** Absence checks (a dialog that must not close, an event that must not fire) have nothing to wait for. */
const settle = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

test.describe('electron without Playwright', () => {
  test.beforeAll(() => rpc('main.open'));

  test('e1. JS dialogs behave as recorded with no relay', async () => {
    note('e1a.alert-no-debugger', await rpc('dialogs.alertWithoutDebugger'));
    note(
      'e1b.own-debugger-handle',
      await rpc('dialogs.confirmWithOwnDebugger'),
    );
    note(
      'e1c.disableDialogs-own-debugger',
      await rpc('dialogs.confirmWithDialogsDisabled'),
    );
  });

  test('i. download is handled by the Electron session alone', async () => {
    const result = await rpc<{ state: string; text: string }>(
      'main.download',
      'i.download-will-download',
    );
    expect(result.state).toBe('completed');
    expect(result.text).toBe('smoke download\n');
  });

  test('c0. hidden window visibility before Playwright connects', async () => {
    await rpc('main.setHidden', true);
    await expect.poll(() => rpc('main.isVisible')).toBe(false);
    note(
      'c0.hidden-before-playwright',
      `visibilityState=${await rpc<string>('main.visibility')}`,
    );
    await rpc('main.setHidden', false);
    await expect.poll(() => rpc('main.isVisible')).toBe(true);
  });

  test('d. device metrics set before connect', async () => {
    note('d.innerWidth-before-override', String(await rpc('main.innerWidth')));
    await rpc('main.setMobileMetrics');
  });
});

test.describe('CDP relay on a bare view', () => {
  let browser: Browser;
  let page: Page;
  let snapshot: string;

  const connect = async () => {
    browser = await chromium.connectOverCDP(await rpc<string>('main.connect'), {
      timeout: 10_000,
    });
    page = browser.contexts()[0]!.pages()[0]!;
  };
  const disconnect = async () => {
    await Promise.race([browser.close().catch(() => {}), settle(3000)]);
    await rpc('main.disconnect');
  };
  const refOf = (pattern: RegExp) => {
    const match = snapshot
      .split('\n')
      .find((line) => pattern.test(line))
      ?.match(/\[ref=(e\d+)\]/);
    expect(match, `no ref for ${pattern} in snapshot`).toBeTruthy();
    return page.locator(`aria-ref=${match![1]}`);
  };

  test.beforeAll(connect);
  test.afterAll(async () => {
    await disconnect();
  });

  test('a. exactly one context and page, on the view', async () => {
    const pages = browser.contexts().flatMap((context) => context.pages());
    expect(browser.contexts()).toHaveLength(1);
    expect(pages).toHaveLength(1);
    expect(page.url()).toBe((await rpc<{ url: string }>('main.info')).url);
  });

  test('d. metrics survive connect', async () => {
    note(
      'd.innerWidth-after-connect',
      String(await page.evaluate(() => window.innerWidth)),
    );
    await page.locator('#counter').click({ timeout: 5000 });
    expect(await page.evaluate(() => window.innerWidth)).toBe(390);
    await rpc('main.clearMetrics');
  });

  test('targetId from Target.getTargetInfo', async () => {
    const info = await rpc<{ targetId: string; type: string }>('main.info');
    note('targetId.Target.getTargetInfo', `${info.targetId} ${info.type}`);
  });

  test.describe('h. actions through aria refs', () => {
    test.beforeAll(async () => {
      await page.reload();
      snapshot = await page.ariaSnapshot({ mode: 'ai', timeout: 5000 });
    });

    test('snapshot lists the form controls', () => {
      note(
        'h.snapshot-form',
        snapshot
          .split('\n')
          .filter((line) =>
            /textbox|combobox|button "(Sign in|Upload)"|text: (Name|Password|Upload)/.test(
              line,
            ),
          )
          .join('\n'),
      );
      expect(snapshot).toContain('button "Count"');
    });

    test('click', async () => {
      await refOf(/button "Count"/).click({ timeout: 5000 });
      await expect(page.locator('#count')).toHaveText('1');
    });

    test('hover', async () => {
      await refOf(/button "Count"/).hover({ timeout: 5000 });
      await expect(page.locator('#hovered')).toHaveText('hovered');
    });

    test('focus and insertText', async () => {
      await refOf(/textbox "Name"/).focus({ timeout: 5000 });
      await page.keyboard.insertText('Ada');
      await expect(page.locator('#name')).toHaveValue('Ada');
    });

    test('selectOption', async () => {
      await refOf(/combobox "Fruit"/).selectOption([{ label: 'Cherry' }], {
        timeout: 5000,
      });
      await expect(page.locator('#fruit')).toHaveValue('cherry');
    });

    test('setInputFiles', async () => {
      const file = path.join(origins.downloads, 'upload.txt');
      writeFileSync(file, 'upload');
      await refOf(/button "Upload"/).setInputFiles(file, { timeout: 5000 });
      expect(
        await page
          .locator('#file')
          .evaluate((input: HTMLInputElement) => input.files?.[0]?.name),
      ).toBe('upload.txt');
    });

    test('keyboard press Enter submits', async () => {
      await refOf(/textbox "Name"/).focus({ timeout: 5000 });
      await page.keyboard.press('Enter');
      await expect(page.locator('#form-result')).toHaveText(/^submitted/);
    });

    test('dragTo', async () => {
      await refOf(/Drag me/).dragTo(refOf(/Drop here/), { timeout: 5000 });
      await expect(page.locator('#drop-result')).toHaveText('dropped');
    });

    test('mouse wheel scrolls', async () => {
      await page.mouse.move(200, 200);
      await page.mouse.wheel(0, 800);
      await expect
        .poll(() => page.evaluate(() => window.scrollY), { timeout: 3000 })
        .toBeGreaterThan(0);
    });

    test('getByText waits for late content', async () => {
      await page.reload();
      await page.getByText('Late arrival').first().waitFor({ timeout: 5000 });
    });

    test('snapshot names the submit button and the password box', async () => {
      const fresh = await page.ariaSnapshot({ mode: 'ai', timeout: 5000 });
      expect(fresh).toContain('button "Sign in"');
      expect(fresh).toContain('textbox "Password"');
    });
  });

  test.describe('e2. dialogs', () => {
    const seen: string[] = [];
    const answer = { confirm: false, prompt: 'typed' };
    const onDialog = (dialog: import('@playwright/test').Dialog) => {
      seen.push(`${dialog.type()}:${dialog.message()}`);
      if (dialog.type() === 'prompt') return dialog.accept(answer.prompt);
      if (dialog.type() === 'confirm')
        return answer.confirm ? dialog.accept() : dialog.dismiss();
      return dialog.accept();
    };
    test.beforeAll(() => {
      page.on('dialog', onDialog);
    });
    test.afterAll(() => {
      page.off('dialog', onDialog);
    });
    test.beforeEach(() => {
      seen.length = 0;
    });

    test('alert', async () => {
      await page.locator('#alert').click({ timeout: 5000 });
      await expect(page.locator('#dialog-result')).toHaveText('alert done');
    });

    test('confirm accepted', async () => {
      answer.confirm = true;
      await page.locator('#confirm').click({ timeout: 5000 });
      await expect(page.locator('#dialog-result')).toHaveText('confirm=true');
    });

    test('confirm dismissed', async () => {
      answer.confirm = false;
      await page.locator('#confirm').click({ timeout: 5000 });
      await expect(page.locator('#dialog-result')).toHaveText('confirm=false');
    });

    test('prompt (recorded)', async () => {
      const thrown = await page.evaluate(() => {
        try {
          return `returned ${JSON.stringify(prompt('prompt message', 'default'))}`;
        } catch (error) {
          return `threw ${(error as Error).message}`;
        }
      });
      note('e2.prompt', `${thrown}; dialog events=${seen.join(',') || 'none'}`);
    });

    test('native box while Playwright holds the dialog (recorded)', async () => {
      page.off('dialog', onDialog);
      try {
        const held = page.waitForEvent('dialog', { timeout: 3000 });
        const click = page.locator('#alert').click({ timeout: 5000 });
        const dialog = await held.catch(() => null);
        note(
          'e2.native-box-while-playwright-listens',
          dialog ? 'dialog event held' : 'no dialog event',
        );
        await dialog?.accept();
        await click;
      } finally {
        page.on('dialog', onDialog);
      }
    });
  });

  test('b. cross-origin navigation keeps one page', async () => {
    const before = await rpc<{ pid: number; targetId: string }>('main.info');
    await page.goto(`${origins.b}/browser-smoke.html`, { timeout: 10_000 });
    const after = await rpc<{ pid: number; targetId: string }>('main.info');
    expect(await page.ariaSnapshot({ mode: 'ai', timeout: 5000 })).toContain(
      'button "Count"',
    );
    await page.locator('#counter').click({ timeout: 5000 });
    await expect(page.locator('#count')).toHaveText('1');
    note(
      'b.cross-origin-same-page',
      `pid ${before.pid} -> ${after.pid} (swapped=${before.pid !== after.pid}) targetId stable=${before.targetId === after.targetId} url=${page.url()}`,
    );
  });

  test('i2. download while Playwright is connected', async () => {
    const result = await rpc<{ state: string; text: string }>(
      'main.download',
      'i2.download-with-playwright-connected',
    );
    expect(result.state).toBe('completed');
    expect(result.text).toBe('smoke download\n');
  });

  test('c. hidden and covered window (recorded)', async () => {
    const tryClick = async (name: string, action: () => Promise<unknown>) => {
      const before = Number(await page.locator('#count').textContent());
      const started = Date.now();
      let outcome: string;
      try {
        await action();
        const after = Number(await page.locator('#count').textContent());
        outcome = `ok in ${Date.now() - started}ms, count ${before} -> ${after}`;
      } catch (error) {
        outcome = `threw after ${Date.now() - started}ms: ${(error as Error).message.split('\n')[0]}`;
      }
      note(name, outcome);
    };
    const rafFires = () =>
      page.evaluate(
        () =>
          new Promise<string>((resolve) => {
            requestAnimationFrame(() => resolve('raf fired'));
            setTimeout(() => resolve('raf did not fire in 1s'), 1000);
          }),
      );

    await rpc('main.setHidden', true);
    await expect.poll(() => rpc('main.isVisible')).toBe(false);
    note(
      'c1.state',
      `visibilityState=${await page.evaluate(() => document.visibilityState)} ${await rafFires()}`,
    );
    await tryClick('c1.hidden-click', () =>
      page.locator('#counter').click({ timeout: 5000 }),
    );
    await tryClick('c1.hidden-click-force', () =>
      page.locator('#counter').click({ timeout: 5000, force: true }),
    );
    await tryClick('c1.hidden-dispatchEvent', () =>
      page.locator('#counter').dispatchEvent('click', undefined, {
        timeout: 5000,
      }),
    );
    note(
      'c1.hidden-ariaSnapshot',
      `${(await page.ariaSnapshot({ mode: 'ai', timeout: 5000 })).split('\n').length} lines`,
    );

    await rpc('main.setHidden', false);
    await rpc('main.cover');
    await expect
      .poll(() => rpc<{ cover: boolean }>('main.focus').then((f) => f.cover))
      .toBe(true);
    note(
      'c2.state',
      `visibilityState=${await page.evaluate(() => document.visibilityState)} ${await rafFires()}`,
    );
    await tryClick('c2.behind-click', () =>
      page.locator('#counter').click({ timeout: 5000 }),
    );
    await rpc('main.uncover');
  });

  test('f. popups as WebContentsViews keep window.opener', async () => {
    await rpc('main.installPopupHandler');
    await page.locator('#open-popup').click({ timeout: 5000 });
    try {
      await expect(
        page.locator('#popup-result').getByText('opener got hi'),
      ).toBeVisible({ timeout: 5000 });
    } finally {
      note(
        'f.createWindow',
        (await rpc<string[]>('main.popupAttempts')).join('; ') ||
          'createWindow not called',
      );
    }
    const popup = await rpc<{ url: string; status: string } | null>(
      'main.popup',
    );
    note(
      'f.popup-webContents',
      popup ? `url=${popup.url} status=${popup.status}` : 'not found',
    );
    note(
      'f.playwright-pages-after-popup',
      String(page.context().pages().length),
    );
    await rpc('main.closePopup');
  });

  test('j. render process crash, reload and reconnect', async () => {
    const events: string[] = [];
    page.on('crash', () => events.push('crash'));
    page.on('close', () => events.push('close'));
    const targetBefore = (await rpc<{ targetId: string }>('main.info'))
      .targetId;

    expect(await rpc('main.crash'), 'render-process-gone fired').toBeTruthy();
    note('j.playwright-page-events', events.join(',') || 'none');
    note(
      'j.debugger-after-crash',
      `attached=${await rpc<boolean>('main.debuggerAttached')}`,
    );
    await disconnect();

    await rpc('main.reload');
    note(
      'j.targetId-after-reload',
      `stable=${targetBefore === (await rpc<{ targetId: string }>('main.info')).targetId}`,
    );

    await connect();
    await page.locator('#counter').click({ timeout: 5000 });
    await expect(page.locator('#count')).toHaveText('1');
    note('j.pages', String(browser.contexts()[0]!.pages().length));
  });
});

test.describe('electron/browser/playwright.ts', () => {
  test.beforeAll(() => rpc('pw.open'));
  test.afterAll(() => rpc('pw.close'));

  test('pageFor reuses one connection', async () => {
    const result = await rpc<{ same: boolean; count: string }>('pw.reuse');
    expect(result.same, 'two pages for one view').toBe(true);
    expect(result.count).toBe('1');
  });

  test('dropPage clears the connection and keeps a hidden tab awake while connected', async () => {
    const result = await rpc<{ connected: string; automation: unknown }>(
      'pw.hiddenConnectedThenDropped',
    );
    expect(result.connected, 'connected and hidden').toBe('visible');
    expect(result.automation, 'automation cleared').toBeNull();
  });

  // Playwright's own _electron connection emulates focus on every window, so a hidden view never reports `hidden` here (see c0 / c1 notes).
  test.fixme('dropPage lets a hidden tab sleep', async () => {
    const result = await rpc<{ dropped: string }>(
      'pw.hiddenConnectedThenDropped',
    );
    expect(result.dropped, 'dropped and hidden').toBe('hidden');
  });

  test('reconnects after drop', async () => {
    expect(await rpc('pw.reconnect')).toBe('2');
  });
});

interface Snapshot {
  text: string;
  refs: Record<
    string,
    { role: string; name: string; isSubmit?: boolean; isPassword?: boolean }
  >;
}

const refByName = (snap: Snapshot, role: string, name: string) => {
  const ref = Object.entries(snap.refs).find(
    ([, meta]) => meta.role === role && meta.name === name,
  )?.[0];
  expect(ref, `no ${role} "${name}" in snapshot`).toBeTruthy();
  return ref!;
};
const refByText = (snap: Snapshot, text: string) =>
  Object.keys(snap.refs).find((ref) =>
    snap.text.includes(`[ref=${ref}]: ${text}`),
  );

test.describe('electron/browser/views.ts', () => {
  const KEY = 'smoke';
  let snap: Snapshot;
  const act = (action: unknown, viewId?: string) =>
    rpc<{ note?: string }>('views.act', [KEY, action, viewId]);
  const actError = (action: unknown) => rpcError('views.act', [KEY, action]);
  const dom = (expression: string) =>
    rpc<string>('views.dom', [KEY, expression]);
  const ref = (role: string, name: string) => refByName(snap, role, name);

  test.beforeAll(async () => {
    await rpc('views.open', [KEY]);
    await expect.poll(() => rpc('views.isLoaded', [KEY])).toBe(true);
  });
  test.afterAll(() => rpc('views.close', [KEY]));

  test('k. snapshot flags submit and password', async () => {
    snap = await rpc<Snapshot>('views.snapshot', [KEY]);
    const flags = (role: string, name: string) => {
      const { isSubmit, isPassword } = snap.refs[ref(role, name)]!;
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
      Object.keys(want).map((key) => [
        key,
        flags(...(key.split('/') as [string, string])),
      ]),
    );
    expect(got).toEqual(want);
    expect(snap.text).toContain(`[ref=${ref('button', 'Sign in')}]`);
  });

  test('k. click', async () => {
    await act({ kind: 'click', ref: ref('button', 'Count') });
    expect(await dom("document.getElementById('count').textContent")).toBe('1');
  });

  test('k. hover', async () => {
    await act({ kind: 'hover', ref: ref('button', 'Count') });
    expect(await dom("document.getElementById('hovered').textContent")).toBe(
      'hovered',
    );
  });

  test('k. type replaces', async () => {
    await act({ kind: 'type', ref: ref('textbox', 'Name'), text: 'Ada' });
    await act({ kind: 'type', ref: ref('textbox', 'Name'), text: 'Grace' });
    expect(await dom("document.getElementById('name').value")).toBe('Grace');
  });

  test('k. type into a select', async () => {
    await act({ kind: 'type', ref: ref('combobox', 'Fruit'), text: 'Banana' });
    expect(await dom("document.getElementById('fruit').value")).toBe('banana');
  });

  test('k. select', async () => {
    await act({
      kind: 'select',
      ref: ref('combobox', 'Fruit'),
      value: 'Cherry',
    });
    expect(await dom("document.getElementById('fruit').value")).toBe('cherry');
  });

  test('k. select errors', async () => {
    expect(
      await actError({
        kind: 'select',
        ref: ref('textbox', 'Name'),
        value: 'x',
      }),
    ).toMatch(/not a <select>/);
    expect(
      await actError({
        kind: 'select',
        ref: ref('combobox', 'Fruit'),
        value: 'Durian',
      }),
    ).toMatch(/No option "Durian" in that list$/);
  });

  test('k. upload', async () => {
    const file = path.join(origins.downloads, 'views-upload.txt');
    writeFileSync(file, 'upload');
    await act({ kind: 'upload', ref: ref('button', 'Upload'), path: file });
    expect(await dom("document.getElementById('file').files[0]?.name")).toBe(
      'views-upload.txt',
    );
  });

  test('k. upload errors', async () => {
    expect(
      await actError({
        kind: 'upload',
        ref: ref('button', 'Upload'),
        path: path.join(origins.downloads, 'missing.txt'),
      }),
    ).toMatch(/No file at /);
    expect(
      await actError({
        kind: 'upload',
        ref: ref('textbox', 'Name'),
        path: path.join(origins.downloads, 'views-upload.txt'),
      }),
    ).toMatch(/not a file input/);
  });

  test('k. press Enter submits', async () => {
    await act({ kind: 'click', ref: ref('textbox', 'Name') });
    await act({ kind: 'press', key: 'Enter' });
    expect(
      await dom("document.getElementById('form-result').textContent"),
    ).toMatch(/^submitted name=Grace fruit=cherry file=views-upload\.txt/);
  });

  test('k. press unknown key', async () => {
    expect(await actError({ kind: 'press', key: 'Hyper' })).toMatch(
      /Unknown key "Hyper"; use a single character/,
    );
  });

  test('k. type into a non-text element', async () => {
    expect(
      await actError({ kind: 'type', ref: ref('button', 'Count'), text: 'x' }),
    ).toMatch(/That element takes no text$/);
  });

  test('k. drag', async () => {
    const from = refByText(snap, 'Drag me');
    const to = refByText(snap, 'Drop here');
    expect(from && to, 'drag refs').toBeTruthy();
    await act({ kind: 'drag', from, to });
    expect(
      await dom("document.getElementById('drop-result').textContent"),
    ).toBe('dropped');
  });

  test('k. scroll', async () => {
    const result = await act({ kind: 'scroll', dx: 0, dy: 600 });
    expect(result.note).toMatch(/^Scrolled to 0, [1-9]\d* of \d+$/);
  });

  test('k. stale ref', async () => {
    const old = ref('button', 'Count');
    snap = await rpc<Snapshot>('views.snapshot', [KEY]);
    expect(ref('button', 'Count'), 'generation changed').not.toBe(old);
    expect(await actError({ kind: 'click', ref: old })).toMatch(
      /No element g\d+-e\d+ on the page now; take a new browser_snapshot$/,
    );
  });

  test('k. click in a hidden window', async () => {
    await rpc('views.setHidden', [KEY, true]);
    await expect.poll(() => rpc('views.isVisible', [KEY])).toBe(false);
    await act({ kind: 'click', ref: ref('button', 'Count') });
    expect(await dom("document.getElementById('count').textContent")).toBe('2');
    await rpc('views.setHidden', [KEY, false]);
  });

  test('k. waitFor', async () => {
    await rpc('views.run', [KEY, 'reload']);
    const wait = (options: object) =>
      rpc<{ isMet: boolean }>('views.waitFor', [KEY, options]);
    expect(
      (await wait({ text: 'Late arrival', timeoutMs: 5000 })).isMet,
      'text appears',
    ).toBe(true);
    expect(
      (
        await wait({
          text: 'Never shows up',
          selector: '#nope',
          timeoutMs: 800,
        })
      ).isMet,
      'missing text times out',
    ).toBe(false);
    expect(
      (await wait({ url: 'browser-smoke', timeoutMs: 1000 })).isMet,
      'url matches',
    ).toBe(true);
  });

  test('k. waitFor rejects a bad selector', async () => {
    expect(
      await rpcError('views.waitFor', [
        KEY,
        { selector: '[[[', timeoutMs: 1000 },
      ]),
    ).toMatch(/selector/i);
  });

  test('k. crash shows an error that a reload clears', async () => {
    await expect.poll(() => rpc('views.isLoaded', [KEY])).toBe(true);
    await rpc('views.crash', [KEY]);
    await expect
      .poll(() =>
        rpc<{ error: unknown } | null>('views.lastState', [KEY]).then(
          (s) => s?.error,
        ),
      )
      .toBeTruthy();
    await rpc('views.run', [KEY, 'reload']);
    await expect
      .poll(() =>
        rpc<{ error: unknown; isLoading: boolean } | null>('views.lastState', [
          KEY,
        ]).then((s) => s && s.error === null && !s.isLoading),
      )
      .toBe(true);
    snap = await rpc<Snapshot>('views.snapshot', [KEY]);
    await act({ kind: 'click', ref: ref('button', 'Count') });
    expect(await dom("document.getElementById('count').textContent")).toBe('1');
  });
});

test.describe('views.ts dialogs', () => {
  const KEY = 'smoke-dialogs';
  const DIALOG_NOTE =
    'An alert dialog is open: "alert message"; answer it with browser_dialog';
  let snap: Snapshot;
  const dom = (expression: string) =>
    rpc<string>('views.dom', [KEY, expression]);
  const dialogResult = () =>
    dom("document.getElementById('dialog-result').textContent");
  const answer = (accept: boolean) => rpc('views.answer', [KEY, accept]);
  const openKind = () =>
    rpc<{ kind: string | null } | null>('views.lastDialog', [KEY]).then(
      (d) => d?.kind,
    );
  const opens = (kind: string) => expect.poll(openKind).toBe(kind);
  const closes = () => expect.poll(openKind).toBeNull();
  // Electron's native sheet closes with the answer; sheet-begin / sheet-end are macOS only.
  const sheetsClosed = async () => {
    if (process.platform !== 'darwin') return;
    await expect.poll(() => rpc('views.sheets', [KEY])).toBe(0);
  };
  const click = (name: string) =>
    rpc<{ note?: string }>('views.act', [
      KEY,
      { kind: 'click', ref: refByName(snap, 'button', name) },
    ]);

  test.beforeAll(async () => {
    await rpc('views.open', [KEY]);
    await expect.poll(() => rpc('views.isLoaded', [KEY])).toBe(true);
  });
  test.afterAll(() => rpc('views.close', [KEY]));

  test('m. dialog is tracked without Playwright', async () => {
    await rpc('views.userClicks', [KEY, '#alert']);
    await opens('alert');
    expect(
      (await rpc<{ message: string }>('views.lastDialog', [KEY])).message,
    ).toBe('alert message');
    await answer(true);
    await closes();
    expect(await dialogResult()).toBe('alert done');
    await sheetsClosed();
    snap = await rpc<Snapshot>('views.snapshot', [KEY]);
  });

  test('m. a user dialog is not auto-dismissed while Playwright is connected', async () => {
    await rpc('views.userClicks', [KEY, '#confirm']);
    await opens('confirm');
    await settle(1500);
    expect(await openKind(), 'dialog closed on its own').toBe('confirm');
    await answer(true);
    await closes();
    expect(await dialogResult()).toBe('confirm=true');
    await sheetsClosed();
  });

  test('m. an agent click that opens an alert returns a note', async () => {
    const started = Date.now();
    const { note: message } = await click('Alert');
    expect(message).toBe(DIALOG_NOTE);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test('m. actions fail fast while a dialog is open', async () => {
    const started = Date.now();
    expect(
      await rpcError('views.act', [
        KEY,
        { kind: 'click', ref: refByName(snap, 'button', 'Count') },
      ]),
    ).toContain(DIALOG_NOTE);
    expect(Date.now() - started).toBeLessThan(500);
  });

  test('m. answer alert', async () => {
    await answer(true);
    await closes();
    expect(await dialogResult()).toBe('alert done');
    await sheetsClosed();
  });

  for (const accept of [true, false])
    test(`m. answer confirm ${accept}`, async () => {
      const { note: message } = await click('Confirm');
      expect(message).toMatch(/^A confirm dialog is open: "confirm message"/);
      await answer(accept);
      await closes();
      expect(await dialogResult()).toBe(`confirm=${accept}`);
      await sheetsClosed();
    });

  test('m. answering with no dialog open fails', async () => {
    expect(await rpcError('views.answer', [KEY, true])).toMatch(
      /No dialog is open in this tab$/,
    );
  });

  test('m. reload while a dialog is open (recorded)', async () => {
    await rpc('views.userClicks', [KEY, '#confirm']);
    await opens('confirm');
    await rpc('views.run', [KEY, 'reload']);
    await settle(1500);
    note(
      'm.reload-while-open',
      `dialog=${JSON.stringify(await rpc('views.lastDialog', [KEY]))} openSheets=${await rpc<number>('views.sheets', [KEY])}`,
    );
  });
});

test.describe('views.ts popups', () => {
  const KEY = 'smoke-popup';
  let opener: string;
  let popup: { id: string; viewId: string; url: string };
  const popups = () => rpc<(typeof popup)[]>('views.events', [KEY, 'popup']);
  const dom = (viewId: string, expression: string) =>
    rpc<string>('views.dom', [KEY, expression, viewId]);
  const clickByName = async (viewId: string, name: string) => {
    const snap = await rpc<Snapshot>('views.snapshot', [KEY, viewId]);
    return rpc<{ note?: string }>('views.act', [
      KEY,
      { kind: 'click', ref: refByName(snap, 'button', name) },
      viewId,
    ]);
  };
  const openerResult = () =>
    dom(opener, "document.getElementById('popup-result').textContent");
  const openPopup = async () => {
    const before = (await popups()).length;
    await clickByName(opener, 'Open popup');
    await expect
      .poll(async () => (await popups()).length)
      .toBeGreaterThan(before);
    const made = (await popups()).at(-1)!;
    // The renderer gives the popup's tab bounds; a view without them lays out at 0 × 0 and nothing in it is clickable.
    await rpc('views.setBounds', [KEY, made.viewId]);
    return made;
  };

  test.beforeAll(async () => {
    opener = await rpc<string>('views.open', [KEY]);
    await expect.poll(() => rpc('views.isLoaded', [KEY])).toBe(true);
  });
  test.afterAll(() => rpc('views.close', [KEY]));

  test('n. popup event carries a new view', async () => {
    popup = await openPopup();
    expect(popup.id).toBe(opener);
    expect(popup.viewId).not.toBe(opener);
    expect(popup.url).toBe(`${origins.a}/popup.html`);
  });

  test('n. the opener gets the popup postMessage', async () => {
    await expect.poll(openerResult).toBe('opener got hi');
    note(
      'n.popup-status',
      JSON.stringify(
        await dom(
          popup.viewId,
          "document.getElementById('status').textContent",
        ),
      ),
    );
  });

  test('n. popup is hardened and shares the session', async () => {
    expect(await rpc('views.popupHardening')).toEqual({
      sameSession: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    });
  });

  test('n. popup sends state events', async () => {
    await expect
      .poll(async () =>
        (
          await rpc<{ id: string; url: string }[]>('views.events', [
            KEY,
            'state',
          ])
        ).some((e) => e.id === popup.viewId && e.url.endsWith('/popup.html')),
      )
      .toBe(true);
  });

  test('n. snapshot and click work inside the popup', async () => {
    await clickByName(popup.viewId, 'Ping opener');
    await expect.poll(openerResult).toBe('opener got ping');
  });

  test('n. window.close emits closed and frees the popup', async () => {
    const { note: message } = await clickByName(popup.viewId, 'Close me').catch(
      (error: Error) => ({ note: `act threw: ${error.message}` }),
    );
    await expect
      .poll(async () =>
        (await rpc<{ id: string }[]>('views.events', [KEY, 'closed'])).some(
          (e) => e.id === popup.viewId,
        ),
      )
      .toBe(true);
    expect(await rpcError('views.snapshot', [KEY, popup.viewId])).toMatch(
      /unknown view/,
    );
    expect(await rpc('views.hasPopupWebContents')).toBe(false);
    note('n.window-close', message ? `act: ${message}` : 'act resolved');
  });

  test('n. destroying a popup keeps the opener', async () => {
    const second = await openPopup();
    await rpc('views.destroyView', [KEY, second.viewId]);
    await settle(300);
    expect(
      (await rpc<{ id: string }[]>('views.events', [KEY, 'closed'])).some(
        (e) => e.id === second.viewId,
      ),
      'destroyView emitted closed',
    ).toBe(false);
    const count = Number(
      (await dom(opener, "document.getElementById('count').textContent")) || 0,
    );
    await clickByName(opener, 'Count');
    await expect
      .poll(async () =>
        Number(
          await dom(opener, "document.getElementById('count').textContent"),
        ),
      )
      .toBe(count + 1);
  });

  test('n. file: popups are denied', async () => {
    const before = (await popups()).length;
    const all = await rpc<number>('views.webContentsCount');
    await clickByName(opener, 'Open file popup');
    await settle(1000);
    expect(await popups(), 'popup events').toHaveLength(before);
    expect(await rpc('views.webContentsCount'), 'webContents created').toBe(
      all,
    );
  });

  // Chromium opens window.open('javascript:…') as about:blank and runs the script there, so the handler only sees about:blank.
  test('n. javascript: popups (recorded)', async () => {
    const before = (await popups()).length;
    await clickByName(opener, 'Open javascript popup');
    await settle(1000);
    const made = (await popups()).slice(before);
    for (const p of made) await rpc('views.destroyView', [KEY, p.viewId]);
    note('n.javascript-open', `popup events: ${JSON.stringify(made)}`);
  });
});
