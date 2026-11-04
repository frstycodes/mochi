import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { MirrorFrame, RemoteCommand } from '../host/types/remote.ts';
import { mirrorState, reducer } from '../store/root.ts';
import { splitSaved, toSaved } from '../store/saved.ts';
import type { State } from '../store/types.ts';
import { remoteThreadId, toWire } from './ids.ts';
import { applyFrame, type Mirror } from './mirror.ts';
import {
  NO_PENDING,
  pendingAdded,
  pendingAfter,
  pendingAnswered,
  pendingRun,
  withPending,
  type Pending,
} from './pending.ts';
import { storeCommand } from './storeCommands.ts';

/** A machine with one live thread, its turn over; `run` applies a device's command as its Core does, `file` is its next snapshot. */
function machine() {
  const created = reducer(
    mirrorState({
      version: 1,
      now: 900,
      seq: 1,
      threads: [],
      queue: [],
      checkpoints: {},
      checkpointSeq: 0,
      forks: {},
    }),
    {
      type: 'create',
      title: 'Fix login',
      provider: 'claude',
      project: null,
      isLive: true,
      isBackground: true,
    },
  );
  const threadId = created.threads[0].id;
  let state = reducer(created, {
    type: 'agent',
    event: { threadId, type: 'turn-end', status: 'done', seq: 1 },
  });
  return {
    threadId,
    run: (command: RemoteCommand) => {
      const stored = storeCommand(toWire(command), state, 'Pixel')!;
      state = stored.actions.reduce((s, a) => reducer(s, a), state);
    },
    file: (sequence: number): MirrorFrame => ({
      type: 'thread',
      threadId,
      saved: JSON.parse(splitSaved(toSaved(state)).threads[threadId]),
      sequence,
    }),
  };
}

/** The device following it: frames land in the mirror and its pending runs, as `useMachines` keeps them. */
function device() {
  let mirror: Mirror | undefined;
  let pending: Pending = NO_PENDING;
  return {
    receive: (frame: MirrorFrame) => {
      mirror = applyFrame('mac', mirror, frame);
      pending = pendingAfter(pending, frame);
    },
    run: (command: RemoteCommand, commandId: string) => {
      const run = pendingRun(command, shown(), commandId, 0);
      assert.ok(run, 'a store command on a thread it has shows at once');
      pending = pendingAdded(pending, run);
    },
    answered: (
      commandId: string,
      result: Parameters<typeof pendingAnswered>[2],
    ) => {
      pending = pendingAnswered(pending, commandId, result);
    },
    pending: () => pending,
    shown,
  };
  function shown(): State {
    return withPending(mirror!.state, pending);
  }
}

const messages = (state: State, text: string) =>
  state.threads[0].activity
    .filter((e) => e.who === 'you' && e.kind === 'message' && e.text === text)
    .map(({ at: _at, ...entry }) => entry);

test('a message sent to another computer’s thread shows at once, and its snapshot takes over without a second copy', () => {
  const m = machine();
  const d = device();
  d.receive(m.file(1));
  const send = {
    type: 'send',
    threadId: remoteThreadId('mac', m.threadId),
    text: 'Ship it',
    steers: true,
  } satisfies RemoteCommand;

  d.run(send, 'c1');
  const before = messages(d.shown(), 'Ship it');
  assert.equal(before.length, 1);

  m.run(send);
  d.receive({ type: 'logged', commandId: 'c1', sequence: 5 });
  // A save from before the command still holds only the old thread: the message stays, once.
  d.receive(m.file(4));
  assert.equal(messages(d.shown(), 'Ship it').length, 1);

  d.receive(m.file(5));
  assert.deepEqual(d.pending().runs, []);
  assert.deepEqual(messages(d.shown(), 'Ship it'), before);

  // The answer comes after the snapshot that has it: nothing to show twice.
  d.answered('c1', { isOk: true, sequence: 5 });
  assert.deepEqual(messages(d.shown(), 'Ship it'), before);
});

test('a rename that fails there is dropped; one answered after its snapshot stops showing then', () => {
  const m = machine();
  const d = device();
  d.receive(m.file(1));
  const threadId = remoteThreadId('mac', m.threadId);

  d.run({ type: 'rename', threadId, title: 'Fix SSO' }, 'c1');
  assert.equal(d.shown().threads[0].title, 'Fix SSO');
  d.answered('c1', { isOk: false, error: 'No such thread on this machine' });
  assert.equal(d.shown().threads[0].title, 'Fix login');

  d.run({ type: 'rename', threadId, title: 'Fix SSO' }, 'c2');
  m.run({ type: 'rename', threadId, title: 'Fix SSO' });
  d.receive(m.file(7));
  assert.equal(d.pending().runs.length, 1);
  d.answered('c2', { isOk: true, sequence: 7 });
  assert.deepEqual(d.pending().runs, []);
  assert.equal(d.shown().threads[0].title, 'Fix SSO');
});
