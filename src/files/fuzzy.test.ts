import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { slashItems, slashMatches } from '../chat/slash.ts';
import { fuzzyMatch, fuzzyMatches } from './fuzzy.ts';

test('one matcher preserves slash rank tiers and stable ties, plus file basename and boundary bonuses', () => {
  const names = ['r-e-v', 'preview', 'review-long', 'review', 'other'];
  const items = slashItems(names.map((name) => ({ name, description: '' })), 'claude').filter((item) => item.source === 'claude');
  assert.deepEqual(slashMatches('REV', items).map((item) => item.name), ['review-long', 'review', 'preview', 'r-e-v']);
  assert.deepEqual(slashMatches('', items), items);
  assert.equal(fuzzyMatch('other', 'rev'), null);
  assert.deepEqual(fuzzyMatches(['f/oo/bar.ts', 'src/FooBar.ts'], 'f b').map((match) => match.file), ['src/FooBar.ts', 'f/oo/bar.ts']);
  assert.ok(fuzzyMatch('FooBar.ts', 'fb')!.score > fuzzyMatch('foobar.ts', 'fb')!.score);
  assert.deepEqual(fuzzyMatch('src/FooBar.ts', 'FB')!.indices, [4, 7]);
});
