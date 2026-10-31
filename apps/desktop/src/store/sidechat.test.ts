import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { firstPrompt } from '../model.ts';
import type { Action, State } from './index.tsx';
import {
  chatFor,
  questionText,
  sidechatReducer,
  type Quote,
} from './sidechat.ts';
import { initialThreads } from './threads.ts';

const quote: Quote = {
  source: 'diff',
  label: 'apps/api/gateway.ts @@ -1,3 +1,4 @@',
  text: '+import { limits } from "./limits";',
};
const base = () =>
  ({
    ...initialThreads(),
    queue: [],
    panes: [],
    views: {},
    spaceId: 'latitude',
    sidechats: {},
  }) as unknown as State;
const run = (state: State, ...actions: Action[]) =>
  actions.reduce(sidechatReducer, state);
const thread = (state: State) => state.threads.find((t) => t.id === 'rl')!;

function asked() {
  const opened = run(base(), { type: 'sidechat-open', threadId: 'rl', quote });
  const tabId = opened.panes[0].activeTab;
  const at = { threadId: 'rl', tabId };
  const state = run(
    opened,
    { type: 'sidechat-ask', ...at, id: 'a1', text: 'Why Redis?' },
    { type: 'sidechat-stream', ...at, id: 'a1', text: 'Shared ' },
    { type: 'sidechat-stream', ...at, id: 'a1', text: 'state.', isDone: true },
  );
  return { opened, state, at };
}

test('opening from a selection opens a side chat tab with the quote waiting in its composer', () => {
  const { opened, at } = asked();
  assert.equal(opened.panes[0].isOpen, true);
  assert.equal(
    opened.panes[0].tabs.find((t) => t.id === at.tabId)?.kind,
    'sidechat',
  );
  assert.deepEqual(chatFor(opened, 'rl', at.tabId).draft, quote);
  const again = run(opened, { type: 'sidechat-open', threadId: 'rl' });
  assert.equal(
    again.panes[0].tabs.length,
    1,
    'reuses the existing side chat tab',
  );
});

test('asking and streaming never touch the thread', () => {
  const { opened, state, at } = asked();
  assert.equal(
    state.threads,
    opened.threads,
    'same reference: the thread slice was never rebuilt',
  );
  assert.deepEqual(thread(state), thread(base()));
  const [question, answer] = chatFor(state, 'rl', at.tabId).messages;
  assert.deepEqual(
    question.quote,
    quote,
    'the draft quote moves onto the question',
  );
  assert.equal(chatFor(state, 'rl', at.tabId).draft, undefined);
  assert.match(questionText(question), /^> \*\*Diff hunk\*\*/);
  assert.deepEqual([answer.text, answer.isStreaming], ['Shared state.', false]);
});

test('chats are per tab, and clearing one leaves the others', () => {
  const { state, at } = asked();
  const other = run(state, {
    type: 'sidechat-ask',
    threadId: 'rl',
    tabId: 'tab-9',
    id: 'b1',
    text: 'Other?',
  });
  const cleared = run(other, { type: 'sidechat-clear', ...at });
  assert.equal(chatFor(cleared, 'rl', at.tabId).messages.length, 0);
  assert.equal(chatFor(cleared, 'rl', 'tab-9').messages.length, 2);
});

test('promoting to the thread posts the answer as one message and leaves goal, steps and progress alone', () => {
  const { state, at } = asked();
  const promoted = run(state, {
    type: 'sidechat-promote',
    ...at,
    id: 'a1',
    to: 'message',
  });
  const t = thread(promoted);
  assert.equal(t.activity.length, thread(state).activity.length + 1);
  assert.deepEqual(t.activity.at(-1), {
    at: state.now,
    who: 'you',
    kind: 'message',
    text: 'From the side chat:\n\nShared state.',
  });
  assert.deepEqual(t.steps, thread(state).steps);
  assert.equal(
    chatFor(promoted, 'rl', at.tabId).messages[1].promotedTo,
    'message',
  );
});

test('promoting to a new thread creates it from the question and seeds the answer', () => {
  const { state, at } = asked();
  const promoted = run(state, {
    type: 'sidechat-promote',
    ...at,
    id: 'a1',
    to: 'thread',
  });
  assert.equal(promoted.threads.length, state.threads.length + 1);
  const created = promoted.threads.at(-1)!;
  assert.equal(firstPrompt(created), 'Why Redis?');
  assert.equal(
    created.activity.at(-1)?.text,
    'From the side chat:\n\nShared state.',
  );
  assert.deepEqual(thread(promoted).activity, thread(state).activity);
});

test('an answer still streaming cannot be promoted', () => {
  const opened = run(base(), { type: 'sidechat-open', threadId: 'rl' });
  const at = { threadId: 'rl', tabId: opened.panes[0].activeTab };
  const state = run(opened, {
    type: 'sidechat-ask',
    ...at,
    id: 'a1',
    text: 'Why?',
  });
  assert.equal(
    run(state, { type: 'sidechat-promote', ...at, id: 'a1', to: 'message' }),
    state,
  );
});

test('/side parks its question until asked, and the chat keeps its model through asking and clearing', () => {
  const opened = run(base(), {
    type: 'sidechat-open',
    threadId: 'rl',
    ask: 'Why Redis?',
  });
  const at = { threadId: 'rl', tabId: opened.panes[0].activeTab };
  assert.equal(chatFor(opened, 'rl', at.tabId).pending, 'Why Redis?');
  const asked = run(
    opened,
    {
      type: 'sidechat-model',
      ...at,
      model: { provider: 'codex', model: 'gpt-5.5' },
    },
    { type: 'sidechat-ask', ...at, id: 'a1', text: 'Why Redis?' },
  );
  assert.equal(chatFor(asked, 'rl', at.tabId).pending, undefined);
  assert.deepEqual(chatFor(asked, 'rl', at.tabId).model, {
    provider: 'codex',
    model: 'gpt-5.5',
  });
  assert.deepEqual(
    chatFor(run(asked, { type: 'sidechat-clear', ...at }), 'rl', at.tabId)
      .model,
    { provider: 'codex', model: 'gpt-5.5' },
  );
});
