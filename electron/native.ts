import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';

const run = promisify(execFile);
const binaries = new Map<string, Promise<string | null>>();

/**
 * The path of a Swift helper binary, macOS only: in a packaged app the copy scripts/build-native.mjs shipped as a resource,
 * in `pnpm electron:dev` compiled on first use with Xcode's swiftc and kept per source hash. Null when there's none (no Xcode).
 */
export function nativeHelper(name: string, source: string) {
  if (process.platform !== 'darwin') return Promise.resolve(null);
  if (!binaries.has(name)) binaries.set(name, (app.isPackaged ? shipped(name) : compiled(name, source)).catch((error) => (console.warn(`Native helper ${name} unavailable`, error), null)));
  return binaries.get(name)!;
}

async function shipped(name: string) {
  const binary = path.join(process.resourcesPath, name);
  return existsSync(binary) ? binary : null;
}

async function compiled(name: string, source: string) {
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 12);
  const dir = path.join(app.getPath('userData'), 'native');
  const binary = path.join(dir, `${name}-${hash}`);
  if (existsSync(binary)) return binary;
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name}-${hash}.swift`);
  await writeFile(file, source);
  await run('xcrun', ['swiftc', '-O', file, '-o', binary]);
  return binary;
}
