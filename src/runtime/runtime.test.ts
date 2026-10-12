import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentEvent, AgentPlanItem } from '../host/types/agent.ts';
import { NOW0 } from '../model.ts';
import type { State } from '../store/index.tsx';
import { initialQueue, queueReducer } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { applyAgentEvent, resolution } from './apply.ts';
import { SCRIPT } from './demo.ts';

const base = () => ({ ...initialThreads(), ...initialQueue(), spaceId: 'latitude', views: {} }) as unknown as State;
const thread = (s: State, id: string) => s.threads.find((t) => t.id === id)!;
const titles = (s: State, id: string) => thread(s, id).steps.map((x) => x.title);
const tick = (s: State, n = 1) => {
  for (let i = 0; i < n; i++) s = threadsReducer(s, { type: 'tick' });
  return s;
};
const live = (s: State, id: string): State => ({ ...s, threads: s.threads.map((t) => (t.id === id ? { ...t, session: { provider: t.providers[0], id: 'sess-1' } } : t)) });

test('a plan matches steps by title, starts and completes them, and keeps provided-by links resolving', () => {
  let s = base();
  const linked = { mode: 'provided-by' as const, threadId: 'rl', stepId: 'rl5' };
  s = { ...s, threads: s.threads.map((t) => (t.id === 'adm' ? { ...t, steps: t.steps.map((x) => (x.id === 'ad4' ? { ...x, status: 'waiting' as const, link: linked } : x)) } : t)) };
  const items = titles(s, 'rl').filter((_, i) => i !== 2).map((title): AgentPlanItem => ({ title, status: 'pending' }));
  items[3] = { title: 'add a redis client', status: 'done' };
  items[4] = { title: 'Token bucket middleware', status: 'running' };
  s = applyAgentEvent(s, { threadId: 'rl', type: 'plan', items });
  const rl = thread(s, 'rl');
  assert.equal(rl.steps.find((x) => x.id === 'rl5')!.status, 'done', 'fuzzy title still matches');
  assert.equal(rl.steps.find((x) => x.id === 'rl6')!.status, 'running');
  assert.equal(rl.steps.length, 9, 'no scope added');
  assert.equal(thread(s, 'adm').steps.find((x) => x.id === 'ad4')!.status, 'done', 'provided-by link resolved through completeStep');
});

test('an unknown plan item lands through the scope-add revision flow, after the item it follows', () => {
  let s = base();
  const items = titles(s, 'adm').map((title) => ({ title, status: 'pending' as const }));
  items.splice(1, 0, { title: 'Index api_usage_daily by key', status: 'pending' as const });
  s = applyAgentEvent(s, { threadId: 'adm', type: 'plan', items });
  const adm = thread(s, 'adm');
  const added = adm.steps[1];
  assert.equal(added.title, 'Index api_usage_daily by key');
  assert.deepEqual([added.addedBy, added.size, added.status, added.revision], ['codex', 2, 'ready', adm.revisions.length]);
  assert.equal(adm.revisions.at(-1)!.by, 'codex');
  assert.equal(adm.activity.at(-1)!.text, `Goal v${adm.revisions.length}: +1 step`);
});

test('a step the agent drops is marked dropped; steps you added stay', () => {
  let s = base();
  const items = titles(s, 'rl')
    .filter((title) => title !== 'Load test at 2k req/s' && title !== 'Per-key overrides')
    .map((title) => ({ title, status: 'pending' as const }));
  s = applyAgentEvent(s, { threadId: 'rl', type: 'plan', items });
  const rl = thread(s, 'rl');
  const rl8 = rl.steps.find((x) => x.id === 'rl8')!;
  assert.equal(rl8.status, 'dropped');
  assert.equal(rl8.note, 'Dropped by Claude');
  assert.equal(rl.steps.find((x) => x.id === 'rl7')!.status, 'ready', 'your step is canonical');
});

