import { assert, test } from 'vite-plus/test';
import { rankShorterFirst } from './rank';

test('a shared prefix ranks the shorter title first; a miss stays 0', () => {
  assert.isAbove(
    rankShorterFirst('Settings', 'set', ['preferences']),
    rankShorterFirst('Settled threads', 'set', ['archive']),
  );
  assert.equal(rankShorterFirst('Queue', 'set'), 0);
});

test('keyword-only matches stay below title matches', () => {
  assert.isAbove(
    rankShorterFirst('Settings', 'set'),
    rankShorterFirst('Usage', 'set', ['settings']),
  );
});
