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

test('subagent guidance defaults to native tools and model choice while preserving explicit requests', () => {
  for (const isCodex of [false, true]) {
    for (const isSubThread of [false, true]) {
      const text = mochiInstructions({ isCodex, isSubThread });
      assert.match(
        text,
        /default to your native same-provider subagent tool and its native model choice/,
      );
      assert.match(text, /Preserve explicit user provider\/model requests/);
      assert.match(
        text,
        /mcp__mochi__start_subagent, not create_thread, when the requested provider\/model is unavailable through your native tool/,
      );
      assert.match(
        text,
        /Cross-provider delegation requires an explicit user provider\/model request or that concrete capability requirement/,
      );
      assert.match(
        text,
        /do not choose another provider merely for task size, cost, or a preferred model tier/,
      );
    }
  }
});
