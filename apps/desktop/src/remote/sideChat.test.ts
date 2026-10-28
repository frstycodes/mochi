import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vite-plus/test';
import { domainFrom, domainOf, project } from '@mochi/domain';
import { host } from '../host/index.ts';
import type { AgentAskEvent, AgentAskMessage } from '../host/types/agent.ts';
import type { MirrorFrame } from '../host/types/remote.ts';
import { DEFAULT_SETTINGS } from '../host/types/settings.ts';
import type { Action, State } from '../store/index.tsx';
import { MAX_MESSAGES, REMOTE_SIDE_CHAT_TAB } from '../store/remoteSideChat.ts';
import { mirrorState, reducer } from '../store/root.ts';
import { joinSaved, splitSaved, toSaved } from '../store/saved.ts';
import { chatFor, type Quote } from '../store/sidechat.ts';
import { commandFor } from './actions.ts';
import { runRemoteCommand } from './commands.ts';
import { toWire } from './ids.ts';
import { applyFrame, type Mirror } from './mirror.ts';
import { remoteSideChatBlocker } from './sideChat.ts';
import { hybridState, isScreenAction, localSlices } from './threadScope.ts';

afterEach(() => vi.restoreAllMocks());

const QUOTE: Quote = { source: 'file', label: 'src/a.ts:1–2', text: 'a()' };

