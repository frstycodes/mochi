import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ActivityEntry } from '../model.ts';
import { editedLater, isTurnUndone, openTurn, turnChanges } from './turnChanges.ts';

const e = (kind: ActivityEntry['kind'], who: ActivityEntry['who'], text: string, extra: Partial<ActivityEntry> = {}): ActivityEntry => ({ at: 0, who, kind, text, ...extra });
const you = (text: string) => e('message', 'you', text);
const edit = (text: string, patch?: string) => e('tool', 'claude', text, patch ? { patch } : {});

test('a turn runs from your message to your next one and sums each file over its edits, in first-edited order', () => {
  const turns = turnChanges([
    you('add charts'),
    edit('Edit src/b.ts  +3 −1'),
    edit('Write src/a.ts  +10 −0'),
    e('message', 'claude', 'Halfway.'),
    edit('Edit src/b.ts  +2 −2'),
    e('tool', 'claude', 'Run pnpm test'),
    e('tool', 'claude', 'Read src/c.ts'),
    e('message', 'claude', 'Done.'),
    you('thanks'),
    e('message', 'claude', 'Anytime.'),
  ]);
  assert.equal(turns.length, 1, 'a turn without edits has no changes');
  assert.deepEqual(
    turns[0].files.map(({ path, added, removed }) => [path, added, removed]),
    [
      ['src/b.ts', 5, 3],
      ['src/a.ts', 10, 0],
    ],
  );
  assert.deepEqual([turns[0].start, turns[0].end, turns[0].added, turns[0].removed], [0, 7, 15, 3]);
});

test('counts come from the patch when the agent sent one, and each edit keeps its own patch', () => {
  const patch = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,3 @@\n-old\n+new\n+more\n same';
  const [turn] = turnChanges([you('go'), edit('Edit a.ts', patch), edit('Edit a.ts', patch)]);
  assert.deepEqual([turn.files[0].added, turn.files[0].removed, turn.files[0].patches.length], [4, 2, 2]);
});

test("one Codex file change spanning several files splits per file at its diff headers", () => {
  const patch = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1 +1 @@', '-a', '+A', 'diff --git a/src/new.ts b/src/new.ts', '--- /dev/null', '+++ b/src/new.ts', '@@ -0,0 +1,2 @@', '+x', '+y'].join('\n');
  const [turn] = turnChanges([you('go'), e('tool', 'codex', 'Edit src/a.ts, src/new.ts', { patch })]);
  assert.deepEqual(
    turn.files.map(({ path, added, removed }) => [path, added, removed]),
    [
      ['src/a.ts', 1, 1],
      ['src/new.ts', 2, 0],
    ],
  );
  const empty = turnChanges([you('go'), e('tool', 'codex', 'Edit src/a.ts, src/empty.ts', { patch: 'diff --git a/src/empty.ts b/src/empty.ts\n--- /dev/null\n+++ b/src/empty.ts' })]);
  assert.deepEqual(empty[0].files.map((f) => f.path), ['src/empty.ts'], 'a single section still names its own file');
});

test('work before your first message is its own turn; only a turn with nothing of yours after it is open', () => {
  const activity = [edit('Write README.md  +4 −0'), you('more'), edit('Edit README.md  +1 −1'), e('message', 'claude', 'ok')];
  assert.deepEqual(turnChanges(activity).map((t) => t.start), [-1, 1]);
  assert.equal(openTurn(activity)?.start, 1);
  assert.equal(openTurn([...activity, you('next')]), undefined);
});

test('undo scope: files a later turn edited again are named, so undoing the earlier turn asks first', () => {
  const turns = turnChanges([you('one'), edit('Edit a.ts  +1 −0'), edit('Edit b.ts  +1 −0'), you('two'), edit('Edit b.ts  +2 −0'), you('three'), edit('Edit c.ts  +1 −0')]);
  assert.deepEqual(editedLater(turns, turns[0]), ['b.ts']);
  assert.deepEqual(editedLater(turns, turns[1]), [], 'the latest edit of a file is never "later"');
  assert.deepEqual(editedLater(turns, turns[2]), []);
});

test('undo state is the latest undo or redo logged for that turn', () => {
  const undo = (start: number, isUndone: boolean) => e('event', 'harness', 'x', { turnUndo: { start, isUndone } });
  const activity = [you('one'), edit('Edit a.ts  +1 −0'), undo(0, true)];
  assert.equal(isTurnUndone(activity, 0), true);
  assert.equal(isTurnUndone([...activity, undo(0, false)], 0), false);
  assert.equal(isTurnUndone(activity, 3), false);
});

test('a turn that only ran commands is kept, with no files, so its git diff can show what the commands changed', () => {
  const turns = turnChanges([you('format'), e('tool', 'claude', 'Run pnpm fmt'), you('thanks'), e('message', 'claude', 'ok')]);
  assert.deepEqual(turns.map((t) => [t.start, t.files.length, t.ranCommands]), [[0, 0, true]]);
});
