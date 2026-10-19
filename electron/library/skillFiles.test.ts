import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
import { test } from 'node:test';
import { skillPlacementDir } from '../../src/library/library.ts';
import { removeSkillFolder, writeSkillFolder } from './skillFiles.ts';

test('skills land where the skills CLI puts them, in a temp home', async () => {
  const home = mkdtempSync(join(tmpdir(), 'mochi-skill-home-'));
  const where = { home, claudeDir: join(home, '.claude'), project: join(home, 'proj') };
  // The store normalizes, which turns the '/' joins into '\\' on Windows.
  const placed = (...args: Parameters<typeof skillPlacementDir>) => normalize(skillPlacementDir(...args));
  assert.equal(placed('claude', 'user', 'pdf', where), join(home, '.claude/skills/pdf'));
  assert.equal(placed('codex', 'user', 'pdf', where), join(home, '.agents/skills/pdf'));
  assert.equal(placed('claude', 'project', 'pdf', where), join(home, 'proj/.claude/skills/pdf'));
  assert.equal(placed('codex', 'project', 'pdf', where), join(home, 'proj/.agents/skills/pdf'));

  const dir = placed('claude', 'user', 'pdf', where);
  await writeSkillFolder(dir, { 'SKILL.md': '---\nname: pdf\n---\n', 'scripts/run.sh': '#!/bin/sh\necho hi\n' }, false);
  assert.equal(readFileSync(join(dir, 'SKILL.md'), 'utf8'), '---\nname: pdf\n---\n');
  // Windows has no execute bit to give back.
  if (process.platform !== 'win32') assert.ok(statSync(join(dir, 'scripts/run.sh')).mode & 0o100);
  await writeSkillFolder(dir, { 'SKILL.md': 'v2' }, true);
  assert.ok(!existsSync(join(dir, 'scripts')), 'an update replaces the folder whole');
  await removeSkillFolder(dir);
  assert.ok(!existsSync(dir));
});

test('writeSkillFolder never overwrites a skill Mochi did not write, nor escapes its folder', async () => {
  const home = mkdtempSync(join(tmpdir(), 'mochi-skill-home-'));
  const mine = join(home, 'skills/mine');
  mkdirSync(mine, { recursive: true });
  writeFileSync(join(mine, 'SKILL.md'), 'user wrote this');
  await assert.rejects(writeSkillFolder(mine, { 'SKILL.md': 'x' }, false), /didn't install/);
  assert.equal(readFileSync(join(mine, 'SKILL.md'), 'utf8'), 'user wrote this');
  await assert.rejects(writeSkillFolder(join(home, 'skills/evil'), { '../../escape.md': 'x' }, false), /outside/);
  assert.ok(!existsSync(join(home, 'escape.md')));
});
