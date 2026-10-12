import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSlash, slashMatches } from './slash.ts';

test('parses /side with its question, keeping line breaks', () => {
  assert.deepEqual(parseSlash('/side why Redis?')?.arg, 'why Redis?');
  assert.equal(parseSlash('  /side  first\nsecond ')?.arg, 'first\nsecond');
  assert.equal(parseSlash('/side')?.command.name, 'side');
  assert.equal(parseSlash('/side')?.arg, '');
});

test('leaves plain text and commands Mochi does not own to the agent', () => {
  assert.equal(parseSlash('why /side?'), null);
  assert.equal(parseSlash('/sidebar open'), null);
  assert.equal(parseSlash('/compact'), null);
  assert.equal(parseSlash('/'), null);
});

test('menu lists commands only while the name is being typed', () => {
  assert.deepEqual(slashMatches('/').map((c) => c.name), ['side']);
  assert.deepEqual(slashMatches('/si').map((c) => c.name), ['side']);
  assert.deepEqual(slashMatches('/x'), []);
  assert.deepEqual(slashMatches('/side '), []);
  assert.deepEqual(slashMatches('side'), []);
});
