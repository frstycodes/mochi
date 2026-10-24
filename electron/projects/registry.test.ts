import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readDoc } from '@mochi/core/store/client';
import { projectRegistry } from './registry.ts';

function scratch() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mochi-projects-')));
  const repo = join(dir, 'mochi');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:frstycodes/Mochi.git'], { cwd: repo });
  const plain = join(dir, 'notes');
  mkdirSync(plain);
  return { dir, repo, plain, icons: join(dir, 'userData', 'project-icons') };
}

test('migrate takes a profile’s recents and thread folders in once, skipping duplicates, names and missing folders', async () => {
  const { dir, repo, plain, icons } = scratch();
  const registry = projectRegistry(icons, dir);
  const first = await registry.migrate('personal', [repo, `${repo}/`, plain, 'fixture-name', join(dir, 'gone')]);
  assert.deepEqual(
    first.map((p) => [p.name, p.path, p.origin, p.isMissing]),
    [
      ['mochi', repo, 'github.com/frstycodes/Mochi', false],
      ['notes', plain, null, false],
    ],
  );
  await registry.remove('personal', first[1].id);
  assert.equal((await registry.migrate('personal', [plain])).length, 1, 'a second migrate only lists: a removed folder stays removed');
  assert.deepEqual(await registry.migrate('work', []), [], 'each profile has its own list');

  const reloaded = projectRegistry(icons, dir);
  assert.deepEqual((await reloaded.list('personal')).map((p) => p.id), [first[0].id], 'saved');
  assert.equal((await readDoc<{ spaces: Record<string, { isMigrated: boolean }> }>('projects', dir))!.spaces.personal!.isMigrated, true);
});

test('add returns a listed folder as it is; rename, relocate and remove change only the list', async () => {
  const { dir, repo, plain, icons } = scratch();
  const registry = projectRegistry(icons, dir);
  const added = await registry.add('p', repo);
  assert.equal((await registry.add('p', repo)).id, added.id);
  await assert.rejects(registry.add('p', 'relative/path'), /isn’t a full path/);
  await assert.rejects(registry.add('p', join(dir, 'nope')), /isn’t a folder/);

  await registry.rename('p', added.id, 'Mochi app');
  const moved = join(dir, 'moved');
  renameSync(repo, moved);
  assert.equal((await registry.list('p'))[0].isMissing, true, 'a moved folder shows as missing');
  await assert.rejects(registry.relocate('p', added.id, plain), /is not a clone, not github.com\/frstycodes\/Mochi/, 'relocating onto another repo is refused');
  const relocated = await registry.relocate('p', added.id, moved);
  assert.deepEqual([relocated.name, relocated.path, relocated.isMissing], ['Mochi app', moved, false]);

  await registry.remove('p', added.id);
  assert.deepEqual(await registry.list('p'), []);
  assert.ok(readFileSync(join(moved, '.git', 'HEAD')), 'removing never touches the folder');
});

test('a project shows the favicon its folder has, or the image you upload, or its letter', async () => {
  const { dir, repo, icons } = scratch();
  const registry = projectRegistry(icons, dir);
  const added = await registry.add('p', repo);
  assert.equal(added.icon, null, 'no favicon anywhere: the letter');
  mkdirSync(join(repo, 'public'));
  writeFileSync(join(repo, 'public', 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const [found] = await registry.list('p');
  assert.deepEqual([found.iconMode, found.icon?.source, found.icon?.file], ['auto', 'favicon', 'public/favicon.svg']);
  assert.match(found.icon!.url, /^data:image\/svg\+xml;base64,/);

  const png = `data:image/png;base64,${Buffer.from('not really a png').toString('base64')}`;
  const custom = await registry.setIcon('p', added.id, png);
  assert.deepEqual([custom.iconMode, custom.icon?.source, custom.icon?.url], ['custom', 'custom', png]);
  assert.ok(existsSync(join(dir, 'userData', 'project-icons', `${added.id}.png`)), 'kept in userData, never in the project');
  await assert.rejects(registry.setIcon('p', added.id, 'data:text/html;base64,PGgxPg=='), /must be an SVG, PNG/);
  await assert.rejects(registry.setIcon('p', added.id, `data:image/png;base64,${Buffer.alloc(600 * 1024).toString('base64')}`), /up to 512 KB/);

  assert.equal((await registry.setIcon('p', added.id, 'none')).icon, null, 'the letter on purpose');
  assert.equal(existsSync(join(dir, 'userData', 'project-icons', `${added.id}.png`)), false, 'the upload goes with it');
  assert.equal((await registry.setIcon('p', added.id, 'auto')).icon?.file, 'public/favicon.svg');
});
