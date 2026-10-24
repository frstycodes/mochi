import { app } from 'electron';
import { runCommand } from '@mochi/core/runClient';
import type { SimHost, SimLogLine } from '../../src/host/types/sim.ts';
import { buildAndRun } from '../sim/build.ts';
import { screenshot, startRecording, stopAllRecordings, stopRecording } from '../sim/capture.ts';
import { command, startStream, stopAll, stopStream } from '../sim/helper.ts';
import * as check from '../sim/parse.ts';
import type { Handlers } from './handlers.ts';

const SIMCTL_TIMEOUT_MS = 60_000;
const simctl = async (...args: string[]) => (await runCommand('xcrun', ['simctl', ...args], { timeout: SIMCTL_TIMEOUT_MS })).stdout.trim();

app.on('will-quit', () => {
  stopAll();
  stopAllRecordings();
});

export const sim = {
  list: async () => check.parseSimctlList(await simctl('list', '-j', 'devices')),
  boot: async (_sender, id) => {
    await simctl('boot', check.udid(id));
  },
  shutdown: async (_sender, id) => {
    await simctl('shutdown', check.udid(id));
  },
  stream: (sender, id) => startStream(check.udid(id), sender),
  stopStream: async (sender, id) => stopStream(check.udid(id), sender),
  touch: async (_sender, id, phase, x, y) => command(check.udid(id), { t: 'touch', phase: check.touchPhase(phase), x: check.unit(x, 'x'), y: check.unit(y, 'y') }),
  button: async (_sender, id, button) => command(check.udid(id), { t: 'button', name: check.button(button) }),
  key: async (_sender, id, usage) => press(check.udid(id), check.hidUsage(usage), false),
  type: async (_sender, id, text) => {
    const device = check.udid(id);
    const keys = check.textToKeys(text);
    if (keys) return keys.forEach(({ usage, shift }) => press(device, usage, shift));
    // No key for some character (emoji, accents): paste it through the device pasteboard instead.
    await pbcopy(device, text);
    command(device, { t: 'key', usage: 227, down: true });
    press(device, 25, false);
    command(device, { t: 'key', usage: 227, down: false });
  },
  openUrl: async (_sender, id, url) => {
    await simctl('openurl', check.udid(id), check.url(url));
  },
  appearance: async (_sender, id) => {
    const value = await simctl('ui', check.udid(id), 'appearance');
    return value === 'light' || value === 'dark' ? value : null;
  },
  setAppearance: async (_sender, id, value) => {
    await simctl('ui', check.udid(id), 'appearance', check.appearance(value));
  },
  contentSize: async (_sender, id) => {
    const value = await simctl('ui', check.udid(id), 'content_size');
    try {
      return check.contentSize(value);
    } catch {
      return null;
    }
  },
  setContentSize: async (_sender, id, value) => {
    await simctl('ui', check.udid(id), 'content_size', check.contentSize(value));
  },
  screenshot: async (_sender, id) => screenshot(check.udid(id)),
  startRecording: async (_sender, id) => startRecording(check.udid(id)),
  stopRecording: async (_sender, id) => stopRecording(check.udid(id)),
  buildAndRun: async (sender, id, cwd) => {
    const device = check.udid(id);
    return buildAndRun(device, cwd, (text) => {
      if (!sender.isDestroyed()) sender.send('sim:onBuildLog', { udid: device, text } satisfies SimLogLine);
    });
  },
} satisfies Handlers<SimHost>;

function press(udid: string, usage: number, shift: boolean) {
  if (shift) command(udid, { t: 'key', usage: check.SHIFT, down: true });
  command(udid, { t: 'key', usage, down: true });
  command(udid, { t: 'key', usage, down: false });
  if (shift) command(udid, { t: 'key', usage: check.SHIFT, down: false });
}

function pbcopy(udid: string, text: string) {
  return runCommand('xcrun', ['simctl', 'pbcopy', udid], { input: text, timeout: SIMCTL_TIMEOUT_MS }).then(() => {});
}
