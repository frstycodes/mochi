import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentEvent } from '../host/types/agent.ts';
import { agentCalls } from '../runtime/live.ts';
import type { Action, State } from '../store/index.tsx';
import { parseSaved, toSaved } from '../store/persist.ts';
import { initialQueue } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { dueQueued, moveQueued, queuedMessage, sendMessage, shouldQueue } from './outbox.ts';

const run = (s: State, action: Action) => threadsReducer(s, action);
const event = (s: State, e: AgentEvent) => run(s, { type: 'agent', event: e });
const thread = (s: State, id: string) => s.threads.find((t) => t.id === id)!;
const drafts = (s: State, id: string) => (thread(s, id).queued ?? []).map((m) => m.draft);
const message = (draft: string) => queuedMessage(draft, { mentions: [], isCommand: false, typedSkills: [] });

/** A live thread mid-turn with "first", "second", "third" queued. */
function working() {
  const base = { ...initialThreads(undefined, false), ...initialQueue(), spaceId: 'latitude', views: {} } as unknown as State;
  let s = run(base, { type: 'create', title: 'reply with ok', provider: 'claude', project: null, isLive: true });
  const id = s.threads.at(-1)!.id;
  for (const draft of ['first', 'second', 'third']) s = run(s, { type: 'queued-add', threadId: id, message: message(draft) });
  return { s, id };
}

/** What the runner in `HarnessProvider` does: sends each due head through `sendMessage`. */
function runQueue(s: State) {
  for (const { thread: t, message: m } of dueQueued(s)) sendMessage((a) => (s = run(s, a)), s, t, m, { queuedId: m.id });
  return s;
}

test('the setting decides what a send does while the agent works, and holding mod flips it for that send', () => {
  const { s, id } = working();
  const t = thread(s, id);
  assert.equal(shouldQueue(t, 'queue', false), true);
  assert.equal(shouldQueue(t, 'queue', true), false, 'hold to steer');
  assert.equal(shouldQueue(t, 'steer', false), false);
  assert.equal(shouldQueue(t, 'steer', true), true, 'hold to queue');
  const idle = event(s, { threadId: id, type: 'turn-end', status: 'done' });
  assert.equal(shouldQueue(thread(idle, id), 'queue', false), false, 'an idle agent gets the message now');
});

test('queued messages keep their order, move with Alt+arrows and reorder by drag', () => {
  const { s, id } = working();
  assert.deepEqual(drafts(s, id), ['first', 'second', 'third']);
  const ids = thread(s, id).queued!.map((m) => m.id);
  assert.deepEqual(moveQueued(ids, ids[2], -1), [ids[0], ids[2], ids[1]]);
  assert.deepEqual(moveQueued(ids, ids[0], -1), ids, 'the top stays put');
  const dragged = run(s, { type: 'queued-order', threadId: id, ids: [ids[2], ids[0]] });
  assert.deepEqual(drafts(dragged, id), ['third', 'first', 'second'], 'an id the order missed keeps its place after');
});

test('nothing goes out mid-turn; each turn end sends the next one, marked as queued, until the queue is empty', () => {
  let { s, id } = working();
  assert.deepEqual(dueQueued(s), []);
  for (const expected of ['first', 'second', 'third']) {
    s = runQueue(event(s, { threadId: id, type: 'turn-end', status: 'done' }));
    const last = thread(s, id).activity.at(-1)!;
    assert.deepEqual([last.who, last.text, last.wasQueued], ['you', expected, true]);
    assert.equal(thread(s, id).live?.isWorking, true);
    assert.deepEqual(dueQueued(s), [], 'one per turn');
  }
  assert.deepEqual(drafts(s, id), []);
});

test('a failed or interrupted turn and a usage limit pause the queue; Resume or your next send goes on', () => {
  for (const [pause, e] of [
    ['failed', { type: 'turn-end', status: 'failed', error: 'boom' }],
    ['interrupted', { type: 'turn-end', status: 'interrupted' }],
    ['limit', { type: 'limit' }],
  ] as const) {
    const { s: start, id } = working();
    let s = event(start, { threadId: id, ...e } as AgentEvent);
    assert.equal(thread(s, id).queuePause, pause);
    assert.deepEqual(dueQueued(s), [], `${pause}: nothing sent`);
    // A limit's Resume is the agent's own (it holds every send until then); the others resume the queue.
    s = pause === 'limit' ? event(run(s, { type: 'resume', threadId: id }), { threadId: id, type: 'turn-end', status: 'done' }) : run(s, { type: 'queued-resume', threadId: id });
    assert.equal(drafts(runQueue(s), id).length, 2, `${pause}: Resume sends the next one`);
    const sent = run(event(start, { threadId: id, ...e } as AgentEvent), { type: 'send', threadId: id, text: 'go on', reason: '' });
    assert.equal(thread(sent, id).queuePause, undefined, `${pause}: a send of yours clears the pause`);
  }
});

test('Send now steers the turn in flight with that message instead of interrupting it; the queue neither pauses nor jumps ahead', () => {
  let { s, id } = working();
  const second = thread(s, id).queued![1];
  const send: Action = { type: 'send', threadId: id, text: 'second', reason: '', queuedId: second.id, steers: true };
  assert.deepEqual(agentCalls(s, send, () => run(s, send)), [{ method: 'send', threadId: id, text: 'second', steer: true }]);
  s = run(s, send);
  assert.deepEqual(drafts(s, id), ['first', 'third']);
  assert.equal(thread(s, id).queuePause, undefined);
  assert.equal(thread(s, id).live?.isWorking, true, 'the turn goes on');
  assert.deepEqual(dueQueued(s), []);
  s = runQueue(event(s, { threadId: id, type: 'turn-end', status: 'done' }));
  assert.equal(thread(s, id).activity.at(-1)!.text, 'first');
});

