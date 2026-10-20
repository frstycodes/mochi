// Compiles the Swift helpers for the packaged app, which ships them as resources (electron-builder `extraResources`): a Mac
// without Xcode can't compile them on first use the way `pnpm electron:dev` does (electron/native.ts).
// On Linux, node-pty ships no prebuild, so its install compiled one into build/Release (N-API, so the same binary loads in
// Electron); copying it to where the other platforms' prebuilds sit lets package.json pack `prebuilds/${platform}-${arch}` everywhere.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';

const HELPERS = { haptic: 'electron/haptics/haptic.swift', windows: 'electron/windows/windows.swift' };

if (process.platform === 'darwin') {
  mkdirSync('build/native', { recursive: true });
  for (const [name, source] of Object.entries(HELPERS)) execFileSync('xcrun', ['swiftc', '-O', source, '-o', `build/native/${name}`], { stdio: 'inherit' });
}

// uv runs the Google Workspace connector's server (electron/library/googleWorkspace.ts). GAP: Windows (a .zip) isn't fetched yet.
const UV_VERSION = '0.8.15';
const UV_TARGETS = { 'darwin-arm64': 'aarch64-apple-darwin', 'darwin-x64': 'x86_64-apple-darwin', 'linux-arm64': 'aarch64-unknown-linux-gnu', 'linux-x64': 'x86_64-unknown-linux-gnu' };
const uvTarget = UV_TARGETS[`${process.platform}-${process.arch}`];
if (uvTarget) {
  mkdirSync('build/native', { recursive: true });
  const url = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${uvTarget}.tar.gz`;
  execFileSync('sh', ['-c', `curl -fsSL "${url}" | tar -xz -C build/native --strip-components=1 "uv-${uvTarget}/uv"`], { stdio: 'inherit' });
}

if (process.platform === 'linux') {
  const prebuild = `node_modules/node-pty/prebuilds/linux-${process.arch}`;
  mkdirSync(prebuild, { recursive: true });
  cpSync('node_modules/node-pty/build/Release/pty.node', `${prebuild}/pty.node`);
}
