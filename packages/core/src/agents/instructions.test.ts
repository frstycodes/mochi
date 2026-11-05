import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { mochiInstructions } from './instructions.ts';

test('the turn spine asks for assumptions on wrap_up; off, the instructions leave them out', () => {
  const on = mochiInstructions();
  assert.match(on, /assumptions \(a list of \{text, step\}/);
  assert.match(on, /mcp__mochi__wrap_up/);
  assert.doesNotMatch(on, /report_turn|\{PLAN\}|\{WRAP_UP\}/);
  const off = mochiInstructions({ isSpineOff: true });
  assert.doesNotMatch(off, /assumptions/);
  assert.match(off, /decisions \(a list of \{text, step\}/);
});

test("Codex is told to keep its plan with its own update_plan, not Mochi's", () => {
  const codex = mochiInstructions({ isCodex: true });
  assert.match(codex, /your own update_plan tool/);
  assert.doesNotMatch(codex, /mcp__mochi__update_plan/);
  assert.match(mochiInstructions(), /mcp__mochi__update_plan/);
});

test('wrap_up sets a bar for decisions and assumptions, on and off', () => {
  for (const isSpineOff of [false, true]) {
    const text = mochiInstructions({ isSpineOff });
    assert.match(text, /never routine execution/);
    assert.match(text, /usually empty/);
  }
});
