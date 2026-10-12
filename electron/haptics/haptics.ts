import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';
import helperSource from './haptic.swift?raw';

const run = promisify(execFile);
let helper: Promise<ChildProcessWithoutNullStreams | null> | undefined;

/** One trackpad tick. Best effort: no Xcode to compile the helper, or no Force Touch trackpad, means no haptic. */
export function playHaptic() {
  if (process.platform !== 'darwin') return;
  helper ??= start();
  void helper.then((child) => child?.stdin.write('\n'));
}

// GAP: compiled on first use like the simulator helper, so it needs Xcode's swiftc; a packaged build should ship the binary.
async function start() {
  try {
    const hash = createHash('sha256').update(helperSource).digest('hex').slice(0, 12);
    const dir = path.join(app.getPath('userData'), 'haptics');
    const binary = path.join(dir, `haptic-${hash}`);
    if (!existsSync(binary)) {
      await mkdir(dir, { recursive: true });
      const source = path.join(dir, `haptic-${hash}.swift`);
      await writeFile(source, helperSource);
      await run('xcrun', ['swiftc', '-O', source, '-o', binary]);
    }
    const child = spawn(binary);
    child.on('exit', () => (helper = undefined));
    app.on('will-quit', () => child.kill());
    return child;
  } catch (error) {
    console.warn('Haptics unavailable', error);
    return null;
  }
}
