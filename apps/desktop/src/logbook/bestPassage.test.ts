import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { bestPassage } from './bestPassage.ts';

const blocks = [
  'Fixed the flaky upload test and pushed the change.',
  'Proposal expiry is computed when the card is read: a pending proposal older than a week counts as expired, and nothing is deleted.',
  'Next I will look at the sidebar.',
];

test('picks the block that shares the most words with the summary', () => {
  assert.equal(
    bestPassage(
      blocks,
      'How does proposal expiry work? Computed on read, nothing deleted.',
    ),
    1,
  );
});

test('no block stands out on fewer than two shared words', () => {
  assert.equal(bestPassage(blocks, 'Why two stores for the sidebar?'), -1);
  assert.equal(bestPassage([], 'anything at all'), -1);
});

test('the earliest block wins a tie', () => {
  assert.equal(
    bestPassage(['upload test passes', 'upload test fails'], 'upload test'),
    0,
  );
});
