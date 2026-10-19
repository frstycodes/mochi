import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Action, State } from '../store/index.tsx';
import { initialQueue } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { applyAgentEvent } from '../runtime/apply.ts';
import { agentCalls } from '../runtime/live.ts';
import type { ActivityEntry, Thread } from '../model.ts';
import { compactFocus, compactGate, compactInstructions, isCompacting, keptContext, KEEP_CHARS, PIN_CHARS, restoreNote } from './compact.ts';
import { replaceAllPins, type Pin } from './pins.ts';
import { parseSlash } from './slash.ts';

const said = (who: ActivityEntry['who'], text: string): ActivityEntry => ({ at: 0, who, kind: 'message', text });
const thread = (activity: ActivityEntry[], extra: Partial<Thread> = {}) => ({ id: 't', goal: '', activity, ...extra }) as Thread;
const pin = (index: number, text = ''): Pin => ({ id: `${index}:${text}`, index, text });

test('kept context lists the goal and criteria, then pins in transcript order, whole messages or the pinned passage', () => {
  const t = thread([said('you', 'Use Redis for the cache.'), said('claude', 'Done, with a 5 minute TTL.'), said('you', 'Never touch the billing table.')], {
    goal: 'Cache the pricing API',
    criteria: [{ id: 'c1', text: 'p95 under 50ms' }],
  });
  assert.equal(
    keptContext(t, [pin(2), pin(0), pin(1, 'a 5 minute TTL')]),
    ['Goal: Cache the pricing API', '- Done when: p95 under 50ms', '', 'Pinned by the user, each word for word, in this order:', '1. User: Use Redis for the cache.', '2. Claude: a 5 minute TTL', '3. User: Never touch the billing table.'].join('\n'),
  );
  assert.equal(keptContext(thread([said('you', 'hi')]), []), '', 'nothing to keep');
  assert.equal(keptContext(thread([said('you', 'hi')]), [pin(5)]), '', 'a pin past the transcript (rewound) is skipped');
  assert.equal(compactInstructions(''), '');
  assert.match(compactInstructions('Goal: x'), /verbatim[\s\S]*Goal: x$/);
});

test('kept context caps each pin and the whole, naming how many pins were left out', () => {
  const long = 'x'.repeat(PIN_CHARS * 2);
  const one = keptContext(thread([said('you', long)]), [pin(0)]);
  assert.ok(one.includes(`${'x'.repeat(PIN_CHARS - 1)}…`), 'one long pin is clipped');
  const many = Array.from({ length: 10 }, () => said('claude', long));
  const kept = keptContext(thread(many), many.map((_, i) => pin(i)));
  assert.ok(kept.length <= KEEP_CHARS, `${kept.length} chars`);
  const fitted = (kept.match(/^\d+\. /gm) ?? []).length;
  assert.ok(fitted > 0 && fitted < 10);
  assert.ok(kept.endsWith(`(${10 - fitted} more pinned left out for length)`));
});

test('Codex gets what to keep as a note after the compaction, with the focus you typed', () => {
  assert.equal(restoreNote('', ''), '');
  assert.match(restoreNote('Goal: x', 'the auth bug'), /^The conversation was just compacted[\s\S]*Focus from here: the auth bug\n\nGoal: x$/);
});

test('/compact is Mochi’s, with an optional focus', () => {
  assert.equal(parseSlash('/compact')?.command.name, 'compact');
  assert.equal(compactFocus('/compact'), '');
  assert.equal(compactFocus('/compact  keep the API shape '), 'keep the API shape');
  assert.equal(compactFocus('/side why'), null);
  assert.equal(compactFocus('please /compact'), null);
});

const live = (extra: Partial<Thread['live']> = {}, rest: Partial<Thread> = {}) =>
  thread([], { providers: ['claude'], session: { provider: 'claude', id: 's' }, live: { isWorking: false, ...extra }, ...rest } as Partial<Thread>);

