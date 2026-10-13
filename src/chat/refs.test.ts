import assert from 'node:assert/strict';
import test from 'node:test';
import { refDescription, refFromUrl, refLabel, refTone, splitRefs, type RefState } from './refs.ts';

const home = { owner: 'frstycodes', repo: 'mochi' };
const refs = (text: string, slug = home) => splitRefs(text, slug).filter((s) => s.type !== 'text');

test('GitHub PR and issue URLs become refs; other GitHub URLs do not', () => {
  assert.deepEqual(refFromUrl('https://github.com/frstycodes/mochi/pull/45'), { owner: 'frstycodes', repo: 'mochi', number: 45, kind: 'pr' });
  assert.deepEqual(refFromUrl('https://github.com/o/r/issues/7#issuecomment-1'), { owner: 'o', repo: 'r', number: 7, kind: 'issue' });
  assert.deepEqual(refFromUrl('https://github.com/o/r/pull/9/files'), { owner: 'o', repo: 'r', number: 9, kind: 'pr' });
  assert.equal(refFromUrl('https://github.com/o/r/tree/main'), null);
  assert.equal(refFromUrl('https://gitlab.com/o/r/pull/9'), null);
  assert.equal(refFromUrl('https://github.com/o/r/pull/abc'), null);
});

test('owner/repo#n and #n in prose become refs, with the thread repo for bare #n', () => {
  assert.deepEqual(refs('see frstycodes/mochi#45 and other/lib#3.'), [
    { type: 'ref', text: 'frstycodes/mochi#45', ref: { owner: 'frstycodes', repo: 'mochi', number: 45 } },
    { type: 'ref', text: 'other/lib#3', ref: { owner: 'other', repo: 'lib', number: 3 } },
  ]);
  assert.deepEqual(refs('Fixed in #47, follow-up (#48).'), [
    { type: 'ref', text: '#47', ref: { ...home, number: 47 } },
    { type: 'ref', text: '#48', ref: { ...home, number: 48 } },
  ]);
  assert.deepEqual(splitRefs('#12 at the start', null), [{ type: 'text', text: '#12 at the start' }], 'no thread repo: bare #n stays text');
});

test('look-alikes stay text: rankings, C#, anchors, entities, colours', () => {
  for (const text of ['our #1 priority', 'the #2 spot on the list', 'ranked #3 overall', 'written in C#', 'page#3', 'a/b/c#4', '&#123;', 'color #fff', '#12abc', 'item-#5'])
    assert.deepEqual(refs(text), [], text);
  assert.equal(refs('the #10 PR').length, 1, 'a multi-digit bare ref is a ref even after a determiner');
  assert.equal(refs('and #9 was fixed').length, 1, 'a single digit is a ref without a determiner before it');
});

test('file paths in prose, with or without a line, but not URL paths or owner/repo refs', () => {
  assert.deepEqual(refs('edit src/chat/refs.ts:12 then ./README.md'), [
    { type: 'path', text: 'src/chat/refs.ts:12' },
    { type: 'path', text: './README.md' },
  ]);
  assert.deepEqual(refs('open localhost:5173/src/a.ts'), []);
  assert.deepEqual(refs('frstycodes/mochi.js#4').map((s) => s.type), ['ref']);
});

test('the thread repo shows as #n, others as owner/repo#n', () => {
  assert.equal(refLabel({ owner: 'FrstyCodes', repo: 'Mochi', number: 4 }, home), '#4');
  assert.equal(refLabel({ owner: 'o', repo: 'r', number: 4 }, home), 'o/r#4');
  assert.equal(refLabel({ owner: 'o', repo: 'r', number: 4 }, null), 'o/r#4');
});

const pr = (extra: Partial<RefState>): RefState => ({ kind: 'pr', status: 'open', title: 't', url: 'u', hasConflicts: false, isFailing: false, isNotPlanned: false, ...extra });

test('state maps to its semantic colour; unread state is the link colour', () => {
  assert.equal(refTone(pr({})), 'success');
  assert.equal(refTone(pr({ hasConflicts: true })), 'warning');
  assert.equal(refTone(pr({ isFailing: true })), 'success', 'failing checks are a dot, not the colour');
  assert.equal(refTone(pr({ status: 'draft' })), 'muted');
  assert.equal(refTone(pr({ status: 'merged' })), 'merged');
  assert.equal(refTone(pr({ status: 'closed' })), 'destructive');
  assert.equal(refTone(pr({ kind: 'issue' })), 'success');
  assert.equal(refTone(pr({ kind: 'issue', status: 'closed' })), 'merged', 'a completed issue is done, like GitHub');
  assert.equal(refTone(pr({ kind: 'issue', status: 'closed', isNotPlanned: true })), 'muted');
  assert.equal(refTone(null), 'info');
  assert.equal(refTone(undefined), 'info');
});

test('the description names state, conflicts and failing checks', () => {
  const ref = { owner: 'o', repo: 'r', number: 1 };
  assert.equal(refDescription(ref, pr({ hasConflicts: true, isFailing: true })), 'Open pull request, has conflicts, checks failing');
  assert.equal(refDescription(ref, pr({ kind: 'issue', status: 'closed', isNotPlanned: true })), 'Closed as not planned issue');
  assert.equal(refDescription({ ...ref, kind: 'issue' }, null), 'GitHub issue');
});
