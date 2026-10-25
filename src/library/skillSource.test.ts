import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { findSkillDirs, parseSkillSource } from './skillSource.ts';

const source = (
  owner: string,
  repo: string,
  extra: Partial<{ ref: string; path: string; skill: string | null }> = {},
) => ({ owner, repo, ref: 'HEAD', path: '', skill: null, ...extra });

test('parseSkillSource reads the forms the skills CLI accepts', () => {
  assert.deepEqual(
    parseSkillSource('vercel-labs/agent-skills'),
    source('vercel-labs', 'agent-skills'),
  );
  assert.deepEqual(
    parseSkillSource(' github:vercel-labs/agent-skills/ '),
    source('vercel-labs', 'agent-skills'),
  );
  assert.deepEqual(
    parseSkillSource('anthropics/skills/skills/pdf'),
    source('anthropics', 'skills', { path: 'skills/pdf' }),
  );
  assert.deepEqual(
    parseSkillSource('vercel-labs/agent-skills@react-best-practices'),
    source('vercel-labs', 'agent-skills', { skill: 'react-best-practices' }),
  );
  assert.deepEqual(
    parseSkillSource('owner/repo#v2@my-skill'),
    source('owner', 'repo', { ref: 'v2', skill: 'my-skill' }),
  );
  assert.deepEqual(parseSkillSource('owner/repo.git'), source('owner', 'repo'));
});

test('parseSkillSource reads github.com repo, tree and blob URLs', () => {
  assert.deepEqual(
    parseSkillSource('https://github.com/anthropics/skills'),
    source('anthropics', 'skills'),
  );
  assert.deepEqual(
    parseSkillSource('https://github.com/anthropics/skills.git'),
    source('anthropics', 'skills'),
  );
  assert.deepEqual(
    parseSkillSource('github.com/anthropics/skills/tree/main'),
    source('anthropics', 'skills', { ref: 'main' }),
  );
  assert.deepEqual(
    parseSkillSource(
      'https://github.com/anthropics/skills/tree/main/skills/pdf',
    ),
    source('anthropics', 'skills', { ref: 'main', path: 'skills/pdf' }),
  );
  assert.deepEqual(
    parseSkillSource(
      'https://github.com/anthropics/skills/blob/main/skills/pdf/SKILL.md',
    ),
    source('anthropics', 'skills', { ref: 'main', path: 'skills/pdf' }),
  );
  assert.deepEqual(
    parseSkillSource('https://github.com/o/r#dev'),
    source('o', 'r', { ref: 'dev' }),
  );
});

test('parseSkillSource refuses what is not a GitHub source', () => {
  for (const bad of [
    '',
    'repo',
    './local/skills',
    '/abs/path',
    'https://gitlab.com/o/r',
    'git@github.com:o/r.git',
    'o/r/../../etc',
    '.hidden/repo',
  ])
    assert.equal(parseSkillSource(bad), null, bad);
});

test('findSkillDirs: a SKILL.md at the path is the one skill', () => {
  assert.deepEqual(
    findSkillDirs(
      [
        'skills/pdf/SKILL.md',
        'skills/pdf/scripts/x.py',
        'skills/pdf/nested/SKILL.md',
      ],
      'skills/pdf',
    ),
    ['skills/pdf'],
  );
  assert.deepEqual(findSkillDirs(['SKILL.md', 'other/SKILL.md'], ''), ['']);
});

test('findSkillDirs follows the CLI containers and depths', () => {
  const tree = [
    'README.md',
    'top/SKILL.md', // depth 1 under the root
    'examples/deep/SKILL.md', // depth 2 under the root: not a container, skipped while containers find skills
    'skills/a/SKILL.md',
    'skills/a/inner/SKILL.md', // below a found skill
    'skills/cat/sub/b/SKILL.md', // depth 3 inside skills/
    'skills/cat/sub/deeper/c/SKILL.md', // depth 4: too deep
    'skills/node_modules/x/SKILL.md', // through a skipped folder
    'skills/.curated/d/SKILL.md',
    '.claude/skills/e/SKILL.md',
  ];
  assert.deepEqual(findSkillDirs(tree, ''), [
    'top',
    'skills/.curated/d',
    'skills/a',
    'skills/cat/sub/b',
    '.claude/skills/e',
  ]);
});

test('findSkillDirs falls back to any depth up to five when containers hold none', () => {
  const tree = [
    'docs/examples/one/SKILL.md',
    'a/b/c/d/e/SKILL.md',
    'a/b/c/d/e/f/SKILL.md',
    'node_modules/pkg/SKILL.md',
  ];
  assert.deepEqual(findSkillDirs(tree, ''), ['a/b/c/d/e', 'docs/examples/one']);
  assert.deepEqual(
    findSkillDirs(['plugins/p/skills/s/SKILL.md'], 'plugins/p'),
    ['plugins/p/skills/s'],
  );
  assert.deepEqual(findSkillDirs(['README.md'], ''), []);
});
