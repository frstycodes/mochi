import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { Assumption, Step } from '../model.ts';
import { recordLayout, recordTitle } from './planRecord.ts';

const step = (title: string, status: Step['status'] = 'done'): Step => ({
  id: title,
  title,
  status,
  addedAt: 0,
  addedBy: 'claude',
});

const assumption = (
  id: string,
  state: Assumption['state'],
  step?: number,
): Assumption => ({ id, text: id, turn: 1, state, ...(step && { step }) });

test('decisions and answered assumptions sit on their numbered step; a bad or missing number goes under Not on a step, never the last step', () => {
  const layout = recordLayout(
    {
      steps: [step('Read'), step('Fix'), step('Test', 'ready')],
      decisions: [
        { text: 'On fix', step: 2 },
        { text: 'Past the plan', step: 9 },
        { text: 'A title from an old report', step: 'Test' },
        { text: 'Nowhere' },
      ],
      assumptionIds: ['a1', 'a2', 'a3'],
    },
    [
      assumption('a1', 'accepted', 1),
      assumption('a2', 'open', 2),
      assumption('a3', 'changed'),
    ],
  );
  const on = (n: number) =>
    layout.steps[n - 1].items.map((i) =>
      i.kind === 'decision' ? i.text : i.assumption.id,
    );
  assert.deepEqual([on(1), on(2), on(3)], [['a1'], ['On fix'], []]);
  assert.deepEqual(
    layout.unplaced.map((i) =>
      i.kind === 'decision' ? i.text : i.assumption.id,
    ),
    ['Past the plan', 'A title from an old report', 'Nowhere', 'a3'],
    "the open one is the box's, not the record's",
  );
  assert.equal(
    recordTitle(layout),
    'Plan · 2 of 3 done · 4 decisions · 2 answered',
  );
});
