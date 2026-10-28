import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { worktreeMention } from '../chat/fileMentions.ts';
import type { Action } from '../store/index.tsx';
import { commandFor } from './actions.ts';
import { toWire } from './ids.ts';

test('the shared UI’s actions become the commands that do the same on the machine', () => {
  assert.deepEqual(commandFor({ type: 'answer', queueId: 'q1' }), {
    type: 'resolve',
    queueId: 'q1',
  });
  assert.deepEqual(
    commandFor({ type: 'answer', queueId: 'q1', answers: [['A']] }),
    { type: 'resolve', queueId: 'q1', answers: [['A']] },
  );
  assert.deepEqual(commandFor({ type: 'unsettle', threadId: 't' }), {
    type: 'settle',
    threadId: 't',
    isSettled: false,
  });
  assert.deepEqual(
    commandFor({ type: 'go', view: { kind: 'thread', id: 't' } }),
    { type: 'open', threadId: 't' },
  );
  assert.deepEqual(commandFor({ type: 'delete', threadIds: ['t'] }), {
    type: 'delete',
    threadId: 't',
  });
  // Pins stay on each screen: pinning another computer's thread never reaches it.
  assert.equal(commandFor({ type: 'pin-at', threadId: 't', order: 42 }), null);
  assert.deepEqual(
    commandFor({
      type: 'rewind-message',
      threadId: 't',
      index: 3,
      mode: 'chat',
    }),
    {
      type: 'rewind',
      threadId: 't',
      point: { kind: 'message', index: 3 },
      mode: 'chat',
    },
  );
  assert.deepEqual(
    commandFor({ type: 'rewind', threadId: 't', n: 2 }),
    {
      type: 'rewind',
      threadId: 't',
      point: { kind: 'checkpoint', n: 2 },
      mode: 'files',
    },
    'the reducer’s own default',
  );
});

test('what a device can’t do maps to nothing rather than to something close', () => {
  assert.equal(commandFor({ type: 'go', view: { kind: 'queue' } }), null);
  assert.equal(
    commandFor({ type: 'delete', threadIds: ['t', 'u'] }),
    null,
    'one thread at a time, as on the machine’s own menu',
  );
  assert.equal(commandFor({ type: 'pause' }), null);
});

test('a message the composer typed goes as typed, its images inline and its references for that computer to resolve', () => {
  const png = {
    mediaType: 'image/png' as const,
    data: 'aGk=',
    thumb: 'data:,t',
    original: '/Users/me/Library/shot.png',
  };
  const typed = {
    id: 'm-1',
    draft: 'look at @src/a.ts',
    images: [png],
    mentions: [worktreeMention('src/a.ts')],
    isCommand: false,
    typedSkills: [],
  };
  const send = {
    type: 'send',
    threadId: 'm1~t',
    text: 'resolved here',
    reason: '',
    steers: true,
    typed,
  } as const;
  assert.deepEqual(commandFor(send), {
    type: 'send',
    threadId: 'm1~t',
    text: 'look at @src/a.ts',
    images: [{ mediaType: 'image/png', data: 'aGk=', thumb: 'data:,t' }],
    mentions: [worktreeMention('src/a.ts')],
    steers: true,
  });
  assert.deepEqual(commandFor({ ...send, queuedId: 'm-1' }), {
    type: 'send',
    threadId: 'm1~t',
    text: '',
    queuedId: 'm-1',
  });
  // A card's send isn't typed: as its text when that's all it is, else not at all.
  const card = {
    type: 'send',
    threadId: 'm1~t',
    text: 'hi',
    reason: '',
  } as const;
  assert.deepEqual(commandFor(card), {
    type: 'send',
    threadId: 'm1~t',
    text: 'hi',
  });
  assert.equal(
    commandFor({ ...card, images: [{ mediaType: 'image/png', data: '' }] }),
    null,
  );
  assert.equal(commandFor({ ...card, skills: ['simplify'] }), null);
});

test('the composer’s controls, queue and cards become thread actions; an API key or a reset timer never cross', () => {
  const threadId = 'm1~t';
  const act = (action: Action) =>
    (commandFor(action) as { action?: unknown } | null)?.action ?? null;
  assert.deepEqual(commandFor({ type: 'queued-resume', threadId }), {
    type: 'thread-action',
    threadId,
    action: { type: 'queued-resume' },
  });
  assert.deepEqual(
    act({
      type: 'queued-add',
      threadId,
      message: {
        id: 'm-2',
        draft: 'later',
        images: [
          { mediaType: 'image/png', data: 'x', thumb: 't', original: '/a.png' },
        ],
        mentions: [],
        isCommand: false,
        typedSkills: [],
      },
    }),
    {
      type: 'queued-add',
      message: {
        draft: 'later',
        images: [{ mediaType: 'image/png', data: 'x', thumb: 't' }],
      },
    },
  );
  assert.deepEqual(act({ type: 'autofix-set', threadId, pr: 3, since: 1 }), {
    type: 'autofix-set',
    pr: 3,
    isOn: true,
  });
  assert.deepEqual(
    act({
      type: 'proposal-answer',
      threadId,
      proposalId: 'p',
      state: 'dismissed',
      reason: 'stale',
    }),
    { type: 'proposal-answer', proposalId: 'p', state: 'dismissed' },
  );
  assert.deepEqual(act({ type: 'resume', threadId }), { type: 'resume' });
  assert.equal(commandFor({ type: 'resume', threadId, onApiKey: true }), null);
  assert.equal(commandFor({ type: 'resume', threadId, atReset: true }), null);
  // Taking a steer back needs that computer's agent first (`unsteer`), never the bare store action.
  assert.equal(
    commandFor({ type: 'steer-take-back', threadId, id: 'm-1' }),
    null,
  );
});

test('referenced threads cross as that computer’s own ids', () => {
  const mention = { kind: 'thread' as const, id: 'm1~t2', title: 'Login' };
  assert.deepEqual(
    toWire({
      type: 'send',
      threadId: 'm1~t',
      text: 'see',
      mentions: [mention],
    }),
    {
      type: 'send',
      threadId: 't',
      text: 'see',
      mentions: [{ ...mention, id: 't2' }],
    },
  );
  assert.deepEqual(
    toWire({
      type: 'thread-action',
      threadId: 'm1~t',
      action: {
        type: 'queued-add',
        message: { draft: 'see', mentions: [mention] },
      },
    }),
    {
      type: 'thread-action',
      threadId: 't',
      action: {
        type: 'queued-add',
        message: { draft: 'see', mentions: [{ ...mention, id: 't2' }] },
      },
    },
  );
});

test('a message the PR tab or a line note writes for you is sent there as typed; anything else it says stays here', () => {
  assert.deepEqual(
    commandFor({
      type: 'say',
      threadId: 't',
      entry: { who: 'you', kind: 'message', text: 'Address this thread' },
    }),
    { type: 'send', threadId: 't', text: 'Address this thread' },
  );
  assert.equal(
    commandFor({
      type: 'say',
      threadId: 't',
      entry: { who: 'harness', kind: 'message', text: 'hi' },
    }),
    null,
  );
});
