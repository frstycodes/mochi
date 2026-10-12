import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseDiff, parseGhAuthStatus, parseStatus, parseWorktrees } from './parse.ts';

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,3 @@',
  ' one',
  '-two',
  '+TWO',
  ' three',
  '@@ -10,2 +10,3 @@ function f() {',
  ' ten',
  '+ten and a half',
  ' eleven',
  '\\ No newline at end of file',
  'diff --git a/new file.md b/new file.md',
  'new file mode 100644',
  'index 0000000..3333333',
  '--- /dev/null',
  '+++ b/new file.md\t',
  '@@ -0,0 +1 @@',
  '+hello',
  'diff --git a/gone.txt b/gone.txt',
  'deleted file mode 100644',
  '--- a/gone.txt',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-bye',
  'diff --git a/old.ts b/moved.ts',
  'similarity index 100%',
  'rename from old.ts',
  'rename to moved.ts',
  'diff --git a/logo.png b/logo.png',
  'index 4444444..5555555 100644',
  'Binary files a/logo.png and b/logo.png differ',
  '',
].join('\n');

test('parseDiff splits files and hunks with counts, kinds and paths', () => {
  const files = parseDiff(DIFF, false);
  assert.deepEqual(
    files.map((f) => [f.path, f.kind, f.added, f.removed, f.hunks.length, f.binary, f.oldPath]),
    [
      ['src/a.ts', 'modified', 2, 1, 2, false, undefined],
      ['new file.md', 'added', 1, 0, 1, false, undefined],
      ['gone.txt', 'deleted', 0, 1, 1, false, undefined],
      ['moved.ts', 'renamed', 0, 0, 0, false, 'old.ts'],
      ['logo.png', 'modified', 0, 0, 0, true, undefined],
    ],
  );
  const second = files[0].hunks[1];
  assert.equal(second.header, '@@ -10,2 +10,3 @@ function f() {');
  assert.ok(second.patch.startsWith('diff --git a/src/a.ts b/src/a.ts\nindex'), 'hunk patch carries the file header');
  assert.ok(second.patch.endsWith('\\ No newline at end of file\n'));
  assert.ok(!second.patch.includes('-two'), 'hunk patch holds only its own hunk');
});

test('parseDiff reads C-quoted paths', () => {
  const [file] = parseDiff('diff --git "a/say \\"hi\\".txt" "b/say \\"hi\\".txt"\nnew file mode 100644\n', true);
  assert.equal(file.path, 'say "hi".txt');
  assert.equal(file.staged, true);
});

test('a hunk patch applies to the index on its own', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-parse-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' });
  try {
    git('init', '-q');
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    writeFileSync(join(dir, 'f.txt'), `${lines.join('\n')}\n`);
    git('add', '.');
    git('commit', '-qm', 'init');
    lines[1] = 'first change';
    lines[25] = 'second change';
    writeFileSync(join(dir, 'f.txt'), `${lines.join('\n')}\n`);
    const [file] = parseDiff(git('diff'), false);
    assert.equal(file.hunks.length, 2);
    execFileSync('git', ['-C', dir, 'apply', '--cached'], { input: file.hunks[1].patch });
    assert.match(git('diff', '--cached'), /\+second change/);
    assert.doesNotMatch(git('diff', '--cached'), /first change/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseStatus reads porcelain v1 -z including renames', () => {
  const text = [' M src/a.ts', 'A  src/b.ts', 'R  new.ts', 'old.ts', ' D gone.ts', '?? notes.md', ''].join('\0');
  assert.deepEqual(parseStatus(text), [
    { path: 'src/a.ts', status: 'modified' },
    { path: 'src/b.ts', status: 'added' },
    { path: 'new.ts', status: 'modified' },
    { path: 'gone.ts', status: 'deleted' },
    { path: 'notes.md', status: 'untracked' },
  ]);
});

test('parseWorktrees reads branches and detached heads', () => {
  const text = ['worktree /repo', 'HEAD abc', 'branch refs/heads/main', '', 'worktree /wt/one', 'HEAD def', 'detached', ''].join('\n');
  assert.deepEqual(parseWorktrees(text), [
    { path: '/repo', head: 'abc', branch: 'main' },
    { path: '/wt/one', head: 'def', branch: null },
  ]);
});

test('parseGhAuthStatus reads every host\'s logins, which one is active and which still work', () => {
  // Shape of gh 2.78's stderr, tokens masked the way gh prints them.
  const text = `github.com
  ✓ Logged in to github.com account octo (keyring)
  - Active account: false
  - Token: gho_************************************

  X Failed to log in to github.com account stale_user (keyring)
  - Active account: false
  - The token in keyring is invalid.

  ✓ Logged in to github.com account work-bot (keyring)
  - Active account: true

ghe.example.com
  ✓ Logged in to ghe.example.com account enterprise (keyring)
  - Active account: true
`;
  assert.deepEqual(parseGhAuthStatus(text), [
    { host: 'github.com', login: 'octo', isActive: false, isValid: true },
    { host: 'github.com', login: 'stale_user', isActive: false, isValid: false },
    { host: 'github.com', login: 'work-bot', isActive: true, isValid: true },
    { host: 'ghe.example.com', login: 'enterprise', isActive: true, isValid: true },
  ]);
  assert.deepEqual(parseGhAuthStatus('You are not logged into any GitHub hosts. To log in, run: gh auth login'), []);
});
