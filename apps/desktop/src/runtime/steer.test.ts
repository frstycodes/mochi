import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { queuedMessage, sendSteerNow } from '../chat/outbox.ts';
import { dueQueued } from './due.ts';
import type { Action, State } from '../store/index.tsx';
import { initialQueue } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { applyAgentEvent } from './apply.ts';
import { agentCalls } from './live.ts';

const base = () =>
  ({
    ...initialThreads(),
    ...initialQueue(),
    spaceId: 'latitude',
    views: {},
  }) as unknown as State;
const calls = (s: State, action: Action) =>
  agentCalls(s, action, () => threadsReducer(s, action));

function working() {
  const s = threadsReducer(base(), {
    type: 'create',
    title: 'fix the cookie',
    provider: 'claude',
    project: '/Users/me/dev/app',
    isLive: true,
  });
  const id = s.threads.at(-1)!.id;
  return {
    s,
    id,
    thread: (state: State) => state.threads.find((t) => t.id === id)!,
  };
}

const steer = (id: string, draft: string): Action & { type: 'send' } => {
  const typed = queuedMessage(draft, {
    mentions: [],
    isCommand: false,
    typedSkills: [],
  });
  return {
    type: 'send',
    threadId: id,
    text: draft,
    steers: true,
    typed,
  };
};

test('a message sent mid-turn waits outside the transcript, then lands after the step that read it, marked seen', () => {
  let { s, id, thread } = working();
  s = applyAgentEvent(s, {
    threadId: id,
    type: 'message',
    text: 'Running the suite',
    isDelta: false,
  });
  const send = steer(id, 'create a PR and merge');
  assert.deepEqual(calls(s, send), [
    {
      method: 'send',
      threadId: id,
      text: 'create a PR and merge',
      steer: true,
      steerId: send.typed!.id,
    },
  ]);
  s = threadsReducer(s, send);
  assert.equal(
    thread(s).activity.some(
      (e) => e.who === 'you' && e.text === 'create a PR and merge',
    ),
    false,
    'not in the transcript while unread',
  );
  assert.equal(thread(s).steering?.length, 1);

  s = applyAgentEvent(s, {
    threadId: id,
    type: 'message',
    text: ' before I wrap up.',
    isDelta: true,
  });
  s = applyAgentEvent(s, {
    threadId: id,
    type: 'tool',
    id: 't1',
    phase: 'start',
    text: 'Run pnpm test',
  });
  s = applyAgentEvent(s, {
    threadId: id,
    type: 'tool',
    id: 't1',
    phase: 'end',
    text: 'Run pnpm test',
  });
  s = applyAgentEvent(s, {
    threadId: id,
    type: 'steer-read',
    id: send.typed!.id,
  });
  s = applyAgentEvent(s, {
    threadId: id,
    type: 'message',
    text: 'Opening the PR.',
    isDelta: false,
  });

  const texts = thread(s)
    .activity.filter((e) => e.kind !== 'event')
    .map((e) => e.text);
  assert.deepEqual(
    texts.slice(-4),
    [
      'Running the suite before I wrap up.',
      'Run pnpm test',
      'create a PR and merge',
      'Opening the PR.',
    ],
    'text written before the read stays above, the reply after it below',
  );
  assert.equal(
    thread(s).activity.find((e) => e.text === 'create a PR and merge')?.isSeen,
    true,
  );
  assert.equal(thread(s).steering, undefined);
});

test('taking a message back removes it without a transcript entry or another agent call', () => {
  let { s, id, thread } = working();
  const send = steer(id, 'also bump the version');
  s = threadsReducer(s, send);
  const takeBack: Action = {
    type: 'steer-take-back',
    threadId: id,
    id: send.typed!.id,
  };
  assert.deepEqual(calls(s, takeBack), []);
  s = threadsReducer(s, takeBack);
  assert.equal(thread(s).steering, undefined);
  assert.equal(
    thread(s).activity.some((e) => e.text === 'also bump the version'),
    false,
  );
  s = applyAgentEvent(s, {
    threadId: id,
    type: 'steer-read',
    id: send.typed!.id,
  });
  assert.equal(
    thread(s).activity.some((e) => e.text === 'also bump the version'),
    false,
    'a late read of a taken-back message logs nothing',
  );
});

test("a report written while a message waited is superseded once the agent reads it, and isn't once you take it back", () => {
  const report = {
    decisions: [],
    left: [],
    question: 'Open a pull request?',
    by: 'claude' as const,
  };
  let { s, id, thread } = working();
  const read = steer(id, 'create a PR and merge');
  s = threadsReducer(s, read);
  s = threadsReducer(s, { type: 'report', threadId: id, report });
  assert.equal(
    thread(s).report?.isSuperseded,
    undefined,
    'not yet: the agent may never read it',
  );
  s = applyAgentEvent(s, {
    threadId: id,
    type: 'steer-read',
    id: read.typed!.id,
  });
  assert.equal(thread(s).report?.isSuperseded, true);

  const taken = steer(id, 'never mind');
  s = threadsReducer(s, taken);
  s = threadsReducer(s, { type: 'report', threadId: id, report });
  s = threadsReducer(s, {
    type: 'steer-take-back',
    threadId: id,
    id: taken.typed!.id,
  });
  assert.equal(thread(s).report?.isSuperseded, undefined);
});

