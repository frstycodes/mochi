import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { conflictedPaths } from './conflicts.ts';

const IDENTITY = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_COUNT: '0' };

test('a merge conflict on a path with a space and a newline lists that path verbatim', { skip: process.platform === 'win32' && 'Windows paths cannot hold a newline' }, async () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'mochi-conflicts-')));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, env: { ...process.env, ...IDENTITY }, stdio: 'pipe' }).toString();
  const file = 'a b\nc.txt';
  const commit = (content: string) => {
    writeFileSync(join(dir, file), content);
    git('commit', '-qam', content);
  };
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, file), 'base\n');
  writeFileSync(join(dir, 'plain.txt'), 'base\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  git('checkout', '-qb', 'other');
  commit('other\n');
  git('checkout', '-q', 'main');
  commit('main\n');
  assert.throws(() => git('merge', '--no-edit', 'other'));

  assert.deepEqual(await conflictedPaths(dir), [file]);
});
