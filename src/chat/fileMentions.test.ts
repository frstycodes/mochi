import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { browseEntries, browseQuery, browseTarget, fileMentionFor, mentionTokens, joinPath, mentionTarget, parentDir, rankFiles, relativeTo, serializeMentions, worktreeMention } from './fileMentions.ts';

const ROOT = '/Users/me/dev/harness';

test('a browse query splits into the folder typed so far and the filter after it', () => {
  assert.deepEqual(browseQuery('../oth'), { dir: '../', filter: 'oth' });
  assert.deepEqual(browseQuery('~/dev/'), { dir: '~/dev/', filter: '' });
  assert.deepEqual(browseQuery('/Users/fr'), { dir: '/Users/', filter: 'fr' });
  assert.equal(browseQuery('sid'), null);
  assert.equal(browseQuery('src/a'), null);
  assert.equal(browseQuery('..'), null);
});

test('`..` resolves from the worktree root, `~` and `/` go to the host as typed', () => {
  assert.equal(browseTarget(ROOT, '../'), '/Users/me/dev');
  assert.equal(browseTarget(ROOT, '../../work/x/'), '/Users/me/work/x');
  assert.equal(browseTarget(ROOT, '~/notes/'), '~/notes/');
  assert.equal(browseTarget(ROOT, '/etc/'), '/etc/');
  assert.equal(browseTarget(null, '../'), null);
});

test('paths fold `.` and `..`, and never escape above `/`', () => {
  assert.equal(joinPath('/a/b', '../c/./d'), '/a/c/d');
  assert.equal(joinPath('/a', '../../../x'), '/x');
  assert.equal(joinPath('/a/b', '/etc/hosts'), '/etc/hosts');
  assert.equal(joinPath('.', '../x'), '../x');
});

test('a path escaping the root is outside it; one inside comes back relative', () => {
  assert.equal(relativeTo(ROOT, `${ROOT}/src/a.ts`), 'src/a.ts');
  assert.equal(relativeTo(`${ROOT}/`, `${ROOT}/src/a.ts`), 'src/a.ts');
  assert.equal(relativeTo(ROOT, '/Users/me/dev/harness-other/a.ts'), null);
  assert.equal(relativeTo(ROOT, '/Users/me/dev/a.ts'), null);
});

test('a browsed pick keeps its typed label; the agent gets the absolute path outside the root, relative inside', () => {
  assert.deepEqual(fileMentionFor(ROOT, '../other/', '/Users/me/dev/other', 'x.ts', false), { kind: 'file', id: 'file:/Users/me/dev/other/x.ts', title: '../other/x.ts', path: '/Users/me/dev/other/x.ts', isDir: false });
  assert.equal(fileMentionFor(ROOT, '../harness/', '/Users/me/dev/harness', 'README.md', false).path, 'README.md');
  assert.equal(fileMentionFor(ROOT, '~/', '/Users/me', 'notes', true).title, '~/notes/');
});

test('going up drops the last folder but never the prefix', () => {
  assert.equal(parentDir('../a/b/'), '../a/');
  assert.equal(parentDir('../a/'), '../');
  assert.equal(parentDir('../'), null);
  assert.equal(parentDir('../../'), null);
  assert.equal(parentDir('~/dev/'), '~/');
  assert.equal(parentDir('/Users/'), '/');
  assert.equal(parentDir('/'), null);
});

test('fuzzy ranking puts basename hits first and recent files ahead of equal matches', () => {
  const files = ['src/sidechat/index.ts', 'src/SidePane.tsx', 'src/pane/side/x.ts', 'docs/inside.md'];
  assert.equal(rankFiles(files, 'sid', [], 3)[0], 'src/SidePane.tsx');
  const equal = ['a/Button.tsx', 'b/Button.tsx'];
  assert.deepEqual(rankFiles(equal, 'button', [], 2), ['a/Button.tsx', 'b/Button.tsx']);
  assert.deepEqual(rankFiles(equal, 'button', ['b/Button.tsx'], 2), ['b/Button.tsx', 'a/Button.tsx']);
  assert.deepEqual(rankFiles(files, '', ['docs/inside.md', 'gone.ts'], 2), ['docs/inside.md', 'src/sidechat/index.ts']);
  assert.equal(rankFiles(files, 'zzz', [], 5).length, 0);
});

test('a browsed folder lists folders first, hides dotfiles until the filter asks for them', () => {
  assert.deepEqual(browseEntries(['src', '.git'], ['a.ts', '.env'], '', 10), [
    { name: 'src', isDir: true },
    { name: 'a.ts', isDir: false },
  ]);
  assert.deepEqual(browseEntries(['src', '.git'], ['a.ts', '.env'], '.e', 10), [{ name: '.env', isDir: false }]);
});

test('tokens are whole words and quoted when the label has a space', () => {
  const a = worktreeMention('src/a.ts');
  const spaced = { ...worktreeMention('/x/my notes.md'), title: '~/my notes.md' };
  assert.deepEqual(
    mentionTokens('see @src/a.ts and @"~/my notes.md"', [a, spaced]).map((t) => [t.start, t.end]),
    [
      [4, 13],
      [18, 34],
    ],
  );
  assert.equal(mentionTokens('see @src/a.tsx', [a]).length, 0);
  assert.equal(mentionTokens('mail@src/a.ts', [a]).length, 0);
  const thread = { kind: 'thread' as const, title: 'Fix login' };
  assert.deepEqual(
    mentionTokens('ask @Fix login about @src/a.ts', [a, thread]).map((t) => t.mention.title),
    ['Fix login', 'src/a.ts'],
    'a thread title keeps its spaces, unquoted',
  );
});

test('each harness gets the path in the form it reads', () => {
  const inside = worktreeMention('src/a.ts');
  const outside = fileMentionFor(ROOT, '../other/', '/Users/me/dev/other', 'b c.ts', false);
  const text = 'compare @src/a.ts with @"../other/b c.ts"';
  assert.equal(serializeMentions(text, [inside, outside], 'claude'), 'compare @src/a.ts with @"/Users/me/dev/other/b c.ts"');
  assert.equal(serializeMentions(text, [inside, outside], 'codex'), 'compare src/a.ts with "/Users/me/dev/other/b c.ts"');
  assert.equal(serializeMentions('no tokens @src/b.ts', [inside], 'claude'), 'no tokens @src/b.ts');
  assert.equal(serializeMentions('as in @Fix login', [{ kind: 'thread', title: 'Fix login' }], 'claude'), 'as in "Fix login"', 'a thread is named, not @-mentioned');
});

test('a sent label resolves back to the file it names', () => {
  assert.deepEqual(mentionTarget(ROOT, 'src/a.ts'), { isOutside: false, path: 'src/a.ts' });
  assert.deepEqual(mentionTarget(ROOT, '../other/x.ts'), { isOutside: true, path: '/Users/me/dev/other/x.ts' });
  assert.deepEqual(mentionTarget(ROOT, '"~/my notes.md"'), { isOutside: true, path: '~/my notes.md' });
});
