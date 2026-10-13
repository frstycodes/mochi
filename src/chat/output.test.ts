import assert from 'node:assert/strict';
import { test } from 'node:test';
import { outputLines } from './output.ts';

test('command output lines take a tone: failures red, passes green, "fail 0" summaries stay plain', () => {
  const tones = outputLines('✔ add (0.3ms)\nℹ pass 1\nℹ fail 0\n0 failed\nTests  1 failed | 11 passed\nError: boom\n✖ subtract\nexit=0\n\n').map((l) => l.tone);
  assert.deepEqual(tones, ['pass', 'pass', 'plain', 'plain', 'fail', 'fail', 'fail', 'plain']);
  assert.deepEqual(outputLines(''), []);
});
