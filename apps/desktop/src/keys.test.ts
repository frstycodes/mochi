import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  isMacPlatform,
  isMod,
  isNav,
  orderKeys,
  shortcutText,
} from './keys.ts';

const press = (
  mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }>,
) => ({ metaKey: false, ctrlKey: false, altKey: false, ...mods });

test('mod is Command on macOS and Ctrl elsewhere', () => {
  assert.equal(isMod(press({ metaKey: true }), true), true);
  assert.equal(isMod(press({ ctrlKey: true }), true), false);
  assert.equal(isMod(press({ ctrlKey: true }), false), true);
  assert.equal(isMod(press({ metaKey: true }), false), false);
});

test('nav is Control on macOS and Alt elsewhere, and never fires with mod held', () => {
  assert.equal(isNav(press({ ctrlKey: true }), true), true);
  assert.equal(isNav(press({ ctrlKey: true, metaKey: true }), true), false);
  assert.equal(isNav(press({ altKey: true }), false), true);
  assert.equal(isNav(press({ ctrlKey: true }), false), false);
  assert.equal(isNav(press({ altKey: true, ctrlKey: true }), false), false);
});

test('shortcuts read in each platform order', () => {
  assert.deepEqual(orderKeys(['mod', 'shift', 'S'], true), [
    'shift',
    'mod',
    'S',
  ]);
  assert.equal(shortcutText(['mod', 'shift', 'S'], true), 'Shift Command S');
  assert.equal(shortcutText(['mod', 'shift', 'S'], false), 'Ctrl+Shift+S');
  assert.equal(shortcutText(['nav', '1'], false), 'Alt+1');
});

test('macOS is recognised from both platform strings Chromium reports', () => {
  assert.equal(isMacPlatform('macOS'), true);
  assert.equal(isMacPlatform('MacIntel'), true);
  assert.equal(isMacPlatform('Windows'), false);
  assert.equal(isMacPlatform('Win32'), false);
  assert.equal(isMacPlatform('Linux x86_64'), false);
});