test('a message sent now steers a working turn; to an idle agent it starts a turn of its own', () => {
  const { s, id } = working();
  assert.deepEqual(sendCollecting(s, id, message('use pnpm')).calls, [{ method: 'send', threadId: id, text: 'use pnpm', steer: true }]);
  const idle = event(s, { threadId: id, type: 'turn-end', status: 'done' });
  assert.deepEqual(sendCollecting(idle, id, message('next')).calls, [{ method: 'send', threadId: id, text: 'next' }]);
});

test('Edit takes a message out of the queue', () => {
  const { s, id } = working();
  const edited = run(s, { type: 'queued-remove', threadId: id, id: thread(s, id).queued![1].id });
  assert.deepEqual(drafts(edited, id), ['first', 'third']);
});

test('a queue saved across a restart comes back paused, so launching never spends usage unasked', () => {
  const { s, id } = working();
  const restored = parseSaved(JSON.stringify(toSaved(s)))!.threads.find((t) => t.id === id)!;
  assert.deepEqual([restored.queuePause, restored.queued?.length], ['restart', 3]);
});

test('a message you send mid-stream stays whole: the rest of the agent\'s streamed text joins its message, not a new one after yours', () => {
  let { s, id } = working();
  s = event(s, { threadId: id, type: 'message', text: 'I can start ', isDelta: false });
  s = run(s, { type: 'send', threadId: id, text: 'hi', reason: '' });
  s = event(s, { threadId: id, type: 'message', text: 'from here.', isDelta: true });
  assert.deepEqual(thread(s, id).activity.filter((e) => e.kind === 'message').slice(-2).map((e) => [e.who, e.text]), [['claude', 'I can start from here.'], ['you', 'hi']]);
  s = event(s, { threadId: id, type: 'message', text: 'Next block.', isDelta: false });
  assert.equal(thread(s, id).activity.at(-1)!.text, 'Next block.', 'a new block is still its own message');
});

const IMAGE = { mediaType: 'image/png' as const, data: 'iVBORw0KGgo=', thumb: 'data:image/webp;base64,UklGRg==' };

/** Sends through `sendMessage` like the composer and the queue runner do, collecting the agent calls each dispatch makes. */
function sendCollecting(s: State, id: string, m: ReturnType<typeof queuedMessage>, extra?: { queuedId: string }) {
  const calls: unknown[] = [];
  sendMessage((a) => (calls.push(...agentCalls(s, a, () => run(s, a))), (s = run(s, a))), s, thread(s, id), m, extra);
  return { s, calls };
}

test('attached images reach the agent call on a send, a queued send and a new thread; the transcript keeps thumbnails', () => {
  const withImage = queuedMessage('what is this?', { images: [IMAGE], mentions: [], isCommand: false, typedSkills: [] });
  const agentImage = { mediaType: IMAGE.mediaType, data: IMAGE.data };
  const base = { ...initialThreads(undefined, false), ...initialQueue(), spaceId: 'latitude', views: {} } as unknown as State;
  const create: Action = { type: 'create', title: 'what is this?', images: [IMAGE], provider: 'codex', project: null, isLive: true };
  const [start] = agentCalls(base, create, () => run(base, create));
  assert.ok(start.method === 'start');
  assert.deepEqual(start.options.images, [agentImage], 'new thread');
  const created = run(base, create);
  const id = created.threads.at(-1)!.id;
  assert.deepEqual(thread(created, id).activity.at(-1)!.images, [IMAGE.thumb]);

  const idle = event(created, { threadId: id, type: 'turn-end', status: 'done' });
  const sent = sendCollecting(idle, id, withImage);
  assert.deepEqual(sent.calls, [{ method: 'send', threadId: id, text: 'what is this?', images: [agentImage] }], 'send');
  assert.deepEqual(thread(sent.s, id).activity.at(-1)!.images, [IMAGE.thumb]);
  assert.equal(thread(sent.s, id).activity.at(-1)!.text, 'what is this?', 'no "(1 attached)" stands in for the image');

  const waiting = run(sent.s, { type: 'queued-add', threadId: id, message: withImage });
  const [due] = dueQueued(event(waiting, { threadId: id, type: 'turn-end', status: 'done' }));
  const queued = sendCollecting(event(waiting, { threadId: id, type: 'turn-end', status: 'done' }), id, due.message, { queuedId: due.message.id });
  assert.deepEqual(queued.calls, [{ method: 'send', threadId: id, text: 'what is this?', images: [agentImage] }], 'queued send');
  assert.equal(thread(queued.s, id).activity.at(-1)!.wasQueued, true);
  assert.deepEqual(thread(queued.s, id).queued ?? [], []);
});

test('the transcript keeps the original of an image you sent when it was saved, so the viewer shows it full size', () => {
  const kept = { ...IMAGE, original: '/userData/images/abc.png' };
  const base = { ...initialThreads(undefined, false), ...initialQueue(), spaceId: 'latitude', views: {} } as unknown as State;
  const created = run(base, { type: 'create', title: 'look', images: [kept], provider: 'codex', project: null, isLive: true });
  const id = created.threads.at(-1)!.id;
  assert.deepEqual(thread(created, id).activity.at(-1)!.images, [kept.original], 'new thread');

  const message = queuedMessage('and this?', { images: [kept], mentions: [], isCommand: false, typedSkills: [] });
  const sent = sendCollecting(event(created, { threadId: id, type: 'turn-end', status: 'done' }), id, message);
  assert.deepEqual(thread(sent.s, id).activity.at(-1)!.images, [kept.original], 'send');
});
