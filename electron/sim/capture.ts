import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { runCommand, spawnCommand, type CoreChild } from '@mochi/core/runClient';

const SCREENSHOT_TIMEOUT_MS = 30_000;
// simctl records until it gets SIGINT; the cap ends a recording nobody stopped.
const RECORDING_TIMEOUT_MS = 30 * 60_000;
const recordings = new Map<string, { child: CoreChild; file: string }>();

export async function screenshot(udid: string) {
  const file = await captureFile(udid, 'png');
  await runCommand('xcrun', ['simctl', 'io', udid, 'screenshot', '--type=png', file], { timeout: SCREENSHOT_TIMEOUT_MS });
  return file;
}

export async function startRecording(udid: string) {
  if (recordings.has(udid)) throw new Error('Already recording this simulator');
  const file = await captureFile(udid, 'mp4');
  const child = spawnCommand('xcrun', ['simctl', 'io', udid, 'recordVideo', '--codec=h264', '--force', file], { timeout: RECORDING_TIMEOUT_MS });
  recordings.set(udid, { child, file });
  // simctl prints "Recording started" once the first frame is in; stopping earlier leaves an empty file.
  await new Promise<void>((resolve, reject) => {
    child.stderr.setEncoding('utf8').on('data', (text: string) => text.includes('Recording started') && resolve());
    child.once('exit', (code) => {
      recordings.delete(udid);
      reject(new Error(`Recording stopped early (${code})`));
    });
  });
}

export async function stopRecording(udid: string) {
  const recording = recordings.get(udid);
  if (!recording) throw new Error('Not recording this simulator');
  recordings.delete(udid);
  const exited = new Promise((resolve) => (recording.child.hasExited ? resolve(null) : recording.child.once('exit', resolve)));
  recording.child.kill('SIGINT');
  await exited;
  return recording.file;
}

export function stopAllRecordings() {
  for (const { child } of recordings.values()) child.kill('SIGINT');
  recordings.clear();
}

async function captureFile(udid: string, extension: string) {
  const dir = path.join(app.getPath('userData'), 'simulator', 'captures');
  await mkdir(dir, { recursive: true });
  return path.join(dir, `${udid.slice(0, 8)}-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`);
}
