import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { State } from '../store/index.tsx';
import { initialQueue, queueReducer } from '../store/queue.ts';
import { initialThreads } from '../store/threads.ts';
import { applyAgentEvent } from './apply.ts';

const base = () =>
  ({
    ...initialThreads(),
    ...initialQueue(),
    spaceId: 'latitude',
    views: {},
  }) as unknown as State;

const live = (s: State): State => ({
  ...s,
  threads: s.threads.map((t) =>
    t.id === 'rl'
      ? { ...t, session: { provider: t.providers[0], id: 'sess-1' } }
      : t,
  ),
});

const ask = (s: State) =>
  applyAgentEvent(live(s), {
    threadId: 'rl',
    type: 'question',
    requestId: 'ask-1',
    questions: [
      {
        text: 'Which store?',
        options: ['Redis', 'Postgres'],
        multiSelect: false,
      },
    ],
  });

const cardOf = (s: State) =>
  s.threads
    .find((t) => t.id === 'rl')!
    .activity.find((e) => e.card?.id === 'q-ask-1');

test('a question opens its card in the transcript, where the agent asked', () => {
  const entry = cardOf(ask(base()));
  assert.equal(entry?.text, 'Which store?');
  assert.deepEqual(entry?.card, { id: 'q-ask-1', isOpen: true });
});

test('answering a question closes its card to a record', () => {
  const s = queueReducer(ask(base()), {
    type: 'answer',
    queueId: 'q-ask-1',
    answers: [['Postgres']],
  });
  assert.equal(cardOf(s)?.card?.isOpen, false);
  assert.ok(!s.queue.some((q) => q.id === 'q-ask-1'));
});

test('a question the agent withdraws closes its card too', () => {
  const s = applyAgentEvent(ask(base()), {
    threadId: 'rl',
    type: 'resolved',
    requestId: 'ask-1',
  });
  assert.equal(cardOf(s)?.card?.isOpen, false);
});
