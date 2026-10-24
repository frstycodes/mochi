import assert from 'node:assert/strict';
import { onTestFinished, test } from 'vite-plus/test';
import type { ScheduleRun } from '../host/types/schedule.ts';
import type { Action, State } from '../store/index.tsx';
import { initialQueue, queueReducer } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { agentCalls, unsentTurns } from '../runtime/live.ts';
import { applyAgentEvent } from '../runtime/apply.ts';
import { agentPhase, pendingWork } from '../agentPhase.ts';
import { DEFAULT_PREFS, setPrefs } from '../settings/prefs.ts';
import { scheduleReducer } from './slice.ts';

const base = () => ({ ...initialThreads(), ...initialQueue(), spaceId: 'latitude', views: {} }) as unknown as State;
const reduce = (s: State, action: Action) => [threadsReducer, queueReducer, scheduleReducer].reduce((acc, slice) => slice(acc, action), s);

test('a scheduled thread waits for its run; the run wakes it, lands in the Queue, and Settle clears it', () => {
  const create: Action = { type: 'create', title: 'Nightly dependency check', provider: 'claude', project: '/Users/me/dev/harness', isLive: true, isBackground: true, schedule: { when: { kind: 'cron', cron: '0 2 * * *' }, missed: 'run-once' } };
  let s = base();
  assert.deepEqual(agentCalls(s, create, () => reduce(s, create)), [], 'no agent starts until the first run');
  s = reduce(s, create);
  const thread = s.threads.at(-1)!;
  assert.deepEqual([thread.live?.isWorking, thread.live?.isDetached], [false, true]);
  assert.equal(thread.activity.at(-1)?.text, 'Scheduled: Every day at 02:00');

  const run: ScheduleRun = { id: 'run-1', threadId: thread.id, reason: 'Every day at 02:00', startedAt: 0, status: 'running' };
  s = reduce(s, { type: 'schedule-run', event: { type: 'run-start', run, name: 'Nightly dependency check', prompt: 'Check deps' } });
  assert.equal(s.threads.at(-1)!.live?.isWorking, true);
  s = reduce(s, { type: 'schedule-run', event: { type: 'run-end', run: { ...run, status: 'done', summary: '2 findings', endedAt: 30_000 }, name: 'Nightly dependency check' } });
  const item = s.queue.find((q) => q.kind === 'run')!;
  assert.equal(item.title, 'Nightly dependency check finished: 2 findings');
  assert.equal(item.detail, 'Every day at 02:00 · ran under a minute');

  s = reduce(s, { type: 'answer', queueId: item.id });
  assert.ok(!s.queue.some((q) => q.kind === 'run'));
  assert.equal(s.threads.at(-1)!.activity.at(-1)?.text, 'Settled: Nightly dependency check finished: 2 findings');
});

test('Auto-fix: turning it on tells the agent once, events go to it as their own rows, off or capped stops them', () => {
  setPrefs({ autofixPrs: false });
  onTestFinished(() => setPrefs(DEFAULT_PREFS));
  const create: Action = { type: 'create', title: 'Fix login', provider: 'claude', project: '/Users/me/dev/app', isLive: true };
  let s = reduce(base(), create);
  const id = s.threads.at(-1)!.id;
  s = reduce(s, { type: 'prs-seen', threadId: id, prs: [{ number: 12, state: 'open', title: 'Fix login', url: 'https://github.com/o/r/pull/12' }] });
  const callsFor = (action: Action) => agentCalls(s, action, () => reduce(s, action));
  const prompt = (action: Action) => callsFor(action).map((c) => (c.method === 'start' ? c.options.prompt : c.method === 'send' ? c.text : ''))[0];

  const on: Action = { type: 'autofix-set', threadId: id, pr: 12, since: 5 };
  assert.match(prompt(on) ?? '', /^<mochi-autofix-event kind="enabled" pr="12">[\s\S]*No action needed right now/);
  s = reduce(s, on);
  const notice = s.threads.at(-1)!.activity.at(-1)!;
  assert.deepEqual([notice.who, notice.autofix?.kind], ['you', 'enabled']);
  assert.ok(!notice.text.includes('<mochi-autofix-event'), 'the row shows the event, not its tag');
  assert.deepEqual(callsFor(on), [], 'already on: no second notice');

  const ci: Action = { type: 'autofix', threadId: id, event: { kind: 'ci', pr: 12, url: 'u', head: 'abcdef1', failed: [{ name: 'lint', state: 'fail' }], attempt: 1 } };
  assert.match(prompt(ci) ?? '', /kind="ci"[\s\S]*lint/);
  s = reduce(s, ci);
  assert.equal(s.threads.at(-1)!.activity.at(-1)!.autofix?.title, 'CI failed on #12 · fixing');

  const capped = reduce(s, { type: 'autofix', threadId: id, event: { kind: 'stopped', pr: 12, url: 'u', reason: 'cap', failed: [{ name: 'lint', state: 'fail' }] } });
  assert.equal(capped.threads.at(-1)!.prs[0].autofixSince, undefined);
  assert.ok(capped.queue.some((q) => q.kind === 'ci' && q.threadId === id), 'out of attempts: the failure is yours, in the Queue');

  s = reduce(s, { type: 'autofix-set', threadId: id, pr: 12 });
  assert.deepEqual(callsFor(ci), [], 'off: a late event from main goes nowhere');
  assert.equal(reduce(s, ci).threads.at(-1)!.activity.length, s.threads.at(-1)!.activity.length);
});

