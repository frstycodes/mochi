// Compiles the Swift helpers for the packaged app, which ships them as resources (electron-builder `extraResources`): a Mac
// without Xcode can't compile them on first use the way `pnpm electron:dev` does (electron/native.ts).
// On Linux, node-pty ships no prebuild, so its install compiled one into build/Release (N-API, so the same binary loads in
// Electron); copying it to where the other platforms' prebuilds sit lets package.json pack `prebuilds/${platform}-${arch}` everywhere.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HELPERS = {
  haptic: 'electron/haptics/haptic.swift',
  windows: 'electron/windows/windows.swift',
};

if (process.platform === 'darwin') {
  mkdirSync('build/native', { recursive: true });
  for (const [name, source] of Object.entries(HELPERS))
    execFileSync(
      'xcrun',
      ['swiftc', '-O', source, '-o', `build/native/${name}`],
      { stdio: 'inherit' },
    );
}

// uv runs the Google Workspace connector's server (electron/library/googleWorkspace.ts). GAP: Windows (a .zip) isn't fetched yet.
const UV_VERSION = '0.8.15';
// SHA-256 of each archive, from uv's published `.sha256` files for UV_VERSION: update both together.
const UV_TARGETS = {
  'darwin-arm64': [
    'aarch64-apple-darwin',
    '103367962c5cb00bf7370d84cbaa3fec5a9807be9cc833ea9d8eea400c119fa2',
  ],
  'darwin-x64': [
    'x86_64-apple-darwin',
    '2bbef70982e97dfc36454de173f35ec1a5e83ae11e3885df6a50db3fd76171cb',
  ],
  'linux-arm64': [
    'aarch64-unknown-linux-gnu',
    '6ede0fefa7db7be3d5d9eda8784a8e43b1cf5410720eb3da60ab1d2f66678e82',
  ],
  'linux-x64': [
    'x86_64-unknown-linux-gnu',
    'be9878e9d08ebcb621a683aba52e7fb8bbf92b2532e0d759026ffcc067673042',
  ],
};
const uv = UV_TARGETS[`${process.platform}-${process.arch}`];
if (uv) {
  const [uvTarget, sha256] = uv;
  mkdirSync('build/native', { recursive: true });
  const url = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${uvTarget}.tar.gz`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`uv download failed: ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const actual = createHash('sha256').update(archive).digest('hex');
  if (actual !== sha256)
    throw new Error(
      `uv ${UV_VERSION} checksum mismatch: expected ${sha256}, got ${actual}`,
    );
  const file = join(mkdtempSync(join(tmpdir(), 'uv-')), 'uv.tar.gz');
  writeFileSync(file, archive);
  execFileSync(
    'tar',
    [
      '-xz',
      '-f',
      file,
      '-C',
      'build/native',
      '--strip-components=1',
      `uv-${uvTarget}/uv`,
    ],
    { stdio: 'inherit' },
  );
}

if (process.platform === 'linux') {
  const prebuild = `node_modules/node-pty/prebuilds/linux-${process.arch}`;
  mkdirSync(prebuild, { recursive: true });
  cpSync(
    'node_modules/node-pty/build/Release/pty.node',
    `${prebuild}/pty.node`,
  );
}
