import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { perOption } from './questions.ts';

test('an option field is kept by index when any option has it', () => {
  assert.deepEqual(perOption(['Shared', undefined, ''], 'descriptions'), {
    descriptions: ['Shared', '', ''],
  });
});

test('no option has it: nothing is added', () => {
  assert.deepEqual(perOption(['', ' ', undefined], 'previews'), {});
});
