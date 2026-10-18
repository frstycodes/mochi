import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cloneProject, initProject } from './add.ts';

const scratch = () => realpathSync(mkdtempSync(join(tmpdir(), 'mochi-clone-')));

test('a clone refuses anything that isn’t a git URL before git runs', async () => {
  const dir = scratch();
  for (const url of ['not a url', '--upload-pack=touch /tmp/pwned', 'ext::sh -c touch% /tmp/pwned', 'file:///etc', '/Users/me/repo'])
    await assert.rejects(cloneProject({ url }, dir, undefined, () => {}), /isn’t a git URL Mochi can clone/, url);
  await assert.rejects(cloneProject({ github: 'owner/..' }, dir, undefined, () => {}), /isn’t owner\/repo/);
});

test('a failed clone reports git’s own words and leaves no folder', async () => {
  const dir = scratch();
  const lines: string[] = [];
  await assert.rejects(cloneProject({ url: 'https://127.0.0.1:1/nobody/nothing.git' }, dir, undefined, (l) => lines.push(l)), /fatal: unable to access/);
  assert.ok(lines.length > 0, 'its lines streamed as they came');
  assert.equal(existsSync(join(dir, 'nothing')), false);
});

test('a new project is a git repo in the projects folder, never over an existing one', async () => {
  const dir = scratch();
  const path = await initProject(join(dir, 'dev'), 'fresh');
  assert.ok(existsSync(join(path, '.git')));
  await assert.rejects(initProject(join(dir, 'dev'), 'fresh'), /already exists/);
  await assert.rejects(initProject(dir, '../escape'), /A project name takes/);
});
