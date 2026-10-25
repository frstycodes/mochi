import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { AgentEvent } from '../host/types/agent.ts';
import { redactSecrets } from '../settings/agentConfig.ts';
import type { Action, State } from '../store/index.tsx';
import { initialQueue, queueReducer } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { redactExport, type ReplayExport } from './export.ts';
import { embedReplay, isSelfContained } from './page.ts';
import {
  compact,
  linesFor,
  parseRecording,
  toLines,
  type ReplayLine,
  type ReplayStep,
} from './record.ts';
import { createReplayer, markers, stepsBy, timeline } from './rebuild.ts';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;
const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;
const live = (s: State, action: Action) =>
  queueReducer(threadsReducer(s, action), action);
const start = () =>
  live(
    {
      ...initialThreads(null, false),
      ...initialQueue(null, false),
      spaceId: 'latitude',
      views: {},
    } as unknown as State,
    {
      type: 'create',
      title: 'Add a usage chart',
      provider: 'claude',
      project: '/Users/me/dev/app',
      isLive: true,
    },
  );

/** Runs actions through the store the way the app does while capturing them as the recorder does; returns the end state and the file. */
function session(actions: (Action | ((s: State) => Action))[]) {
  let state = start();
  const id = state.threads.at(-1)!.id;
  const file: ReplayLine[] = [];
  let t = 1_000;
  for (const next of actions) {
    const action = typeof next === 'function' ? next(state) : next;
    t += 400;
    const captured = linesFor(state, action, t, () => file.length > 0);
    if (captured) file.push(...captured.lines);
    state = live(state, action);
  }
  return { state, id, file };
}

function events(id: string): (Action | ((s: State) => Action))[] {
  const agent = (
    event: DistributiveOmit<AgentEvent, 'threadId'>,
    ms?: number,
  ): Action => ({
    type: 'agent',
    event: { ...event, threadId: id } as AgentEvent,
    ms,
  });
  return [
    agent({ type: 'session', provider: 'claude', sessionId: 's-1' }),
    agent({ type: 'message', text: 'Looking at ', isDelta: false }, 1),
    agent({ type: 'message', text: 'the routes', isDelta: true }, 2),
    agent({ type: 'message', text: ' first.', isDelta: true }, 3),
    agent({
      type: 'plan',
      items: [
        { title: 'Read the routes', status: 'running' },
        { title: 'Draw the chart', status: 'pending' },
      ],
    }),
    agent(
      {
        type: 'tool',
        id: 't1',
        phase: 'start',
        text: 'Edit apps/web/usage.tsx',
      },
      4,
    ),
    agent({
      type: 'tool',
      id: 't1',
      phase: 'end',
      text: 'Edit apps/web/usage.tsx',
      files: ['apps/web/usage.tsx'],
    }),
    agent({
      type: 'approval',
      requestId: 'r1',
      kind: 'command',
      title: 'Run pnpm test',
      detail: 'pnpm test',
    }),
    (s) => ({
      type: 'answer',
      queueId: s.queue.find((q) => q.requestId === 'r1')!.id,
    }),
    { type: 'tick' },
    agent({ type: 'tool', id: 't2', phase: 'start', text: 'pnpm test' }),
    agent({
      type: 'tool',
      id: 't2',
      phase: 'end',
      text: 'pnpm test',
      exitCode: 1,
    }),
    agent({
      type: 'usage',
      inputTokens: 1200,
      outputTokens: 300,
      contextUsed: 5000,
      contextMax: 200000,
    }),
    agent({ type: 'turn-end', status: 'done' }),
    {
      type: 'send',
      threadId: id,
      text: 'also add a legend',
      drift: 'on-goal',
      reason: '',
    },
    agent({ type: 'message', text: 'Adding', isDelta: true }, 9),
    agent({ type: 'message', text: ' a legend.', isDelta: true }, 10),
    agent({
      type: 'plan',
      items: [
        { title: 'Read the routes', status: 'done' },
        { title: 'Draw the chart', status: 'done' },
      ],
    }),
    agent({ type: 'turn-end', status: 'failed', error: 'Process exited' }),
  ];
}

