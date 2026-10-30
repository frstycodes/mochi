import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { runCommand } from '@mochi/core/runClient';
import { cached } from './cache.ts';

const COMPILE_TIMEOUT_MS = 5 * 60_000;
const NATIVE_TTL = '365 days';

interface Compiler {
  extension: string;
  args: (source: string, out: string) => string[];
}

const SWIFT: Compiler = {
  extension: 'swift',
  args: (source, out) => ['swiftc', '-O', source, '-o', out],
};

/** An Objective-C++ Node-API add-on, loaded into the main process with `process.dlopen`. Keep in step with scripts/build-native.mjs. */
export const OBJC_ADDON: Compiler = {
  extension: 'mm',
  args: (source, out) => [
    'clang++',
    '-O2',
    '-fobjc-arc',
    '-bundle',
    '-undefined',
    'dynamic_lookup',
    '-framework',
    'AppKit',
    source,
    '-o',
    out,
  ],
};

/**
 * The path of a native helper binary, macOS only: in a packaged app the copy scripts/build-native.mjs shipped as a resource,
 * in `pnpm electron:dev` compiled on first use with Xcode's toolchain and kept per source hash. Null when there's none (no Xcode).
 */
export function nativeHelper(name: string, source: string, compiler = SWIFT) {
  if (process.platform !== 'darwin') return Promise.resolve(null);
  return cached(`native:${name}`, NATIVE_TTL, () =>
    (app.isPackaged ? shipped(name) : compiled(name, source, compiler)).catch(
      (error) => (
        console.warn(`Native helper ${name} unavailable`, error),
        null
      ),
    ),
  );
}

async function shipped(name: string) {
  const binary = path.join(process.resourcesPath, name);
  return existsSync(binary) ? binary : null;
}

async function compiled(name: string, source: string, compiler: Compiler) {
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 12);
  const dir = path.join(app.getPath('userData'), 'native');
  const binary = path.join(dir, `${name}-${hash}`);
  if (existsSync(binary)) return binary;
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name}-${hash}.${compiler.extension}`);
  await writeFile(file, source);
  await runCommand('xcrun', compiler.args(file, binary), {
    timeout: COMPILE_TIMEOUT_MS,
  });
  return binary;
}
