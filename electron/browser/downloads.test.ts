import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { uniqueName } from './filename.ts';

test('a free name is kept, a taken one gets the next free number before the extension', () => {
  const taken = new Set(['file.pdf', 'file (1).pdf', 'notes']);
  const isTaken = (n: string) => taken.has(n);
  assert.equal(uniqueName('other.pdf', isTaken), 'other.pdf');
  assert.equal(uniqueName('file.pdf', isTaken), 'file (2).pdf');
  assert.equal(uniqueName('notes', isTaken), 'notes (1)');
  assert.equal(uniqueName('.env', (n) => n === '.env'), '.env (1)');
});
