import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StreamFrame } from '../host/types/remote.ts';
import type { Action } from '../store/index.tsx';
import { mirrorState, reducer } from '../store/root.ts';
import { toSaved } from '../store/persist.ts';
import { applyFrame } from './mirror.ts';

/** A machine's store: one live thread, and its stream as frames. */
function machine() {
  let state = reducer(mirrorState({ version: 1, now: 900, seq: 1, threads: [], queue: [], checkpoints: {}, checkpointSeq: 0, forks: {} }), { type: 'create', title: 'Fix login', provider: 'claude', project: null, isLive: true, isBackground: true });
  let seq = 0;
  const act = (action: Action): StreamFrame => {
    state = reducer(state, action);
    return { type: 'action', epoch: 'e1', seq: ++seq, action: JSON.parse(JSON.stringify(action)) };
  };
  const snapshot = (): StreamFrame => ({ type: 'snapshot', epoch: 'e1', seq, saved: JSON.parse(JSON.stringify(toSaved(state))) });
  return { act, snapshot, threadId: () => state.threads[0].id, state: () => state };
}

test('a mirror rebuilt from a snapshot and the actions after it matches the machine’s threads', () => {
  const m = machine();
  let mirror = applyFrame(undefined, m.snapshot());
  const threadId = m.threadId();
  for (const action of [{ type: 'rename', threadId, title: 'Fix SSO login' }, { type: 'tick' }, { type: 'say', threadId, entry: { who: 'harness', kind: 'event', text: 'Hello' } }] as Action[]) mirror = applyFrame(mirror, m.act(action));
  // Through JSON, as the stream carries it: only undefined fields differ.
  assert.deepEqual(mirror?.state.threads, JSON.parse(JSON.stringify(m.state().threads)));
  assert.equal(mirror?.state.now, m.state().now, 'the tick keeps both clocks together');
});

test('the machine’s own layout actions change nothing a device reads', () => {
  const m = machine();
  const mirror = applyFrame(undefined, m.snapshot());
  const after = applyFrame(mirror, m.act({ type: 'go', view: { kind: 'queue' } }));
  assert.equal(after?.state.threads, mirror?.state.threads);
  assert.equal(after?.state.queue, mirror?.state.queue);
});

test('an action before any snapshot, from another epoch or already applied is skipped', () => {
  const m = machine();
  const threadId = m.threadId();
  const early = m.act({ type: 'rename', threadId, title: 'Early' });
  assert.equal(applyFrame(undefined, early), undefined);
  const mirror = applyFrame(undefined, m.snapshot());
  assert.equal(applyFrame(mirror, early), mirror);
  const rename = m.act({ type: 'rename', threadId, title: 'Later' });
  assert.equal(applyFrame(mirror, { ...rename, epoch: 'e2' }), mirror);
});

test('a snapshot carries the machine’s side chats, so one asked before this computer connected still shows', () => {
  const saved = { version: 1, now: 900, seq: 1, threads: [], queue: [], checkpoints: {}, checkpointSeq: 0, forks: {}, sidechats: { t1: { remote: { messages: [{ id: 'a', role: 'assistant', text: 'Because.' }] } } } };
  const mirror = applyFrame(undefined, { type: 'snapshot', epoch: 'e1', seq: 0, saved });
  assert.equal(mirror?.state.sidechats.t1?.remote?.messages[0].text, 'Because.');
});
