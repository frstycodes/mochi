import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  decodeArgs,
  DEV_TOOL_TABLE,
  jsonSchemaOf,
  shapeFor,
  TOOL_TABLE,
} from './toolTable.ts';

test('every tool lists its input as a JSON Schema object, descriptions kept, no null for an optional field', () => {
  for (const { shape } of [
    ...Object.values(TOOL_TABLE),
    ...Object.values(DEV_TOOL_TABLE),
  ])
    assert.equal(jsonSchemaOf(shape).type, 'object');
  const properties = jsonSchemaOf(TOOL_TABLE.report_turn.shape)
    .properties as Record<string, { type?: string; description?: string }>;
  assert.equal(properties.question.type, 'string');
  assert.match(properties.left.description ?? '', /still not done/);
});

test('bad args come back as one path: message line per field, for the agent', () => {
  assert.deepEqual(
    decodeArgs(TOOL_TABLE.rename_thread.shape, {
      title: 'Fix the cookie bug',
      extra: 1,
    }),
    { args: { title: 'Fix the cookie bug' } },
  );
  const decoded = decodeArgs(TOOL_TABLE.report_turn.shape, {
    decisions: 'x',
    left: ['a'.repeat(161)],
  });
  assert.ok('error' in decoded);
  assert.match(decoded.error, /^decisions: .*; left\.0: /);
  assert.deepEqual(
    decodeArgs(DEV_TOOL_TABLE.continue_task.shape, {
      threadId: 't',
      text: '  go  ',
    }),
    { args: { threadId: 't', text: 'go' } },
  );
  assert.ok(
    'error' in
      decodeArgs(DEV_TOOL_TABLE.continue_task.shape, {
        threadId: 't',
        text: '   ',
      }),
  );
});

test('the turn spine serves report_turn with required assumptions and update_plan with why; off, neither, and plain decisions', () => {
  const on = jsonSchemaOf(shapeFor('report_turn', {}));
  assert.ok((on.required as string[]).includes('assumptions'));
  assert.ok(
    'why' in (jsonSchemaOf(shapeFor('update_plan', {})).properties as object),
  );
  const off = jsonSchemaOf(shapeFor('report_turn', { isSpineOff: true }));
  assert.ok(!('assumptions' in (off.properties as object)));
  assert.deepEqual(
    (off.properties as Record<string, { items?: unknown }>).decisions.items,
    { type: 'string', maxLength: 160 },
  );
  assert.ok(
    !(
      'why' in
      (jsonSchemaOf(shapeFor('update_plan', { isSpineOff: true }))
        .properties as object)
    ),
  );
  // Decoding takes either: plain strings, and no assumptions from a session started with the spine off.
  assert.ok(
    'args' in
      decodeArgs(TOOL_TABLE.report_turn.shape, {
        decisions: ['Kept it', { text: 'Used X', step: 'Parse' }],
        left: [],
      }),
  );
});