test('read after its turn ended, a message starts the next turn', () => {
  let { s, id, thread } = working();
  const send = steer(id, 'and the docs');
  s = threadsReducer(s, send);
  s = applyAgentEvent(s, { threadId: id, type: 'turn-end', status: 'done' });
  assert.equal(thread(s).live?.isWorking, false);
  s = applyAgentEvent(s, {
    threadId: id,
    type: 'steer-read',
    id: send.typed!.id,
  });
  assert.equal(thread(s).live?.isWorking, true);
  assert.equal(thread(s).activity.at(-1)?.text, 'and the docs');
});

/** Dispatches like the store: each action's agent calls are logged against the state before it applies. */
function store(start: State) {
  let s = start;
  const agent: unknown[] = [];
  const dispatch = (action: Action) => {
    agent.push(...calls(s, action));
    s = threadsReducer(s, action);
  };
  return {
    dispatch,
    agent,
    get: () => s,
    apply: (fn: (s: State) => State) => (s = fn(s)),
  };
}

test('Send now takes the message back with the other unread ones, interrupts, and sends it first without pausing the queue', async () => {
  const { s: start, id, thread } = working();
  const [a, b, c] = [
    'run the linter',
    'stop and answer this',
    'then the docs',
  ].map((draft) => steer(id, draft));
  let s = [a, b, c].reduce(threadsReducer, start);
  s = threadsReducer(s, {
    type: 'queued-add',
    threadId: id,
    message: queuedMessage('later', {
      mentions: [],
      isCommand: false,
      typedSkills: [],
    }),
  });
  const st = store(s);
  const unsteered: string[] = [];
  const isSent = await sendSteerNow(
    st.dispatch,
    thread(st.get()),
    b.typed!.id,
    async (_, steerId) => (unsteered.push(steerId), true),
  );

  assert.equal(isSent, true);
  assert.deepEqual(
    unsteered,
    [b, a, c].map((m) => m.typed!.id),
  );
  assert.deepEqual(st.agent, [{ method: 'interrupt', threadId: id }]);
  assert.equal(thread(st.get()).steering, undefined);
  assert.deepEqual(
    thread(st.get()).queued?.map((m) => m.draft),
    ['stop and answer this', 'run the linter', 'then the docs', 'later'],
  );

  st.apply((s) =>
    applyAgentEvent(s, {
      threadId: id,
      type: 'turn-end',
      status: 'interrupted',
    }),
  );
  assert.equal(
    thread(st.get()).queuePause,
    undefined,
    'the stop you asked for does not pause the queue',
  );
  assert.equal(thread(st.get()).isInterruptedToSend, undefined);
  assert.equal(dueQueued(st.get())[0]?.message.id, b.typed!.id);

  const due = dueQueued(st.get())[0].message;
  st.apply((s) =>
    threadsReducer(s, {
      type: 'send',
      threadId: id,
      text: due.draft,
      steers: true,
      queuedId: due.id,
      typed: due,
    }),
  );
  assert.equal(
    thread(st.get()).activity.at(-1)?.wasQueued,
    undefined,
    'sent now, not marked queued',
  );
  st.apply((s) =>
    applyAgentEvent(s, {
      threadId: id,
      type: 'turn-end',
      status: 'interrupted',
    }),
  );
  assert.equal(
    thread(st.get()).queuePause,
    'interrupted',
    'a later stop pauses it as usual',
  );
});

test('Send now on a message the agent reads while the click is in flight neither sends it again nor interrupts', async () => {
  const { s: start, id, thread } = working();
  const send = steer(id, 'create a PR and merge');
  const st = store(threadsReducer(start, send));
  const isSent = await sendSteerNow(
    st.dispatch,
    thread(st.get()),
    send.typed!.id,
    async () => {
      st.apply((s) =>
        applyAgentEvent(s, {
          threadId: id,
          type: 'steer-read',
          id: send.typed!.id,
        }),
      );
      return false;
    },
  );

  assert.equal(isSent, false);
  assert.deepEqual(st.agent, []);
  assert.equal(thread(st.get()).queued?.length ?? 0, 0);
  assert.equal(
    thread(st.get()).activity.filter((e) => e.text === 'create a PR and merge')
      .length,
    1,
  );
});

test('Send now whose turn ended while the click was in flight leaves the next turn running and sends after it', async () => {
  const { s: start, id, thread } = working();
  const [a, b] = [steer(id, 'stop and answer this'), steer(id, 'and the docs')];
  const st = store([a, b].reduce(threadsReducer, start));
  await sendSteerNow(
    st.dispatch,
    thread(st.get()),
    a.typed!.id,
    async (_, steerId) => {
      if (steerId === a.typed!.id) return true;
      // Taking back the second one loses to the agent: the turn ended and reading it started the next.
      st.apply((s) =>
        applyAgentEvent(s, { threadId: id, type: 'turn-end', status: 'done' }),
      );
      st.apply((s) =>
        applyAgentEvent(s, {
          threadId: id,
          type: 'steer-read',
          id: b.typed!.id,
        }),
      );
      return false;
    },
  );

  assert.deepEqual(
    st.agent,
    [],
    'the turn the agent started with the other message keeps going',
  );
  assert.equal(thread(st.get()).live?.isWorking, true);
  assert.deepEqual(
    thread(st.get()).queued?.map((m) => m.draft),
    ['stop and answer this'],
  );
  st.apply((s) =>
    applyAgentEvent(s, { threadId: id, type: 'turn-end', status: 'done' }),
  );
  assert.equal(dueQueued(st.get())[0]?.message.id, a.typed!.id);
});
