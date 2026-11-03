import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';

// Node exports the same Node-API as Electron, so the add-on loads here; only argument checks run without a real window.
test.runIf(process.platform === 'darwin')(
  'the sidebar tint refuses bad arguments with a TypeError instead of crashing',
  () => {
    const binary = join(mkdtempSync(join(tmpdir(), 'tint-')), 'sidebar-tint');
    execFileSync('xcrun', [
      'clang++',
      '-fobjc-arc',
      '-bundle',
      '-undefined',
      'dynamic_lookup',
      '-framework',
      'AppKit',
      '-framework',
      'QuartzCore',
      join(import.meta.dirname, 'sidebarTint.mm'),
      '-o',
      binary,
    ]);
    const module = {
      exports: {} as Record<string, (...args: unknown[]) => void>,
    };
    process.dlopen(module, binary);
    const { setSidebarTint, clearTint } = module.exports;
    const nil = Buffer.alloc(8);
    const tint = { width: 240, rgba: [0, 0, 0, 0.12] };
    assert.throws(() => setSidebarTint(), TypeError);
    assert.throws(() => setSidebarTint(nil, { ...tint, width: -1 }), /width/);
    assert.throws(() => setSidebarTint(nil, { ...tint, width: NaN }), /width/);
    assert.throws(
      () => setSidebarTint(nil, { ...tint, rgba: [0, 0, 0] }),
      /rgba/,
    );
    assert.throws(
      () => setSidebarTint(nil, { ...tint, rgba: [0, 0, 2, 1] }),
      /rgba/,
    );
    assert.throws(() => setSidebarTint(nil, null), TypeError);
    assert.throws(() => setSidebarTint(Buffer.alloc(3), tint), TypeError);
    assert.throws(() => setSidebarTint(nil, tint), /not a view in a window/);
    assert.throws(() => clearTint('handle'), TypeError);
    assert.throws(() => clearTint(nil), TypeError);
  },
  60_000,
);
