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

if (process.platform === 'linux') {
  const prebuild = `node_modules/node-pty/prebuilds/linux-${process.arch}`;
  mkdirSync(prebuild, { recursive: true });
  cpSync('node_modules/node-pty/build/Release/pty.node', `${prebuild}/pty.node`);
}
