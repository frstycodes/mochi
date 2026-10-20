import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentEvent, AgentPlanItem } from '../host/types/agent.ts';
import { NOW0 } from '../model.ts';
import type { State } from '../store/index.tsx';
import { initialQueue, queueReducer } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { applyAgentEvent, resolution, undelivered } from './apply.ts';
import { SCRIPT } from './demo.ts';

const base = () => ({ ...initialThreads(), ...initialQueue(), spaceId: 'latitude', views: {} }) as unknown as State;
const thread = (s: State, id: string) => s.threads.find((t) => t.id === id)!;
const titles = (s: State, id: string) => thread(s, id).steps.map((x) => x.title);
const tick = (s: State, n = 1) => {
  for (let i = 0; i < n; i++) s = threadsReducer(s, { type: 'tick' });
  return s;
};
const live = (s: State, id: string): State => ({ ...s, threads: s.threads.map((t) => (t.id === id ? { ...t, session: { provider: t.providers[0], id: 'sess-1' } } : t)) });

test('a plan matches steps by title, starts and completes them', () => {
  let s = base();
  const items = titles(s, 'rl').filter((_, i) => i !== 2).map((title): AgentPlanItem => ({ title, status: 'pending' }));
  items[3] = { title: 'add a redis client', status: 'done' };
  items[4] = { title: 'Token bucket middleware', status: 'running' };
  s = applyAgentEvent(s, { threadId: 'rl', type: 'plan', items });
  const rl = thread(s, 'rl');
  assert.equal(rl.steps.find((x) => x.id === 'rl5')!.status, 'done', 'fuzzy title still matches');
  assert.equal(rl.steps.find((x) => x.id === 'rl6')!.status, 'running');
  assert.equal(rl.steps.length, 9, 'no scope added');
});

test('an unknown plan item lands as a plan step, no revision, after the item it follows', () => {
  let s = base();
  const before = thread(s, 'adm').revisions;
  const items = titles(s, 'adm').map((title) => ({ title, status: 'pending' as const }));
  items.splice(1, 0, { title: 'Index api_usage_daily by key', status: 'pending' as const });
  s = applyAgentEvent(s, { threadId: 'adm', type: 'plan', items });
  const adm = thread(s, 'adm');
  const added = adm.steps[1];
  assert.equal(added.title, 'Index api_usage_daily by key');
  assert.deepEqual([added.addedBy, added.status], ['codex', 'ready']);
  assert.equal(adm.revisions, before);
  assert.equal(adm.activity.at(-1)!.text, 'Plan: Codex added "Index api_usage_daily by key"');
});

