import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { mochiInstructions } from './instructions.ts';

test('the turn spine asks for assumptions on report_turn and a why on plan changes; off, the instructions say neither', () => {
  const on = mochiInstructions({ isGoalsOff: true });
  assert.match(on, /assumptions \(a list of \{text, step\}/);
  assert.match(on, /pass "why"/);
  const off = mochiInstructions({ isGoalsOff: true, isSpineOff: true });
  assert.doesNotMatch(off, /assumptions|"why"/);
  assert.match(off, /decisions \(a list\)/);
});
