import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { callArgs, callIntent, fenced, resultCode } from './callArgs.ts';

test('short values sit inline; long, multi-line and structured ones fold into a code block', () => {
  const args = callArgs(
    {
      path: 'src/a.ts',
      limit: 40,
      isDry: false,
      body: 'line one\nline two',
      long: 'x'.repeat(81),
      edits: [{ old: 'a', new: 'b' }],
      description: 'Read the config',
      command: 'ls',
    },
    ['command'],
  );
  assert.deepEqual(
    args.map((a) => [a.key, a.kind]),
    [
      ['path', 'inline'],
      ['limit', 'inline'],
      ['isDry', 'inline'],
      ['body', 'block'],
      ['long', 'block'],
      ['edits', 'block'],
    ],
  );
  const edits = args.at(-1)!;
  assert.ok(edits.kind === 'block' && edits.language === 'json');
  assert.equal(edits.preview, '[{"old":"a","new":"b"}]');
  assert.deepEqual(callArgs(undefined), []);
});

test('the intent shows only when the row does not already read as it', () => {
  assert.equal(
    callIntent({ description: 'Run tests' }, 'Run tests'),
    undefined,
  );
  assert.equal(
    callIntent({ description: 'Run tests' }, 'pnpm test'),
    'Run tests',
  );
  assert.equal(callIntent({}, 'x'), undefined);
});

test('a JSON result is pretty-printed; anything else is kept as it came', () => {
  assert.deepEqual(resultCode('{"a":1}'), {
    code: '{\n  "a": 1\n}',
    language: 'json',
  });
  assert.deepEqual(resultCode('{oops'), { code: '{oops', language: 'text' });
  assert.deepEqual(resultCode('done'), { code: 'done', language: 'text' });
});

test('a fence is longer than any backtick run inside it', () => {
  assert.equal(fenced('a', 'json'), '```json\na\n```');
  assert.equal(fenced('x ```` y', 'text'), '`````text\nx ```` y\n`````');
});