test('compaction folds each run of message deltas into one step and keeps the first stamps', () => {
  const step = (text: string, isDelta: boolean, t: number): ReplayStep => ({
    t,
    now: 1,
    action: {
      type: 'agent',
      event: { threadId: 'a', type: 'message', text, isDelta },
      ms: t,
    },
  });
  const usage: ReplayStep = {
    t: 5,
    now: 1,
    action: {
      type: 'agent',
      event: { threadId: 'a', type: 'usage', inputTokens: 1, outputTokens: 1 },
    },
  };
  const folded = compact([
    step('Hel', false, 1),
    step('lo', true, 2),
    step('!', true, 3),
    usage,
    step(' more', true, 6),
    step('New', false, 7),
    step(' one', true, 8),
  ]);
  assert.deepEqual(
    folded.map((s) =>
      s.action.type === 'agent' && s.action.event.type === 'message'
        ? [s.action.event.text, s.action.event.isDelta, s.t, s.action.ms]
        : s.action.type,
    ),
    [
      ['Hello!', false, 1, 1],
      'agent',
      [' more', true, 6, 6],
      ['New one', false, 7, 7],
    ],
  );
});

test('replaying a recording through the reducer ends on the live state', () => {
  const { state, id, file } = session(events(start().threads.at(-1)!.id));
  const recording = parseRecording(toLines(file))!;
  assert.ok(recording.steps.length < file.length - 1, 'deltas were folded');
  const stateAt = createReplayer(recording);
  const replayed = stateAt(recording.steps.length);
  // Through JSON like the saved file: keys set to undefined drop out on both sides.
  assert.deepEqual(
    plain(replayed.threads.find((t) => t.id === id)),
    plain(state.threads.find((t) => t.id === id)),
  );
  assert.deepEqual(
    plain(replayed.queue),
    plain(state.queue.filter((q) => q.threadId === id)),
  );
  assert.equal(
    stateAt(3).threads[0].activity.length < replayed.threads[0].activity.length,
    true,
    'scrubbing back rebuilds an earlier point',
  );
  assert.deepEqual(
    stateAt(recording.steps.length),
    replayed,
    'and forward again lands on the same state',
  );
});

test('markers, idle-gap skipping and the step clock', () => {
  const { file } = session(events(start().threads.at(-1)!.id));
  const recording = parseRecording(toLines(file))!;
  assert.deepEqual([...new Set(markers(recording).map((m) => m.kind))].sort(), [
    'approval',
    'edit',
    'error',
    'tool',
    'you',
  ]);
  const gappy = {
    ...recording,
    steps: recording.steps.map((s, i) => ({
      ...s,
      t: recording.base.t + i * 10_000,
    })),
  };
  assert.equal(
    timeline(gappy, false).at(-1),
    (recording.steps.length - 1) * 10_000,
  );
  assert.ok(timeline(gappy, true).at(-1)! < 10_000 * 2);
  assert.equal(stepsBy([0, 10, 10, 30], 10), 3);
  assert.equal(stepsBy([0, 10, 10, 30], -1), 0);
});

test('a line cut short by a quit keeps everything before it', () => {
  const { file } = session(events(start().threads.at(-1)!.id));
  const text = toLines(file);
  const recording = parseRecording(text.slice(0, text.length - 20))!;
  assert.equal(recording.steps.length, parseRecording(text)!.steps.length - 1);
  assert.equal(
    parseRecording('{"t":1,"now":1,"action":{}}\n'),
    null,
    'no base, no recording',
  );
});

test('only live threads are recorded', () => {
  const s = start();
  assert.equal(
    linesFor(
      { ...s, threads: s.threads.map((t) => ({ ...t, live: undefined })) },
      { type: 'send', threadId: s.threads[0].id, text: 'x', reason: '' },
      1,
      () => false,
    ),
    null,
  );
  assert.equal(
    linesFor(s, { type: 'tick' }, 1, () => false),
    null,
  );
});