test('an approval goes to the queue, blocks the running step, and its answer resolves back to the agent', () => {
  let s = live(base(), 'rl');
  const approval: AgentEvent = { threadId: 'rl', type: 'approval', requestId: 'tool-7', kind: 'command', title: 'Run pnpm db:migrate', detail: 'Applies 2 migrations', code: 'pnpm db:migrate' };
  s = applyAgentEvent(s, approval);
  const item = s.queue.find((q) => q.requestId === 'tool-7')!;
  assert.equal(item.kind, 'approval');
  assert.equal(thread(s, 'rl').status, 'needs-you');
  assert.equal(thread(s, 'rl').steps.find((x) => x.id === 'rl5')!.status, 'blocked');
  assert.equal(applyAgentEvent(s, approval).queue.length, s.queue.length, 'a repeated request is not queued twice');

  const answer = { type: 'answer' as const, queueId: item.id };
  assert.deepEqual(resolution(s, answer), { requestId: 'tool-7', decision: { kind: 'allow' } });
  s = queueReducer(s, answer);
  assert.ok(!s.queue.some((q) => q.id === item.id));
  assert.equal(thread(s, 'rl').steps.find((x) => x.id === 'rl5')!.status, 'running');
});

test('a request the agent withdraws leaves the queue and unblocks the step', () => {
  let s = live(base(), 'rl');
  s = applyAgentEvent(s, { threadId: 'rl', type: 'approval', requestId: 'tool-8', kind: 'command', title: 'Run it', detail: '' });
  s = applyAgentEvent(s, { threadId: 'rl', type: 'resolved', requestId: 'tool-8' });
  assert.ok(!s.queue.some((q) => q.requestId === 'tool-8'));
  assert.equal(thread(s, 'rl').steps.find((x) => x.id === 'rl5')!.status, 'running');
  assert.equal(applyAgentEvent(s, { threadId: 'rl', type: 'resolved', requestId: 'tool-8' }), s, 'resolving an answered request is a no-op');
});

test('a question goes to the queue with its questions and resolves with your answers', () => {
  let s = live(base(), 'rl');
  s = applyAgentEvent(s, { threadId: 'rl', type: 'question', requestId: 'ask-1', questions: [{ text: 'Which store?', options: ['Redis', 'Postgres'], multiSelect: false }] });
  const item = s.queue.find((q) => q.requestId === 'ask-1')!;
  assert.equal(item.kind, 'question');
  assert.equal(item.title, 'Which store?');
  assert.deepEqual(resolution(s, { type: 'answer', queueId: item.id, answers: [['Postgres']] }), { requestId: 'ask-1', decision: { kind: 'answer', answers: [['Postgres']] } });
});

test('demo threads resolve in the store, never through host.agent', () => {
  let s = base();
  s = applyAgentEvent(s, { threadId: 'rl', type: 'approval', requestId: 'gate-x', kind: 'tool', title: 'Start', detail: '' });
  assert.equal(resolution(s, { type: 'answer', queueId: 'q-gate-x' }), null);
});

test('usage events move the context meter and accumulate on a live session', () => {
  let s = live(base(), 'rl');
  s = applyAgentEvent(s, { threadId: 'rl', type: 'usage', inputTokens: 100, outputTokens: 20, costUsd: 0.01, contextUsed: 50_000, contextMax: 200_000 });
  s = applyAgentEvent(s, { threadId: 'rl', type: 'usage', inputTokens: 50, outputTokens: 5, costUsd: 0.02 });
  const rl = thread(s, 'rl');
  assert.deepEqual(rl.context, { used: 50_000, max: 200_000 });
  assert.equal(rl.session!.usage!.input, 150);
  assert.ok(Math.abs(rl.session!.usage!.costUsd! - 0.03) < 1e-9);
});

