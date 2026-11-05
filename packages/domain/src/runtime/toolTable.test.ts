import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  decodeArgs,
  DEV_TOOL_TABLE,
  jsonSchemaOf,
  servedTools,
  shapeFor,
  TOOL_TABLE,
} from './toolTable.ts';

test('every tool lists its input as a JSON Schema object, descriptions kept, no null for an optional field', () => {
  for (const { shape } of [
    ...Object.values(TOOL_TABLE),
    ...Object.values(DEV_TOOL_TABLE),
  ])
    assert.equal(jsonSchemaOf(shape).type, 'object');
  const properties = jsonSchemaOf(TOOL_TABLE.wrap_up.shape)
    .properties as Record<string, { type?: string; description?: string }>;
  assert.equal(properties.ask.type, 'string');
  assert.match(properties.recap.description ?? '', /not done or not verified/);
});

test('bad args come back as one path: message line per field, for the agent', () => {
  assert.deepEqual(
    decodeArgs(TOOL_TABLE.rename_thread.shape, {
      title: 'Fix the cookie bug',
      extra: 1,
    }),
    { args: { title: 'Fix the cookie bug' } },
  );
  const decoded = decodeArgs(TOOL_TABLE.wrap_up.shape, {
    recap: 'a'.repeat(301),
    decisions: 'x',
  });
  assert.ok('error' in decoded);
  assert.match(decoded.error, /^recap: .*; decisions: /);
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

test('wrap_up asks for assumptions only with the turn spine on, each on a step by number', () => {
  const on = jsonSchemaOf(shapeFor('wrap_up', {}));
  assert.ok('assumptions' in (on.properties as object));
  const off = jsonSchemaOf(shapeFor('wrap_up', { isSpineOff: true }));
  assert.ok(!('assumptions' in (off.properties as object)));
  assert.ok(
    'error' in
      decodeArgs(TOOL_TABLE.wrap_up.shape, {
        recap: 'Done.',
        decisions: [{ text: 'Kept it', step: 'Parse' }],
      }),
    'a step is a number, not a title',
  );
});

test('Codex is served no update_plan: it keeps its plan with its own', () => {
  assert.ok(servedTools({}).includes('update_plan'));
  assert.ok(!servedTools({ isCodex: true }).includes('update_plan'));
  assert.ok(servedTools({ isCodex: true }).includes('wrap_up'));
});