test('redaction masks credentials in tool output and keeps the rest', () => {
  const output = [
    'export OPENAI_API_KEY=sk-proj-abcdefghijklmnop',
    'curl -H "Authorization: Bearer eyJhbGciOi.eyJzdWIi.c2lnbmF0dXJl" https://api.example.com',
    '{"token": "ghp_abcdefghijklmnop1234", "name": "mochi"}',
    'pushed with glpat-abcdefghij1234 to origin',
    'DEBUG=true PORT=3000 PATH=/usr/bin',
  ].join('\n');
  const redacted = redactSecrets(output);
  for (const secret of [
    'sk-proj-abcdefghijklmnop',
    'eyJhbGciOi',
    'ghp_abcdefghijklmnop1234',
    'glpat-abcdefghij1234',
  ])
    assert.ok(!redacted.includes(secret), `${secret} is masked`);
  for (const kept of [
    'https://api.example.com',
    '"name": "mochi"',
    'DEBUG=true PORT=3000 PATH=/usr/bin',
    'to origin',
  ])
    assert.ok(redacted.includes(kept), `${kept} stays`);
  assert.equal(redactSecrets(redacted), redacted, 'idempotent');

  const payload = redactExport({
    version: 1,
    recording: {
      base: { t: 1, now: 1, base: { thread: { id: 'a' } as never, queue: [] } },
      steps: [
        {
          t: 2,
          now: 1,
          action: {
            type: 'agent',
            event: {
              threadId: 'a',
              type: 'tool',
              id: 't',
              phase: 'end',
              text: 'echo $X',
              exitCode: 0,
              links: [{ url: 'https://x.dev?api_key=sk-abcdefghijkl' }],
            },
          },
        },
      ],
      isCapped: false,
    },
    checkpoints: [],
  } satisfies ReplayExport);
  assert.ok(!JSON.stringify(payload).includes('sk-abcdefghijkl'));
  assert.equal(payload.recording.steps[0].t, 2, 'numbers untouched');
});

test('the export page carries the payload in a script tag that text in the recording cannot close', () => {
  const html =
    '<!doctype html><html><head><title>Mochi</title><script type="module">/* "</body>" in a bundle */</script></head><body><div id="root"></div></body></html>';
  const { file } = session(events(start().threads.at(-1)!.id));
  const recording = parseRecording(toLines(file))!;
  recording.steps[1] = {
    ...recording.steps[1],
    action: {
      type: 'agent',
      event: {
        threadId: 'x',
        type: 'message',
        text: '</script><script>alert(1)</script>',
        isDelta: false,
      },
    },
  };
  const page = embedReplay(
    html,
    { version: 1, recording, checkpoints: [] },
    'Usage <chart>',
  );
  assert.match(page, /<title>Replay: Usage &lt;chart&gt;<\/title>/);
  assert.equal(
    page.match(/<\/script>/g)!.length,
    2,
    'only the bundle and the payload close a script',
  );
  const json = page.slice(
    page.indexOf('id="mochi-replay">') + 18,
    page.lastIndexOf('</script>'),
  );
  assert.equal(
    JSON.parse(json).recording.steps[1].action.event.text,
    '</script><script>alert(1)</script>',
  );
  assert.ok(page.endsWith('</body></html>'));
});

test('a dev server page is not exportable, the single-file build is, even though it inlines this check as text', () => {
  assert.equal(
    isSelfContained(
      '<head><script type="module" src="/@vite/client"></script></head>',
    ),
    false,
  );
  assert.equal(
    isSelfContained(
      `<head><script type="module">var check = ${isSelfContained.toString()}</script></head>`,
    ),
    true,
  );
});

test('a new session writes a fresh base, and the replay jumps to it before going on', () => {
  const id = start().threads.at(-1)!.id;
  const first = session(events(id).slice(0, 8));
  // Relaunch: the thread comes back from disk changed (detached, with a note), and the recorder has no base for it yet.
  let state: State = {
    ...first.state,
    threads: first.state.threads.map((t) =>
      t.id === id
        ? {
            ...t,
            live: { ...t.live!, isWorking: false, isDetached: true },
            activity: [
              ...t.activity,
              {
                at: t.activity.at(-1)!.at,
                who: 'harness' as const,
                kind: 'event' as const,
                text: 'Stopped when Mochi quit',
              },
            ],
          }
        : t,
    ),
  };
  const file = [...first.file];
  let isStarted = false;
  for (const action of [
    { type: 'send', threadId: id, text: 'keep going', reason: '' },
    {
      type: 'agent',
      event: { threadId: id, type: 'message', text: 'On it.', isDelta: false },
    },
  ] satisfies Action[]) {
    file.push(...linesFor(state, action, 99_000, () => isStarted)!.lines);
    isStarted = true;
    state = live(state, action);
  }
  const recording = parseRecording(toLines(file))!;
  assert.equal(
    recording.steps.filter((s) => s.action.type === 'restore').length,
    1,
  );
  assert.deepEqual(
    plain(createReplayer(recording)(recording.steps.length).threads),
    plain(state.threads.filter((t) => t.id === id)),
  );
});
