import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { ThreadProposal } from '../model.ts';
import { suggestedCount } from './proposals.ts';

const card = (state: ThreadProposal['state'], reason?: string) =>
  ({ state, ...(reason && { reason }) }) as ThreadProposal;

test("the suggestion card's heading counts what it shows, leaving out the agent's withdrawn ones", () => {
  assert.equal(suggestedCount([card('pending')]), '1 suggested thread');
  assert.equal(
    suggestedCount([
      card('pending'),
      card('dismissed'),
      card('dismissed', 'stale'),
    ]),
    '2 suggested threads',
  );
  assert.equal(suggestedCount([]), '0 suggested threads');
});