test('/compact runs when idle, queues behind a working turn (it can’t steer one), and is off (with why) otherwise', () => {
  assert.deepEqual(compactGate(live()), { kind: 'run' });
  assert.deepEqual(compactGate(live({ isWorking: true })), { kind: 'queue' });
  assert.equal(compactGate(live(), true).kind, 'off', 'waiting on your answer');
  assert.equal(compactGate(live({ isDetached: true })).kind, 'off');
  assert.equal(compactGate(live({ starting: 'claude' })).kind, 'off');
  assert.equal(compactGate(thread([], { providers: ['claude'] } as Partial<Thread>)).kind, 'off', 'a demo thread has no agent');
  const compacting = live({}, { activity: [{ at: 0, who: 'harness', kind: 'event', text: '', compaction: { trigger: 'manual', status: 'running', pins: 0, hasGoal: false } }] });
  assert.equal(isCompacting(compacting), true);
  const gate = compactGate(compacting);
  assert.equal(gate.kind === 'off' && gate.reason, 'Already compacting');
});

const base = () => ({ ...initialThreads(undefined, false), ...initialQueue(), spaceId: 'latitude', views: {} }) as unknown as State;

test('a compaction opens one entry, fills in its sizes and summary, and moves the context ring', () => {
  const create: Action = { type: 'create', title: 'cache it', provider: 'claude', project: null, isLive: true };
  let s = threadsReducer(base(), create);
  const id = s.threads.at(-1)!.id;
  replaceAllPins({ [id]: [pin(0)] });
  s = applyAgentEvent(s, { threadId: id, type: 'session', provider: 'claude', sessionId: 's' });
  s = applyAgentEvent(s, { threadId: id, type: 'turn-end', status: 'done' });

  const compact: Action = { type: 'compact', threadId: id, focus: 'the cache' };
  assert.deepEqual(agentCalls(s, compact, () => threadsReducer(s, compact)), [{ method: 'compact', threadId: id, focus: 'the cache' }]);
  s = threadsReducer(s, compact);
  s = applyAgentEvent(s, { threadId: id, type: 'compaction', phase: 'start' });
  s = applyAgentEvent(s, { threadId: id, type: 'compaction', phase: 'end', trigger: 'manual', preTokens: 182_000, postTokens: 24_000 });
  s = applyAgentEvent(s, { threadId: id, type: 'compaction', phase: 'summary', summary: 'We cached it.' });
  const t = s.threads.find((x) => x.id === id)!;
  const entries = t.activity.filter((e) => e.compaction);
  assert.equal(entries.length, 1, 'the start after /compact reuses its entry');
  assert.deepEqual(entries[0].compaction, { trigger: 'manual', status: 'done', pins: 1, hasGoal: false, focus: 'the cache', preTokens: 182_000, postTokens: 24_000, summary: 'We cached it.' });
  assert.equal(t.context.used, 24_000);
  assert.equal(t.live?.notes, undefined, 'Claude took the instructions; nothing to re-send');
  replaceAllPins({});
});

test('Codex: a compaction leaves the pins as a note for the next message, and a later turn’s usage is not its size', () => {
  let s = threadsReducer(base(), { type: 'create', title: 'x', provider: 'codex', project: null, isLive: true });
  const id = s.threads.at(-1)!.id;
  s = applyAgentEvent(s, { threadId: id, type: 'session', provider: 'codex', sessionId: 's' });
  replaceAllPins({ [id]: [pin(0)] });
  s = applyAgentEvent(s, { threadId: id, type: 'compaction', phase: 'start' });
  s = applyAgentEvent(s, { threadId: id, type: 'compaction', phase: 'end' });
  s = applyAgentEvent(s, { threadId: id, type: 'usage', inputTokens: 1, outputTokens: 1, contextUsed: 9_000 });
  const t = s.threads.find((x) => x.id === id)!;
  assert.equal(t.activity.find((e) => e.compaction)?.compaction?.postTokens, undefined);
  assert.match(t.live?.notes?.[0] ?? '', /^The conversation was just compacted[\s\S]*1\. User: x$/);
  replaceAllPins({});
});

test('a turn that ends with its compaction still open closes it', () => {
  let s = threadsReducer(base(), { type: 'create', title: 'x', provider: 'claude', project: null, isLive: true });
  const id = s.threads.at(-1)!.id;
  s = applyAgentEvent(s, { threadId: id, type: 'session', provider: 'claude', sessionId: 's' });
  s = threadsReducer(s, { type: 'compact', threadId: id, focus: '' });
  s = applyAgentEvent(s, { threadId: id, type: 'turn-end', status: 'failed', error: 'Not enough messages to compact' });
  assert.deepEqual(s.threads.find((x) => x.id === id)!.activity.findLast((e) => e.compaction)?.compaction?.status, 'failed');
});
