import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QueueItem, Step, Thread } from '../model.ts';
import { diffNotices, groupBursts, isQuiet, type Notice } from './model.ts';

const step = (rest: Partial<Step> = {}): Step => ({ id: 's1', title: 'Wire gateway', size: 1, status: 'running', progress: 0.5, footprint: [], addedAt: 0, addedBy: 'you', revision: 1, ...rest });
const thread = (rest: Partial<Thread> = {}): Thread =>
  ({ id: 't', spaceId: 'x', repo: null, title: 'Rate limits', goal: '', providers: ['claude'], status: 'running', line: 1, startedAt: 0, steps: [step()], revisions: [], activity: [], prs: [], skills: [], sources: [], context: { used: 0, max: 1 }, ...rest }) as Thread;
const item = (rest: Partial<QueueItem>): QueueItem => ({ id: 'q1', kind: 'ci', threadId: 't', title: 'CI failed', detail: 'lint', blocks: { steps: 0, threads: 1 }, createdAt: 0, ...rest });
const diff = (prev: Thread, next: Thread, queue: { prev?: QueueItem[]; next?: QueueItem[] } = {}) => diffNotices({ threads: [prev], queue: queue.prev ?? [] }, { threads: [next], queue: queue.next ?? [] }, 10).map((n) => n.kind);

test('status transitions become needs-you and review notices', () => {
  assert.deepEqual(diff(thread(), thread({ status: 'needs-you' })), ['needs-you']);
  assert.deepEqual(diff(thread(), thread({ status: 'review' })), ['review']);
  assert.deepEqual(diff(thread({ status: 'needs-you' }), thread({ status: 'needs-you', title: 'renamed' })), []);
});

test('step done and race lost come from step transitions', () => {
  assert.deepEqual(diff(thread(), thread({ steps: [step({ status: 'done' })] })), ['step-done']);
  assert.deepEqual(diff(thread(), thread({ steps: [step({ status: 'dropped', link: { mode: 'race', threadId: 'o', stepId: 'o1' } })] })), ['race-lost']);
  assert.deepEqual(diff(thread(), thread({ steps: [step({ status: 'dropped' })] })), []);
});

test('new CI and overlap queue items notify, old ones and other kinds do not', () => {
  const ci = item({});
  const overlap = item({ id: 'q2', kind: 'overlap' });
  const question = item({ id: 'q3', kind: 'question' });
  const t = thread();
  assert.deepEqual(diff(t, t, { next: [ci, overlap, question] }), ['ci', 'overlap']);
  assert.deepEqual(diff(t, t, { prev: [ci], next: [ci] }), []);
});

test('new open PRs ask for review; new threads are not diffed', () => {
  assert.deepEqual(diff(thread(), thread({ prs: [{ number: 4, state: 'open', title: 'x' }] })), ['pr-review']);
  assert.deepEqual(diffNotices({ threads: [], queue: [] }, { threads: [thread({ status: 'needs-you' })], queue: [] }, 1), []);
});

test('bursts fold one thread within 3 minutes, newest first', () => {
  const n = (id: string, threadId: string, at: number): Notice => ({ id, kind: 'step-done', threadId, title: id, body: '', at, isRead: false });
  const bursts = groupBursts([n('a', 't', 1), n('b', 't', 3), n('c', 'u', 4), n('d', 't', 5), n('e', 't', 6), n('f', 't', 20)]);
  assert.deepEqual(bursts.map((b) => b.notices.map((x) => x.id)), [['f'], ['e', 'd'], ['c'], ['b', 'a']]);
});

test('quiet hours wrap past midnight', () => {
  const at = (h: number) => new Date(2026, 0, 1, h);
  const night = { isOn: true, start: 22, end: 8 };
  assert.equal(isQuiet(night, at(23)), true);
  assert.equal(isQuiet(night, at(7)), true);
  assert.equal(isQuiet(night, at(8)), false);
  assert.equal(isQuiet({ isOn: true, start: 9, end: 17 }, at(12)), true);
  assert.equal(isQuiet({ ...night, isOn: false }, at(23)), false);
});

test('a usage limit notifies as a pause, not a question; a resume at reset notifies too', () => {
  const live = { isWorking: false };
  const running = thread({ status: 'running', live });
  const paused = thread({ status: 'needs-you', live: { ...live, limit: { resetsAt: '2026-10-13T15:40:00.000Z', label: '5-hour', autoResume: true } } });
  const [notice] = diffNotices({ threads: [running], queue: [] }, { threads: [paused], queue: [] }, 10);
  assert.equal(notice.kind, 'limit');
  assert.match(notice.body, /hit the 5-hour usage limit; resets /);
  assert.deepEqual(diff(running, paused), ['limit'], 'no second "needs you" for the same pause');
  assert.deepEqual(diff(paused, thread({ status: 'running', live })), ['limit']);
  assert.deepEqual(diff(paused, thread({ status: 'running', live: { ...live, isOnApiKey: true } })), [], 'moving to the API key is your own click');
});
