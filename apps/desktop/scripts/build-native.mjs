// Compiles the Swift helpers for the packaged app, which ships them as resources (electron-builder `extraResources`): a Mac
// without Xcode can't compile them on first use the way `pnpm electron:dev` does (electron/native.ts).
// macOS releases pack arm64 and x64 apps from one run (one update feed lists both), so every Mac binary here is universal.
// On Linux, node-pty ships no prebuild, so its install compiled one into build/Release (N-API, so the same binary loads in
// Electron); copying it to where the other platforms' prebuilds sit lets package.json pack `prebuilds/${platform}-${arch}` everywhere.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Each helper's minimum macOS; without a target, swiftc requires the build machine's. Haptics run on Electron's own
// minimum (LSMinimumSystemVersion 13.0); the window helper needs ScreenCaptureKit's screenshots, so it won't start on 13.
const HELPERS = {
  haptic: ['electron/haptics/haptic.swift', '13.0'],
  windows: ['electron/windows/windows.swift', '14.0'],
  fonts: ['electron/fonts/fonts.swift', '13.0'],
};

const MAC_ARCHS = { arm64: 'arm64', x64: 'x86_64' };

if (process.platform === 'darwin') {
  mkdirSync('build/native', { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), 'helpers-'));
  for (const [name, [source, minimum]] of Object.entries(HELPERS)) {
    const slices = Object.values(MAC_ARCHS).map((arch) => {
      const out = join(scratch, `${name}-${arch}`);
      execFileSync(
        'xcrun',
        [
          'swiftc',
          '-O',
          '-target',
          `${arch}-apple-macos${minimum}`,
          source,
          '-o',
          out,
        ],
        { stdio: 'inherit' },
      );
      return out;
    });
    lipo(slices, `build/native/${name}`);
  }
  // The sidebar glass is a Node-API add-on loaded into Electron, not a helper process: same flags as OBJC_ADDON in electron/native.ts.
  execFileSync(
    'xcrun',
    [
      'clang++',
      '-O2',
      '-fobjc-arc',
      '-bundle',
      '-undefined',
      'dynamic_lookup',
      '-framework',
      'AppKit',
      ...Object.values(MAC_ARCHS).flatMap((arch) => ['-arch', arch]),
      '-mmacosx-version-min=13.0',
      'electron/sidebarGlass/sidebarGlass.mm',
      '-o',
      'build/native/sidebar-glass',
    ],
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
if (process.platform === 'darwin') {
  const scratch = mkdtempSync(join(tmpdir(), 'uv-'));
  const slices = await Promise.all(
    Object.keys(MAC_ARCHS).map(async (arch) => {
      const dir = join(scratch, arch);
      mkdirSync(dir);
      await fetchUv(UV_TARGETS[`darwin-${arch}`], dir);
      return join(dir, 'uv');
    }),
  );
  lipo(slices, 'build/native/uv');
} else if (UV_TARGETS[`${process.platform}-${process.arch}`]) {
  mkdirSync('build/native', { recursive: true });
  await fetchUv(
    UV_TARGETS[`${process.platform}-${process.arch}`],
    'build/native',
  );
}

// pnpm installs only this machine's @parcel/watcher prebuild; the other Mac architecture's comes straight from npm.
if (process.platform === 'darwin') {
  const { version } = JSON.parse(
    readFileSync('node_modules/@parcel/watcher/package.json', 'utf8'),
  );
  for (const arch of Object.keys(MAC_ARCHS)) {
    const target = `../../node_modules/@parcel/watcher-darwin-${arch}`;
    if (existsSync(target)) continue;
    const scratch = mkdtempSync(join(tmpdir(), 'watcher-'));
    execFileSync(
      'npm',
      [
        'pack',
        `@parcel/watcher-darwin-${arch}@${version}`,
        '--pack-destination',
        scratch,
      ],
      { stdio: 'inherit' },
    );
    const tarball = join(
      scratch,
      `parcel-watcher-darwin-${arch}-${version}.tgz`,
    );
    const integrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
    if (
      lockfileIntegrity(`@parcel/watcher-darwin-${arch}@${version}`) !==
      integrity
    )
      throw new Error(
        `@parcel/watcher-darwin-${arch}@${version} doesn't match pnpm-lock.yaml`,
      );
    mkdirSync(target);
    execFileSync(
      'tar',
      ['-xzf', tarball, '-C', target, '--strip-components=1'],
      {
        stdio: 'inherit',
      },
    );
  }
}

function lockfileIntegrity(name) {
  const lock = readFileSync('../../pnpm-lock.yaml', 'utf8');
  return (
    lock.match(
      new RegExp(`'${name}':\\n\\s+resolution: \\{integrity: (\\S+)\\}`),
    )?.[1] ?? ''
  );
}

function lipo(slices, out) {
  execFileSync('lipo', ['-create', ...slices, '-output', out], {
    stdio: 'inherit',
  });
}

async function fetchUv([uvTarget, sha256], dir) {
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
    ['-xz', '-f', file, '-C', dir, '--strip-components=1', `uv-${uvTarget}/uv`],
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
