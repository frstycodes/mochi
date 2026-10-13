import assert from 'node:assert/strict';
import { test } from 'node:test';
import { outputLines } from './output.ts';

test('command output lines take a tone: failures red, passes green, "fail 0" summaries stay plain', () => {
  const tones = outputLines('✔ add (0.3ms)\nℹ pass 1\nℹ fail 0\n0 failed\nTests  1 failed | 11 passed\nError: boom\n✖ subtract\nexit=0\n\n').map((l) => l.tone);
  assert.deepEqual(tones, ['pass', 'pass', 'plain', 'plain', 'fail', 'fail', 'fail', 'plain']);
  assert.deepEqual(outputLines(''), []);
  assert.deepEqual(outputLines('224 Oct 13 \x1b[;34m.\x1b[m\n\x1b[32m✓\x1b[0m ok'), [
    { text: '224 Oct 13 .', tone: 'plain' },
    { text: '✓ ok', tone: 'pass' },
  ]);
});
