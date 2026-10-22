import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

const EVENTS_PER_SEC = 30;
const SECONDS = 10;
// Baseline, origin/migration 4729d2d9 (selector store, #295): 399–446 renders/event, 191–240 script ms/s on an M-series Mac
// running other builds, 387–391 and 280–289 on the CI runner. A whole-state context measured 3,645 and 502 on the Mac.
const MAX_RENDERS_PER_EVENT = 650;
const MAX_SCRIPT_MS_PER_SEC = 400;

const ROOT = path.resolve(import.meta.dirname, '../..');

test('a streamed reply stays inside its render and script budget', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'mochi-perf-'));
  const app = await launch(userData);
  try {
    const page = await app.firstWindow();
    await app.context().addInitScript({ path: path.join(import.meta.dirname, 'render-hook.js') });
    // Fixture threads, so the run needs no saved data.
    await page.evaluate(() => localStorage.setItem('mochi.prefs.v1', JSON.stringify({ demoData: true })));
    await page.reload();
    const row = page.locator('[data-thread-row]').first();
    const threadId = await row.getAttribute('data-thread-row');
    expect(threadId).toBeTruthy();
    await row.locator('[data-sidebar=menu-button]').first().click();

    const cdp = await app.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const scriptSeconds = async () => {
      const { metrics } = await cdp.send('Performance.getMetrics');
      const value = (name: string) => metrics.find((m) => m.name === name)!.value;
      return { script: value('ScriptDuration'), at: value('Timestamp') };
    };

    await page.evaluate(() => Object.assign(window.__perf, { renders: 0, commits: 0, isCounting: true }));
    const before = await scriptSeconds();
    const events = await streamFromMain(app, threadId!);
    const after = await scriptSeconds();
    const { renders, commits } = await page.evaluate(() => ({ ...window.__perf, isCounting: false }));

    const measured = {
      events,
      rendersPerEvent: renders / events,
      commitsPerEvent: commits / events,
      scriptMsPerSec: (1000 * (after.script - before.script)) / (after.at - before.at),
    };
    console.log(JSON.stringify(measured));
    await expect(page.getByText(`word${events - 1} and`)).toBeVisible();
    expect(renders, 'the render hook saw no commits').toBeGreaterThan(0);
    expect.soft(measured.rendersPerEvent, 'renders per event').toBeLessThanOrEqual(MAX_RENDERS_PER_EVENT);
    expect.soft(measured.scriptMsPerSec, 'renderer script ms/s').toBeLessThanOrEqual(MAX_SCRIPT_MS_PER_SEC);
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
  }
});

function launch(userData: string) {
  return electron.launch({
    cwd: ROOT,
    // A window CI never focuses must keep its frames and timers, or the stream batches differently than on a desk.
    args: ['.', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
    env: { ...process.env, MOCHI_USER_DATA: userData },
  });
}

/** Text deltas for one thread over the real `agent:onEvent` IPC channel, as an agent's reply arrives; resolves with the count. */
function streamFromMain(app: ElectronApplication, threadId: string) {
  return app.evaluate(
    ({ BrowserWindow }, { threadId, rate, seconds }) =>
      new Promise<number>((resolve) => {
        const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))!;
        // Above any seq main numbered this launch (`electron/agents/events.ts` starts at the clock).
        let seq = Date.now() * 2;
        const send = (event: object) => win.webContents.send('agent:onEvent', { threadId, type: 'message', ...event, seq: ++seq });
        send({ text: '\n\nSynthetic stream: ', isDelta: false });
        let i = 0;
        const timer = setInterval(() => {
          send({ text: `word${i} and `, isDelta: true });
          if (++i < rate * seconds) return;
          clearInterval(timer);
          resolve(i);
        }, 1000 / rate);
      }),
    { threadId, rate: EVENTS_PER_SEC, seconds: SECONDS },
  );
}

declare global {
  interface Window {
    __perf: { renders: number; commits: number; isCounting: boolean };
  }
}
