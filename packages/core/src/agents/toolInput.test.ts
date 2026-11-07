import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { capInput, STRING_MAX } from './toolInput.ts';

test('long strings are cut at any depth and say how much; everything else is kept', () => {
  const long = 'x'.repeat(STRING_MAX + 5);
  const input = capInput({
    file_path: 'a.ts',
    content: long,
    nested: { edits: [{ old_string: long, count: 2 }] },
  })!;
  const cut = `${'x'.repeat(STRING_MAX)}… (5 more characters)`;
  assert.deepEqual(input, {
    file_path: 'a.ts',
    content: cut,
    nested: { edits: [{ old_string: cut, count: 2 }] },
  });
});

test('arguments that are not an object are not stored', () => {
  assert.equal(capInput('ls'), undefined);
  assert.equal(capInput(null), undefined);
  assert.equal(capInput([1]), undefined);
});
