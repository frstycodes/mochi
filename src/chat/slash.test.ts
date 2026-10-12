import assert from 'node:assert/strict';
import { test } from 'node:test';
import { argumentSlots, parseSlash, resolveToken, slashItems, slashMatches, slotPlaceholder } from './slash.ts';

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

const items = slashItems(
  [
    { name: 'fix-lint', description: 'Fix lint', argumentHint: '<file> [--fix]' },
    { name: 'review', description: 'Review the diff' },
    { name: 'frontend-design:audit', description: 'Audit a page' },
    { name: 'side', description: 'Shadowed by Mochi' },
  ],
  'claude',
);

test('lists Mochi commands first and leaves a shared name to Mochi', () => {
  assert.deepEqual(
    items.map((i) => `${i.source}:${i.name}`),
    ['mochi:side', 'claude:fix-lint', 'claude:review', 'claude:frontend-design:audit'],
  );
});

test('menu filters while the name is typed: prefix, then substring, then in-order letters', () => {
  const names = (text: string) => slashMatches(text, items).map((c) => c.name);
  assert.deepEqual(names('/'), ['side', 'fix-lint', 'review', 'frontend-design:audit']);
  assert.deepEqual(names('/si'), ['side', 'frontend-design:audit']);
  assert.deepEqual(names('/fi'), ['fix-lint', 'frontend-design:audit']);
  assert.deepEqual(names('/lint'), ['fix-lint']);
  assert.deepEqual(names('/fda'), ['frontend-design:audit']);
  assert.deepEqual(names('/re'), ['review', 'frontend-design:audit']);
  assert.deepEqual(names('/zq'), []);
  assert.deepEqual(names('/side '), []);
  assert.deepEqual(names('side'), []);
});

test('resolves only an exact known name at the very start', () => {
  assert.equal(resolveToken('/fix-lint', items)?.item.name, 'fix-lint');
  const token = resolveToken('/fix-lint a.ts', items);
  assert.deepEqual(token && { end: token.end, rest: token.rest }, { end: 9, rest: ' a.ts' });
  assert.equal(resolveToken('/fix-lint\nmore', items)?.rest, '\nmore');
  assert.equal(resolveToken('/fix', items), null);
  assert.equal(resolveToken('/fix-lints', items), null);
  assert.equal(resolveToken('/foo bar', items), null);
  assert.equal(resolveToken(' /fix-lint', items), null);
  assert.equal(resolveToken('run /fix-lint', items), null);
});

test('argument hints split into slots, brackets keeping their spaces', () => {
  assert.deepEqual(argumentSlots('<file> [--fix]'), ['<file>', '[--fix]']);
  assert.deepEqual(argumentSlots('[message to send] <n>'), ['[message to send]', '<n>']);
  assert.deepEqual(argumentSlots('ARGS'), ['ARGS']);
  assert.deepEqual(argumentSlots(undefined), []);
});

test('slots disappear one by one as each argument is started', () => {
  const hint = '<file> [--fix]';
  assert.equal(slotPlaceholder('', hint), ' <file> [--fix]');
  assert.equal(slotPlaceholder(' ', hint), '<file> [--fix]');
  assert.equal(slotPlaceholder(' a', hint), ' [--fix]');
  assert.equal(slotPlaceholder(' a.ts ', hint), '[--fix]');
  assert.equal(slotPlaceholder(' a.ts -', hint), '');
  assert.equal(slotPlaceholder(' a.ts --fix extra', hint), '');
  assert.equal(slotPlaceholder(' a.ts\n', hint), '');
  assert.equal(slotPlaceholder(' ', undefined), '');
});