test('a PR new to a thread starts with your defaults, said on the thread; one it already had keeps its state', () => {
  onTestFinished(() => setPrefs(DEFAULT_PREFS));
  const create: Action = { type: 'create', title: 'Fix login', provider: 'claude', project: '/Users/me/dev/app', isLive: true };
  let s = reduce(base(), create);
  const id = s.threads.at(-1)!.id;
  const seen = (number: number, state: 'open' | 'merged' = 'open'): Action => ({ type: 'prs-seen', threadId: id, prs: [{ number, state, title: 'Fix', url: `https://github.com/o/r/pull/${number}` }] });
  const pr = (number: number) => s.threads.at(-1)!.prs.find((p) => p.number === number)!;

  s = reduce(s, seen(12));
  assert.deepEqual([!!pr(12).autofixSince, pr(12).autoArchive], [true, undefined]);
  assert.equal(s.threads.at(-1)!.activity.at(-1)?.text, 'Auto-fix on for #12');

  s = reduce(s, { type: 'autofix-set', threadId: id, pr: 12 });
  s = reduce(s, seen(12));
  assert.equal(pr(12).autofixSince, undefined, 'turned off stays off');

  s = reduce(s, seen(13, 'merged'));
  assert.equal(pr(13).autofixSince, undefined, 'a merged PR has nothing to fix');

  setPrefs({ autofixPrs: false, autoArchivePrs: true });
  s = reduce(s, seen(14));
  assert.deepEqual([pr(14).autofixSince, pr(14).autoArchive], [undefined, true]);
  s = reduce(s, { type: 'auto-archive-set', threadId: id, pr: 14, isOn: false });
  assert.equal(pr(14).autoArchive, undefined);
});

test('Auto-fix stopping on a merged or closed PR records that state; at its cap the state stays', () => {
  const create: Action = { type: 'create', title: 'Fix login', provider: 'claude', project: '/Users/me/dev/app', isLive: true };
  let s = reduce(base(), create);
  const id = s.threads.at(-1)!.id;
  s = reduce(s, { type: 'prs-seen', threadId: id, prs: [{ number: 12, state: 'open', title: 'Fix', url: 'u' }] });
  const stop = (reason: 'closed' | 'cap'): Action => ({ type: 'autofix', threadId: id, event: { kind: 'stopped', pr: 12, url: 'u', reason } });
  assert.equal(reduce(s, stop('cap')).threads.at(-1)!.prs[0].state, 'open');
  assert.equal(reduce(s, stop('closed')).threads.at(-1)!.prs[0].state, 'closed');
});

// new-127: a review event became a message (and a turn) the agent never got, so the thread thought on after its PR merged.
test('an Auto-fix review that reaches no agent ends its turn; the PR merging after leaves no Thinking behind', () => {
  const create: Action = { type: 'create', title: 'PR pane', provider: 'claude', project: '/Users/me/dev/app', isLive: true };
  let s = reduce(base(), create);
  const id = s.threads.at(-1)!.id;
  s = applyAgentEvent(s, { threadId: id, type: 'turn-end', status: 'done' });
  s = reduce(s, { type: 'prs-seen', threadId: id, prs: [{ number: 284, state: 'open', title: 'PR pane', url: 'u' }] });
  s = reduce(s, { type: 'autofix-set', threadId: id, pr: 284, since: 5 });
  s = applyAgentEvent(s, { threadId: id, type: 'turn-end', status: 'done' });
  const thread = () => s.threads.find((t) => t.id === id)!;
  assert.equal(agentPhase(thread()), 'idle');

  const review: Action = { type: 'autofix', threadId: id, event: { kind: 'review', pr: 284, url: 'u', comments: [{ id: 'c1', author: 'coderabbitai', body: 'Nit' }] } };
  const next = reduce(s, review);
  const calls = agentCalls(s, review, () => next);
  assert.deepEqual(calls.map((c) => [c.method, c.threadId]), [['send', id]], 'dispatched, the review reaches the agent');
  assert.deepEqual(unsentTurns(s, next, calls), []);
  assert.deepEqual(unsentTurns(s, next, []), [id], 'applied without its call, the turn has nothing to run it');

  const before = s;
  s = next;
  assert.equal(pendingWork(thread())?.label, 'Thinking');
  for (const threadId of unsentTurns(before, next, [])) s = applyAgentEvent(s, { threadId, type: 'turn-end', status: 'failed', error: 'Mochi had no agent to send this to' });
  s = reduce(s, { type: 'autofix', threadId: id, event: { kind: 'stopped', pr: 284, url: 'u', reason: 'merged' } });
  assert.equal(thread().activity.at(-1)?.text, 'Auto-fix off: #284 was merged');
  assert.deepEqual([thread().live?.isWorking, thread().live?.turnEnd, pendingWork(thread())], [false, 'failed', undefined], 'no Thinking once nothing runs');
  assert.equal(agentPhase(thread()), 'wait', 'the undelivered review asks for you rather than spinning');
});
