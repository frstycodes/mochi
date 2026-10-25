import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, type WebContents } from 'electron';
import {
  runCommand,
  spawnCommand,
  type CoreChild,
} from '@mochi/core/runClient';
import type { SimFrame } from '@mochi/domain/host/types/sim';
import { frameSplitter } from './parse.ts';
import helperSource from './simhelper.swift?raw';

const COMPILE_TIMEOUT_MS = 5 * 60_000;

interface Stream {
  /** Unset while the helper compiles. */
  child?: CoreChild;
  viewers: Set<WebContents>;
  size: Promise<{ width: number; height: number }>;
  /** Replayed to viewers that join an idle screen: the helper only sends frames when the screen changes. */
  lastFrame?: SimFrame;
}

const streams = new Map<string, Stream>();
let helperPath: Promise<string> | undefined;

export async function developerDir() {
  const { stdout } = await runCommand('xcode-select', ['-p'], {
    timeout: 10_000,
  });
  return stdout.trim();
}

/** Starts (or joins) the helper for `udid` and forwards its frames to `viewer` until it stops or the viewer goes away. */
export function startStream(udid: string, viewer: WebContents) {
  const stream = streams.get(udid) ?? spawnStream(udid);
  if (!stream.viewers.has(viewer))
    viewer.once('destroyed', () => leave(udid, viewer));
  stream.viewers.add(viewer);
  if (stream.lastFrame) viewer.send('sim:onFrame', stream.lastFrame);
  return stream.size;
}

export function stopStream(udid: string, viewer: WebContents) {
  leave(udid, viewer);
}

/** Sends one JSON command to the device's helper; input only works while its screen streams. */
export function command(udid: string, message: Record<string, unknown>) {
  const child = streams.get(udid)?.child;
  if (!child) throw new Error('Simulator screen is not streaming');
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

export function stopAll() {
  for (const { child } of streams.values()) child?.kill();
  streams.clear();
}

function leave(udid: string, viewer: WebContents) {
  const stream = streams.get(udid);
  if (!stream) return;
  stream.viewers.delete(viewer);
  if (stream.viewers.size > 0) return;
  stream.child?.kill();
  streams.delete(udid);
}

function spawnStream(udid: string): Stream {
  let resolveSize!: (size: { width: number; height: number }) => void;
  let rejectSize!: (error: Error) => void;
  const size = new Promise<{ width: number; height: number }>(
    (resolve, reject) => ((resolveSize = resolve), (rejectSize = reject)),
  );
  const stream: Stream = { viewers: new Set(), size };
  streams.set(udid, stream);

  Promise.all([compileHelper(), developerDir()])
    .then(([binary, devDir]) => {
      if (streams.get(udid) !== stream) return;
      const child = spawnCommand(binary, [devDir, udid]);
      stream.child = child;
      child.stdout.on(
        'data',
        frameSplitter((data) => {
          const frame: SimFrame = { udid, data, mime: 'image/jpeg' };
          stream.lastFrame = frame;
          for (const viewer of stream.viewers)
            if (!viewer.isDestroyed()) viewer.send('sim:onFrame', frame);
        }),
      );
      child.stderr.setEncoding('utf8').on('data', (text: string) => {
        for (const line of text.split('\n')) {
          const ready = /^ready (\d+) (\d+)$/.exec(line);
          if (ready)
            resolveSize({ width: Number(ready[1]), height: Number(ready[2]) });
          else if (line.startsWith('error '))
            rejectSize(new Error(line.slice(6)));
        }
      });
      child.on('exit', (code) => {
        rejectSize(new Error(`Simulator helper exited (${code ?? 'killed'})`));
        if (streams.get(udid) === stream) streams.delete(udid);
      });
    })
    .catch((error: Error) => {
      streams.delete(udid);
      rejectSize(error);
    });
  return stream;
}

// Compiled on first use, keyed by source hash, so the app ships Swift source instead of a signed binary.
function compileHelper() {
  helperPath ??= (async () => {
    const hash = createHash('sha256')
      .update(helperSource)
      .digest('hex')
      .slice(0, 12);
    const dir = path.join(app.getPath('userData'), 'simulator');
    const binary = path.join(dir, `simhelper-${hash}`);
    if (existsSync(binary)) return binary;
    await mkdir(dir, { recursive: true });
    const source = path.join(dir, `simhelper-${hash}.swift`);
    await writeFile(source, helperSource);
    await runCommand('xcrun', ['swiftc', '-O', source, '-o', binary], {
      timeout: COMPILE_TIMEOUT_MS,
    });
    return binary;
  })().catch((error: Error) => {
    helperPath = undefined;
    throw new Error(
      `Couldn't compile the simulator helper (needs Xcode): ${error.message}`,
    );
  });
  return helperPath;
}