test('info merges into the thread, MCP servers by name, and a new session starts it over', () => {
  let s = base();
  s = applyAgentEvent(s, { threadId: 'rl', type: 'info', info: { model: 'm', mcpServers: [{ name: 'a', status: 'pending', toolCount: 2 }, { name: 'b', status: 'connected' }] } });
  s = applyAgentEvent(s, { threadId: 'rl', type: 'info', info: { skills: ['ui'], mcpServers: [{ name: 'a', status: 'connected' }] } });
  assert.deepEqual(thread(s, 'rl').agent, { model: 'm', skills: ['ui'], mcpServers: [{ name: 'a', status: 'connected', toolCount: 2 }, { name: 'b', status: 'connected' }] });
  s = applyAgentEvent(s, { threadId: 'rl', type: 'session', provider: 'claude', sessionId: 'sess-2' });
  assert.deepEqual(thread(s, 'rl').agent, {});
});

test('the demo adapter raises the overlap at the scripted minute, as the tick did', () => {
  let s = tick(base(), SCRIPT.overlapAt - NOW0 - 1);
  assert.ok(!s.queue.some((q) => q.kind === 'overlap'));
  s = tick(s);
  const item = s.queue.find((q) => q.kind === 'overlap')!;
  assert.equal(s.now, SCRIPT.overlapAt);
  assert.deepEqual([item.threadId, item.overlap!.otherThreadId, item.overlap!.otherStepId], ['adm', 'rl', 'rl5']);
  assert.deepEqual(item.overlap!.sharedFiles, ['packages/cache/redis.ts']);
  const adm = thread(s, 'adm');
  const held = adm.steps[2];
  assert.deepEqual([held.title, held.status, held.addedBy, held.id], ['Add Redis client', 'waiting', 'codex', item.overlap!.stepId]);
  assert.ok(adm.activity.some((a) => a.who === 'codex' && a.text.startsWith('Usage queries take 1.8s')));
  assert.equal(tick(s, 3).queue.filter((q) => q.kind === 'overlap').length, 1, 'fires once');
});

test('the demo adapter adds rl scope at the scripted minute', () => {
  let s = tick(base(), SCRIPT.scopeAt - NOW0);
  const rl = thread(s, 'rl');
  const added = rl.steps.slice(-2);
  assert.deepEqual(added.map((x) => [x.title, x.size, x.addedBy]), [
    ['Return RateLimit-* headers', 1, 'claude'],
    ['Stricter limits for /search', 2, 'claude'],
  ]);
  assert.equal(rl.revisions.at(-1)!.label, 'Claude found 2 more steps');
  s = tick(s, 5);
  assert.equal(thread(s, 'rl').steps.length, rl.steps.length, 'fires once');
});

test('demo threads progress, log tools, grow context and end in review', () => {
  let s = base();
  const before = thread(s, 'adm');
  s = tick(s, 4);
  const adm = thread(s, 'adm');
  assert.ok(adm.steps.find((x) => x.id === 'ad2')!.progress > before.steps.find((x) => x.id === 'ad2')!.progress);
  assert.ok(adm.activity.some((a) => a.kind === 'tool' && a.at > NOW0));
  assert.ok(adm.context.used > before.context.used);
  for (let i = 0; i < 2000 && !s.queue.some((q) => q.id === 'q-review-rl'); i++) s = tick(s);
  assert.equal(thread(s, 'rl').status, 'review');
});

test("a tool's end with links fills in the entry its start logged", () => {
  let s = base();
  s = applyAgentEvent(s, { threadId: 'rl', type: 'tool', id: 'w1', phase: 'start', text: 'Search the web' });
  s = applyAgentEvent(s, { threadId: 'rl', type: 'tool', id: 'w1', phase: 'end', text: 'Search token bucket', links: [{ url: 'https://redis.io/' }] });
  const entry = thread(s, 'rl').activity.at(-1)!;
  assert.equal(entry.text, 'Search token bucket');
  assert.deepEqual(entry.links, [{ url: 'https://redis.io/' }]);
});
