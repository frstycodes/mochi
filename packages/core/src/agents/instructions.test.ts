import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { mochiInstructions } from './instructions.ts';

test('the turn spine asks for assumptions on report_turn and a why on plan changes; off, the instructions say neither', () => {
  const on = mochiInstructions();
  assert.match(on, /assumptions \(a list of \{text, step\}/);
  assert.match(on, /pass "why"/);
  const off = mochiInstructions({ isSpineOff: true });
  assert.doesNotMatch(off, /assumptions|"why"/);
  assert.match(off, /decisions \(a list: only choices/);
});

test('report_turn sets a bar for decisions and assumptions, on and off', () => {
  for (const isSpineOff of [false, true]) {
    const text = mochiInstructions({ isSpineOff });
    assert.match(text, /never routine execution/);
    assert.match(text, /usually empty/);
  }
});
