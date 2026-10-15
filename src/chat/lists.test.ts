import assert from 'node:assert/strict';
import { test } from 'node:test';
import { continueList } from './lists.ts';

const at = (text: string) => continueList(text, text.length);

test('bullets repeat their marker and indent', () => {
  assert.deepEqual(at('- milk'), { insert: '\n- ' });
  assert.deepEqual(at('intro\n  * eggs'), { insert: '\n  * ' });
  assert.deepEqual(at('+ a'), { insert: '\n+ ' });
});

test('numbers count up and keep their delimiter', () => {
  assert.deepEqual(at('1. first'), { insert: '\n2. ' });
  assert.deepEqual(at('9) ninth'), { insert: '\n10) ' });
});

test('an empty item ends the list', () => {
  assert.deepEqual(at('- a\n- '), { clearFrom: 4 });
  assert.deepEqual(at('- a\n3. '), { clearFrom: 4 });
});

test('the caret line is the one read, not the last line', () => {
  assert.deepEqual(continueList('1. a\nplain', 3), { insert: '\n2. ' });
  assert.equal(continueList('1. a\nplain', 9), null);
});

test('text that only looks like a list is left alone', () => {
  for (const text of ['plain', '-dash', '1.5 apples', '--', '']) assert.equal(at(text), null, text);
});