test("the steps mirror the agent's plan: one it no longer lists is dropped, whoever added it", () => {
  let s = base();
  const items = titles(s, 'rl')
    .filter((title) => title !== 'Load test at 2k req/s' && title !== 'Per-key overrides')
    .map((title) => ({ title, status: 'pending' as const }));
  s = applyAgentEvent(s, { threadId: 'rl', type: 'plan', items });
  const rl = thread(s, 'rl');
  const rl8 = rl.steps.find((x) => x.id === 'rl8')!;
  assert.equal(rl8.status, 'dropped');
  assert.equal(rl8.note, 'Dropped by Claude');
  assert.equal(rl.steps.find((x) => x.id === 'rl7')!.status, 'dropped', 'a step added by hand before steps became a mirror goes too');
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
  assert.deepEqual(resolution(s, answer), { threadId: 'rl', title: item.title, requestId: 'tool-7', decision: { kind: 'allow' } });
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

test('an answer main could not deliver lands in the transcript with what you answered', () => {
  let s = live(base(), 'rl');
  s = applyAgentEvent(s, { threadId: 'rl', type: 'question', requestId: 'ask-2', questions: [{ text: 'How should I open the PRs?', options: ['Bypass hook'], multiSelect: false }] });
  const answer = resolution(s, { type: 'answer', queueId: 'q-ask-2', answers: [['use gh pr create for now']] })!;
  s = threadsReducer(s, { type: 'say', threadId: 'rl', entry: undelivered(answer, new Error('The agent is no longer waiting on this request')) });
  const line = thread(s, 'rl').activity.at(-1)!;
  assert.equal(line.who, 'harness');
  assert.match(line.text, /didn't reach the agent: The agent is no longer waiting on this request\..*use gh pr create for now/);
});

test('a question goes to the queue with its questions and resolves with your answers', () => {
  let s = live(base(), 'rl');
  s = applyAgentEvent(s, { threadId: 'rl', type: 'question', requestId: 'ask-1', questions: [{ text: 'Which store?', options: ['Redis', 'Postgres'], multiSelect: false }] });
  const item = s.queue.find((q) => q.requestId === 'ask-1')!;
  assert.equal(item.kind, 'question');
  assert.equal(item.title, 'Which store?');
  assert.deepEqual(resolution(s, { type: 'answer', queueId: item.id, answers: [['Postgres']] }), { threadId: 'rl', title: 'Which store?', requestId: 'ask-1', decision: { kind: 'answer', answers: [['Postgres']] } });
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
  // The demo thread carries agent info of its own; a session starts it over.
  let s = applyAgentEvent(base(), { threadId: 'rl', type: 'session', provider: 'claude', sessionId: 'sess-1' });
  s = applyAgentEvent(s, { threadId: 'rl', type: 'info', info: { model: 'm', mcpServers: [{ name: 'a', status: 'pending', toolCount: 2 }, { name: 'b', status: 'connected' }] } });
  s = applyAgentEvent(s, { threadId: 'rl', type: 'info', info: { skills: ['ui'], mcpServers: [{ name: 'a', status: 'connected' }] } });
  assert.deepEqual(thread(s, 'rl').agent, { model: 'm', skills: ['ui'], mcpServers: [{ name: 'a', status: 'connected', toolCount: 2 }, { name: 'b', status: 'connected' }] });
  s = applyAgentEvent(s, { threadId: 'rl', type: 'session', provider: 'claude', sessionId: 'sess-2' });
  assert.deepEqual(thread(s, 'rl').agent, {});
});

test('the demo adapter adds rl scope at the scripted minute', () => {
  let s = tick(base(), SCRIPT.scopeAt - NOW0);
  const rl = thread(s, 'rl');
  const added = rl.steps.slice(-2);
  assert.deepEqual(added.map((x) => [x.title, x.addedBy]), [
    ['Return RateLimit-* headers', 'claude'],
    ['Stricter limits for /search', 'claude'],
  ]);
  assert.equal(rl.activity.findLast((e) => e.text.startsWith('Plan:'))!.text, 'Plan: Claude found 2 more steps');
  s = tick(s, 5);
  assert.equal(thread(s, 'rl').steps.length, rl.steps.length, 'fires once');
});

test('demo threads log tools, grow context and work through their plan; a finished plan is not a finished goal', () => {
  let s = base();
  const before = thread(s, 'adm');
  s = tick(s, 4);
  const adm = thread(s, 'adm');
  assert.ok(adm.activity.some((a) => a.kind === 'tool' && a.at > NOW0));
  assert.ok(adm.context.used > before.context.used);
  const isOpen = () => thread(s, 'rl').steps.some((x) => x.status !== 'done' && x.status !== 'dropped');
  for (let i = 0; i < 2000 && isOpen(); i++) s = tick(s);
  assert.equal(isOpen(), false);
  assert.equal(thread(s, 'rl').status, 'running', 'readiness is the idle verdict’s, never the plan’s');
});

test("a tool's end with links fills in the entry its start logged", () => {
  let s = base();
  s = applyAgentEvent(s, { threadId: 'rl', type: 'tool', id: 'w1', phase: 'start', text: 'Search the web' });
  s = applyAgentEvent(s, { threadId: 'rl', type: 'tool', id: 'w1', phase: 'end', text: 'Search token bucket', links: [{ url: 'https://redis.io/' }] });
  const entry = thread(s, 'rl').activity.at(-1)!;
  assert.equal(entry.text, 'Search token bucket');
  assert.deepEqual(entry.links, [{ url: 'https://redis.io/' }]);
});

test("the agent's gh pr create records its PR on the thread at once; a known one keeps the state gh gave it", () => {
  let s = base();
  s = applyAgentEvent(s, { threadId: 'rl', type: 'tool', id: 'p1', phase: 'start', text: 'Run gh pr create --title "Rate limits"' });
  s = applyAgentEvent(s, { threadId: 'rl', type: 'tool', id: 'p1', phase: 'end', text: '', output: 'https://github.com/o/r/pull/95\n', exitCode: 0 });
  assert.deepEqual(thread(s, 'rl').prs.at(-1), { number: 95, state: 'open', title: 'Rate limits', url: 'https://github.com/o/r/pull/95' });
  s = threadsReducer(s, { type: 'prs-seen', threadId: 'rl', prs: [{ number: 95, state: 'merged', title: 'Rate limits for the API', url: 'https://github.com/o/r/pull/95' }] });
  s = applyAgentEvent(s, { threadId: 'rl', type: 'tool', id: 'p2', phase: 'start', text: 'Run gh pr create --fill' });
  s = applyAgentEvent(s, { threadId: 'rl', type: 'tool', id: 'p2', phase: 'end', text: '', output: 'already exists:\nhttps://github.com/o/r/pull/95', exitCode: 1 });
  assert.deepEqual(thread(s, 'rl').prs.filter((p) => p.number === 95), [{ number: 95, state: 'merged', title: 'Rate limits for the API', url: 'https://github.com/o/r/pull/95' }]);
  assert.equal(threadsReducer(s, { type: 'prs-seen', threadId: 'rl', prs: [...thread(s, 'rl').prs] }), s, 'nothing new: the same state');
});
