// Compiles the trackpad haptic helper for the packaged app, which ships it as a resource (electron-builder `extraResources`):
// a Mac without Xcode can't compile it on first use the way `pnpm electron:dev` does.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

if (process.platform === 'darwin') {
  mkdirSync('build/native', { recursive: true });
  execFileSync('xcrun', ['swiftc', '-O', 'electron/haptics/haptic.swift', '-o', 'build/native/haptic'], { stdio: 'inherit' });
}
