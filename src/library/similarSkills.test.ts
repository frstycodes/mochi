import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { isSimilarName } from './similarSkills.ts';
import { isInternalSkill } from './skillMd.ts';

test('isSimilarName matches the same words minus filler, or a long enough name inside another', () => {
  assert.equal(isSimilarName('ui-skill', 'UI'), true);
  assert.equal(isSimilarName('animate', 'animate-expo'), true);
  assert.equal(isSimilarName('frontend-design', 'design_frontend'), true);
  assert.equal(
    isSimilarName('ui', 'ui-design'),
    false,
    'one short word is too weak',
  );
  assert.equal(isSimilarName('animate', 'review-animations'), false);
  assert.equal(isSimilarName('skill', 'skills'), false, 'filler only');
});

test('isInternalSkill reads metadata.internal from the frontmatter only', () => {
  assert.equal(
    isInternalSkill(
      '---\nname: a\nmetadata:\n  author: x\n  internal: true\n---\nbody',
    ),
    true,
  );
  assert.equal(
    isInternalSkill('---\nname: a\nmetadata:\n  internal: false\n---\n'),
    false,
  );
  assert.equal(
    isInternalSkill('---\nname: a\n---\nmetadata:\n  internal: true\n'),
    false,
    'body, not frontmatter',
  );
  assert.equal(
    isInternalSkill(
      '---\nmetadata:\n  a: 1\nother: x\n  internal: true\n---\n',
    ),
    false,
    'under another key',
  );
});
