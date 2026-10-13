// Compiles the Swift helpers for the packaged app, which ships them as resources (electron-builder `extraResources`): a Mac
// without Xcode can't compile them on first use the way `pnpm electron:dev` does (electron/native.ts).
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const HELPERS = { haptic: 'electron/haptics/haptic.swift', windows: 'electron/windows/windows.swift' };

if (process.platform === 'darwin') {
  mkdirSync('build/native', { recursive: true });
  for (const [name, source] of Object.entries(HELPERS)) execFileSync('xcrun', ['swiftc', '-O', source, '-o', `build/native/${name}`], { stdio: 'inherit' });
}
