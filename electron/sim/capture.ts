import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';

const run = promisify(execFile);
const recordings = new Map<string, { child: ChildProcess; file: string }>();

export async function screenshot(udid: string) {
  const file = await captureFile(udid, 'png');
  await run('xcrun', ['simctl', 'io', udid, 'screenshot', '--type=png', file]);
  return file;
}

export async function startRecording(udid: string) {
  if (recordings.has(udid)) throw new Error('Already recording this simulator');
  const file = await captureFile(udid, 'mp4');
  const child = spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', '--codec=h264', '--force', file]);
  recordings.set(udid, { child, file });
  // simctl prints "Recording started" once the first frame is in; stopping earlier leaves an empty file.
  await new Promise<void>((resolve, reject) => {
    child.stderr?.setEncoding('utf8').on('data', (text: string) => text.includes('Recording started') && resolve());
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
  const exited = new Promise((resolve) => recording.child.once('exit', resolve));
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
