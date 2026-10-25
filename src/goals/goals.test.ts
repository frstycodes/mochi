import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { firstPrompt } from '../model.ts';
import { initialQueue } from '../store/queue.ts';
import type { State } from '../store/index.tsx';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { applyDraft, draftFrom, revisionDiff } from './edit.ts';
import { setPrefs } from '../settings/prefs.ts';

// Goals are retired and default off; their code is kept, so these tests turn them on to keep it honest.
setPrefs({ goals: true });

const base = () =>
  ({
    ...initialThreads(),
    ...initialQueue(),
    spaceId: 'latitude',
    views: {},
  }) as unknown as State;

test('New thread from a finished goal settles it, keeps its open-PR review queued, creates the new one', () => {
  const s = threadsReducer(base(), {
    type: 'drift-new-thread',
    threadId: 'auth',
    prompt: 'Add dark mode to settings',
    branchFrom: 'current',
  });
  const auth = s.threads.find((t) => t.id === 'auth')!;
  const created = s.threads.at(-1)!;
  assert.equal(auth.status, 'settled');
  assert.equal(auth.settledAt, s.now);
  assert.deepEqual(
    s.queue.filter((q) => q.threadId === 'auth').map((q) => q.kind),
    ['review'],
  );
  assert.equal(firstPrompt(created), 'Add dark mode to settings');
  assert.equal(created.goal, '', 'the goal is drafted after, never copied');
  assert.equal(created.repo?.project, 'latitude');
  assert.equal(created.activity[0].text, 'Branched off feat/better-auth');
});

test('New thread from an unfinished goal leaves it running', () => {
  const s = threadsReducer(base(), {
    type: 'drift-new-thread',
    threadId: 'rl',
    prompt: 'Fix the landing page typo',
    branchFrom: 'base',
  });
  assert.equal(s.threads.find((t) => t.id === 'rl')!.status, 'running');
  assert.equal(
    s.threads.at(-1)!.activity[0].text,
    'Branched off the base branch',
  );
});

test('a message that widens the goal adds no step, the agent plans it; off-goal only marks the message', () => {
  const rl = base().threads.find((t) => t.id === 'rl')!;
  const scoped = threadsReducer(base(), {
    type: 'send',
    threadId: 'rl',
    text: 'Also return Retry-After',
    drift: 'scope-add',
    reason: 'r',
  }).threads.find((t) => t.id === 'rl')!;
  assert.equal(scoped.steps.length, rl.steps.length);
  assert.equal(scoped.activity.at(-1)!.drift, 'scope-add');
  const off = threadsReducer(base(), {
    type: 'send',
    threadId: 'rl',
    text: 'Fix the typo',
    drift: 'off-goal',
    reason: 'r',
  }).threads.find((t) => t.id === 'rl')!;
  assert.deepEqual(
    pick(off.activity.at(-1)!),
    { text: 'Sent off-goal · not counted', detail: 'r' },
    'a short label, the reason apart',
  );
  assert.equal(off.activity.at(-2)!.drift, 'off-goal');
});

const pick = ({ text, detail }: { text: string; detail?: string }) => ({
  text,
  detail,
});

test("a goal edit is one revision with a diff per change, no change makes none, and the agent's plan isn't part of it", () => {
  const rl = initialThreads().threads.find((t) => t.id === 'rl')!;
  assert.equal(applyDraft(rl, draftFrom(rl), 900), rl);
  const next = applyDraft(
    rl,
    {
      goal: 'Rate limit every key',
      criteria: [
        { text: 'Every 429 carries Retry-After', command: 'pnpm test' },
      ],
    },
    900,
  );
  assert.equal(next.revisions.length, rl.revisions.length + 1);
  assert.deepEqual(revisionDiff(next, next.revisions.at(-1)!.n), [
    '~ Goal: "Every public API key is rate limited by plan tier, with per-key overrides and clear 429s." → "Rate limit every key"',
    '+ Done when: Every 429 carries Retry-After',
  ]);
  assert.equal(next.steps, rl.steps);
});
