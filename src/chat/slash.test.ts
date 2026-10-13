import assert from 'node:assert/strict';
import { test } from 'node:test';
import { argumentSlots, moveToFront, parseSlash, resolveToken, slashItems, slashMatches, slashQueryAt, slotPlaceholder } from './slash.ts';

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
  const names = (text: string) => {
    const range = slashQueryAt(text);
    return range ? slashMatches(range.query, items).map((c) => c.name) : [];
  };
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

test('a / opens the menu mid-message after a space or at a line start, not inside a word or path', () => {
  assert.deepEqual(slashQueryAt('fix this /rev'), { start: 9, end: 13, query: 'rev' });
  assert.deepEqual(slashQueryAt('first line\n/'), { start: 11, end: 12, query: '' });
  assert.deepEqual(slashQueryAt('fix /rev later', 8), { start: 4, end: 8, query: 'rev' });
  assert.equal(slashQueryAt('fix /rev later', 6), null, 'caret inside the word');
  assert.equal(slashQueryAt('and/or'), null);
  assert.equal(slashQueryAt('see /usr/bin'), null);
  assert.equal(slashQueryAt('fix /rev '), null, 'a space closes it');
});

test('picking moves the command to the front and keeps the rest as its arguments', () => {
  const review = items.find((i) => i.name === 'review')!;
  const pick = (text: string, caret = text.length) => moveToFront(text, slashQueryAt(text, caret)!, review, items);
  assert.equal(pick('/re'), '/review ');
  assert.equal(pick('check the auth flow /re'), '/review check the auth flow');
  assert.equal(pick('check /re the auth flow', 9), '/review check the auth flow');
  assert.equal(pick('line one\n/re\nline two', 12), '/review line one\nline two');
  assert.equal(pick('/fix-lint a.ts and /rev'), '/review a.ts and', 'a command already at the start is replaced');
  assert.equal(pick('/re rest', 3), '/review rest', 'editing the leading token keeps its arguments');
  assert.equal(resolveToken(pick('please /re'), items)?.item.name, 'review');
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
