import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as pkg from './index.ts';

test('@mochi/schema loads', () => {
  assert.deepEqual(Object.keys(pkg), []);
});
