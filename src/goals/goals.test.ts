import assert from 'node:assert/strict';
import { test } from 'node:test';
import { firstPrompt } from '../model.ts';
import { initialQueue } from '../store/queue.ts';
import type { State } from '../store/index.tsx';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { applyDraft, draftFrom, revisionDiff } from './edit.ts';

const base = () => ({ ...initialThreads(), ...initialQueue(), spaceId: 'latitude', views: {} }) as unknown as State;

test('New thread from a finished goal settles it, keeps its open-PR review queued, creates and opens the new one', () => {
  const s = threadsReducer(base(), { type: 'drift-new-thread', threadId: 'auth', prompt: 'Add dark mode to settings', branchFrom: 'current' });
  const auth = s.threads.find((t) => t.id === 'auth')!;
  const created = s.threads.at(-1)!;
  assert.equal(auth.status, 'settled');
  assert.equal(auth.settledAt, s.now);
  assert.deepEqual(s.queue.filter((q) => q.threadId === 'auth').map((q) => q.kind), ['review']);
  assert.equal(firstPrompt(created), 'Add dark mode to settings');
  assert.equal(created.goal, '', 'the goal is drafted after, never copied');
  assert.equal(created.repo?.project, 'latitude');
  assert.equal(created.activity[0].text, 'Branched off feat/better-auth');
  assert.deepEqual(s.views.latitude, { kind: 'thread', id: created.id });
});

test('New thread from an unfinished goal leaves it running', () => {
  const s = threadsReducer(base(), { type: 'drift-new-thread', threadId: 'rl', prompt: 'Fix the landing page typo', branchFrom: 'base' });
  assert.equal(s.threads.find((t) => t.id === 'rl')!.status, 'running');
  assert.equal(s.threads.at(-1)!.activity[0].text, 'Branched off the base branch');
});

test('scope-add send adds a plan step without a revision; off-goal send only marks the message', () => {
  const scoped = threadsReducer(base(), { type: 'send', threadId: 'rl', text: 'Also return Retry-After', drift: 'scope-add', reason: 'r' }).threads.find((t) => t.id === 'rl')!;
  assert.equal(scoped.revisions.at(-1)!.n, 2, 'a plan step is not a goal revision');
  assert.equal(scoped.steps.at(-1)!.revision, 2);
  assert.equal(scoped.steps.at(-1)!.title, 'Return Retry-After');
  assert.deepEqual(pick(scoped.activity.at(-1)!), { text: 'Plan: +1 step "Return Retry-After"', detail: 'r' });
  const off = threadsReducer(base(), { type: 'send', threadId: 'rl', text: 'Fix the typo', drift: 'off-goal', reason: 'r' }).threads.find((t) => t.id === 'rl')!;
  assert.deepEqual(pick(off.activity.at(-1)!), { text: 'Sent off-goal · not counted', detail: 'r' }, 'a short label, the reason apart');
  assert.equal(off.steps.length, 9);
  assert.equal(off.activity.at(-2)!.drift, 'off-goal');
});

const pick = ({ text, detail }: { text: string; detail?: string }) => ({ text, detail });

test('a goal edit is one revision with a diff per change, and no change makes no revision', () => {
  const rl = initialThreads().threads.find((t) => t.id === 'rl')!;
  assert.equal(applyDraft(rl, draftFrom(rl), 900), rl);
  const draft = draftFrom(rl);
  const [first, ...rest] = draft.steps.filter((s) => !s.isLocked);
  first.size = 3;
  rest[0].isRemoved = true;
  const steps = draft.steps.filter((s) => s !== first);
  steps.push(first, { title: 'Alert on 429 spikes', size: 1, gate: true, isRemoved: false, isLocked: false });
  const next = applyDraft(rl, { goal: 'Rate limit every key', criteria: [], steps }, 900);
  assert.equal(next.revisions.length, 3);
  assert.deepEqual(revisionDiff(next, 3), [
    '~ Goal: "Every public API key is rate limited by plan tier, with per-key overrides and clear 429s." → "Rate limit every key"',
    '− Token bucket middleware',
    '~ Add Redis client: size 2 → 3',
    '+ Alert on 429 spikes',
    '~ Reordered steps',
  ]);
  assert.equal(next.steps.find((s) => s.title === 'Token bucket middleware')!.status, 'dropped');
  assert.equal(next.steps.find((s) => s.id === 'rl3')!.status, 'dropped');
  assert.equal(next.steps.indexOf(next.steps.find((s) => s.id === 'rl3')!), 2);
});

test('a plan-only edit is logged, not versioned; changing criteria is a revision', () => {
  const rl = initialThreads().threads.find((t) => t.id === 'rl')!;
  const draft = draftFrom(rl);
  draft.steps.push({ title: 'Alert on 429 spikes', size: 1, gate: false, isRemoved: false, isLocked: false });
  const planned = applyDraft(rl, draft, 900);
  assert.equal(planned.revisions, rl.revisions);
  assert.equal(planned.steps.at(-1)!.revision, rl.revisions.at(-1)!.n);
  assert.equal(planned.activity.at(-1)!.text, 'Plan: Alert on 429 spikes');

  const again = draftFrom(planned);
  again.steps.at(-1)!.acceptance = { text: 'Alert fires in staging' };
  const revised = applyDraft(planned, again, 901);
  assert.equal(revised.revisions.length, rl.revisions.length + 1);
  assert.deepEqual(revisionDiff(revised, revised.revisions.at(-1)!.n), ['~ Alert on 429 spikes: acceptance criteria set']);
});

test('a gated step pauses the thread and queues an approval instead of starting', () => {
  let s = base();
  s = { ...s, threads: s.threads.map((t) => (t.id === 'adm' ? { ...t, steps: t.steps.map((x) => (x.id === 'ad2' ? { ...x, progress: 0.999 } : x.id === 'ad3' ? { ...x, gate: true } : x)) } : t)) };
  s = threadsReducer(s, { type: 'tick' });
  const adm = s.threads.find((t) => t.id === 'adm')!;
  assert.equal(adm.status, 'needs-you');
  assert.equal(adm.steps.find((x) => x.id === 'ad3')!.status, 'blocked');
  assert.ok(s.queue.some((q) => q.id === 'q-gate-ad3' && q.kind === 'approval'));
});