/** The owning computer: one live thread, its side chat answered by a scripted agent; each thread file as its stream sends it. */
function owner() {
  let state = reducer(
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
  const threadId = state.threads[0].id;
  const dispatched: Action[] = [];
  const dispatch = (action: Action) => {
    dispatched.push(action);
    state = reducer(state, action);
  };
  let emit: (event: AgentAskEvent) => void = () => {};
  const asked: AgentAskMessage[][] = [];
  vi.spyOn(host.settings, 'get').mockImplementation(async () => ({
    ...DEFAULT_SETTINGS,
    sideChatModel: { provider: 'claude', model: 'haiku' },
  }));
  vi.spyOn(host.agent, 'onAskEvent').mockImplementation((listener) => {
    emit = listener;
    return () => {};
  });
  vi.spyOn(host.agent, 'ask').mockImplementation(async (_context, messages) => {
    asked.push(messages);
    return { id: `ask-${asked.length}` };
  });
  const files = () =>
    Object.entries(splitSaved(toSaved(state)).threads).map(
      ([id, json]): MirrorFrame => ({
        type: 'thread',
        threadId: id,
        saved: JSON.parse(json),
      }),
    );
  return {
    threadId,
    state: () => state,
    dispatched,
    asked,
    files,
    emit: (event: AgentAskEvent) => emit(event),
    run: (text: string, quote?: Quote) =>
      runRemoteCommand(
        { type: 'side-chat', threadId, text, ...(quote && { quote }) },
        { state, dispatch, deviceName: 'MacBook' },
      ),
  };
}

/** Every await in `askSideChat` is a mocked host call: a few turns of the microtask queue see it through to the next event. */
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

const follow = (frames: MirrorFrame[]) =>
  frames.reduce<Mirror>(
    (m, frame) => applyFrame('mac', m, frame),
    applyFrame('mac', undefined, { type: 'reset' }),
  );

test('the owner asks on its own agent into the thread’s remote side chat, and its thread file carries it while it streams', async () => {
  const m = owner();
  assert.deepEqual(await m.run('Why the retry?', QUOTE), { isOk: true });
  await settle();
  // Asked with Settings › Models' side chat model there, the quote above the question.
  assert.equal(m.asked.length, 1);
  assert.match(m.asked[0][0].text, /src\/a\.ts:1–2[\s\S]*Why the retry\?/);
  assert.deepEqual(
    m.dispatched.map((a) => a.type),
    ['remote-sidechat-ask'],
  );
  m.emit({ id: 'ask-1', type: 'text', text: 'Because ' });
  await settle();

  const streaming = m.state().remoteSideChats[m.threadId].messages;
  assert.equal(streaming.length, 2);
  assert.deepEqual(streaming[0].quote, QUOTE);
  assert.equal(streaming[1].text, 'Because ');
  assert.equal(streaming[1].isStreaming, true);
  // The window's own side chats never hold it.
  assert.deepEqual(m.state().sidechats, {});
  const [file] = m.files();
  assert.deepEqual((file as { saved: { sideChat: unknown } }).saved.sideChat, {
    messages: streaming,
  });

  // A second question waits for the answer.
  assert.deepEqual(await m.run('And?'), {
    isOk: false,
    error: 'The side chat is still answering',
  });

  m.emit({ id: 'ask-1', type: 'text', text: 'the token expired.' });
  m.emit({ id: 'ask-1', type: 'done', text: '' });
  await settle();
  const done = m.state().remoteSideChats[m.threadId].messages[1];
  assert.equal(done.text, 'Because the token expired.');
  assert.equal(done.isStreaming, false);

  // The next question goes with the history.
  await m.run('Thanks');
  await settle();
  assert.deepEqual(
    m.asked[1].map((x) => x.role),
    ['user', 'assistant', 'user'],
  );
});

test('a follower’s mirror shows it in its side chat tabs, under the thread’s machine-aware id, with this window’s quote kept', async () => {
  const m = owner();
  await m.run('Why the retry?');
  await settle();
  m.emit({ id: 'ask-1', type: 'text', text: 'Because.' });
  await settle();
  const mirror = follow(m.files());
  const id = `mac~${m.threadId}`;
  assert.deepEqual(
    mirror.state.sidechats[id][REMOTE_SIDE_CHAT_TAB].messages,
    m.state().remoteSideChats[m.threadId].messages,
  );

  const local = {
    ...mirrorState({
      version: 1,
      now: 1,
      seq: 1,
      threads: [],
      queue: [],
      checkpoints: {},
      checkpointSeq: 0,
      forks: {},
    }),
    panes: [
      {
        threadId: id,
        isOpen: true,
        activeTab: 'tab-1',
        tabs: [{ id: 'tab-1', kind: 'sidechat' }],
      },
    ],
    sidechats: {
      [id]: {
        'tab-1': {
          messages: [{ id: 'stale', role: 'user', text: 'asked here' }],
          draft: QUOTE,
        },
      },
      mine: { 'tab-9': { messages: [] } },
    },
  } as unknown as State;
  const hybrid = hybridState(localSlices(local), mirror.state);
  const chat = chatFor(hybrid, id, 'tab-1');
  assert.equal(chat.messages[1].text, 'Because.');
  assert.equal(chat.messages[1].isStreaming, true);
  assert.deepEqual(chat.draft, QUOTE);
  assert.equal(hybrid.sidechats.mine, local.sidechats.mine);

  // A thread there with no side chat yet shows an empty one, not what this window held.
  const empty = hybridState(localSlices(local), follow([]).state);
  assert.equal(chatFor(empty, id, 'tab-1').messages.length, 1);
  const none = hybridState(localSlices(local), {
    ...follow([]).state,
    threads: mirror.state.threads,
  });
  assert.deepEqual(chatFor(none, id, 'tab-1').messages, []);
});

test('Core folds the remote side chat like the window, and saves it in the thread’s file', () => {
  const m = owner();
  const ask: Action = {
    type: 'remote-sidechat-ask',
    threadId: m.threadId,
    id: 's1',
    text: 'Why?',
  };
  const core = project(domainOf(m.state()), ask);
  assert.deepEqual(
    core.remoteSideChats,
    reducer(m.state(), ask).remoteSideChats,
  );
  const saved = toSaved(core);
  const back = joinSaved({
    ...splitSaved(saved),
    threads: Object.values(splitSaved(saved).threads),
  } as never)!;
  assert.deepEqual(back.remoteSideChats, core.remoteSideChats);
  assert.deepEqual(domainFrom(back).remoteSideChats, core.remoteSideChats);
});

test('kept bounded, stopped when its window reloads, gone with its thread', () => {
  const m = owner();
  let s = m.state();
  for (let i = 0; i < MAX_MESSAGES; i++)
    s = reducer(s, {
      type: 'remote-sidechat-ask',
      threadId: m.threadId,
      id: `s${i}`,
      text: `q${i}`,
    });
  const kept = s.remoteSideChats[m.threadId].messages;
  assert.equal(kept.length, MAX_MESSAGES);
  assert.equal(kept.at(-1)!.id, `s${MAX_MESSAGES - 1}`);
  s = reducer(s, { type: 'window-loaded', threadIds: [] });
  assert.ok(!s.remoteSideChats[m.threadId].messages.some((x) => x.isStreaming));
  s = reducer(s, { type: 'delete', threadIds: [m.threadId] });
  assert.equal(s.remoteSideChats[m.threadId], undefined);
  // A thread it doesn't have asks nothing into the slice.
  const unknown = reducer(m.state(), {
    type: 'remote-sidechat-ask',
    threadId: 'nope',
    id: 'x',
    text: 'x',
  });
  assert.equal(unknown.remoteSideChats, m.state().remoteSideChats);
});

test('under a remote thread, asking and sending an answer on are commands to its computer; the quote clears here', () => {
  const ask: Action = {
    type: 'remote-sidechat-ask',
    threadId: 'mac~t1',
    id: 'side-1',
    text: 'Why?',
    quote: QUOTE,
  };
  assert.equal(isScreenAction(ask), false);
  assert.deepEqual(toWire(commandFor(ask) as never), {
    type: 'side-chat',
    threadId: 't1',
    text: 'Why?',
    quote: QUOTE,
  });
  const promote: Action = {
    type: 'send',
    threadId: 'mac~t1',
    text: 'From the side chat:\n\nBecause.',
    reason: '',
  };
  assert.deepEqual(toWire(commandFor(promote) as never), {
    type: 'send',
    threadId: 't1',
    text: 'From the side chat:\n\nBecause.',
  });
  assert.ok(
    isScreenAction({ type: 'sidechat-clear', threadId: 'mac~t1', tabId: 'a' }),
  );
});

test('asking needs operate and the computer online; reading needs neither', () => {
  const machine = {
    name: 'Studio',
    status: 'online' as const,
    scopes: ['read', 'operate'] as const,
  };
  assert.equal(
    remoteSideChatBlocker({ ...machine, scopes: [...machine.scopes] }),
    null,
  );
  assert.equal(
    remoteSideChatBlocker({ ...machine, scopes: ['read'] }),
    'Studio doesn’t let this computer ask its side chat',
  );
  assert.equal(
    remoteSideChatBlocker({ ...machine, status: 'offline', scopes: [] }),
    'Studio is offline',
  );
});

test('a side chat for a thread the owner doesn’t have is refused', async () => {
  const m = owner();
  const result = await runRemoteCommand(
    { type: 'side-chat', threadId: 'nope', text: 'Hi' },
    { state: m.state(), dispatch: () => {}, deviceName: 'MacBook' },
  );
  assert.equal(result.isOk, false);
});
