import assert from 'node:assert/strict';
import { afterEach, onTestFinished, test, vi } from 'vite-plus/test';
import { host } from '../host/index.ts';
import type { MachineCatalog } from '../host/types/remote.ts';
import type { QueueItem } from '../model.ts';
import type { Action, State } from '../store/index.tsx';
import { initialNotifications } from '../notify/slice.ts';
import { initialQueue } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { runRemoteCommand } from './commands.ts';
import { closeIdleShells, shellOf, terminalCore } from './terminals.ts';
import { markOwnAnswer } from './answers.ts';

afterEach(() => vi.restoreAllMocks());

function machine() {
  const base = {
    ...initialThreads(undefined, false),
    ...initialQueue(undefined, false),
    ...initialNotifications(),
    spaceId: 'latitude',
    views: {},
  } as unknown as State;
  const s = threadsReducer(base, {
    type: 'create',
    title: 'reply with ok',
    provider: 'claude',
    project: null,
    isLive: true,
  });
  const threadId = s.threads.at(-1)!.id;
  // Its first turn is over: the agent is idle.
  const threads = s.threads.map((t) =>
    t.id === threadId
      ? { ...t, live: { ...t.live!, isWorking: false, cwd: '/work/reply' } }
      : t,
  );
  const item = (id: string) =>
    ({
      id,
      threadId,
      kind: 'approval',
      title: 'Run pnpm test',
      detail: '',
      requestId: id,
    }) as QueueItem;
  return {
    state: { ...s, threads, queue: [item('q-1'), item('q-2')] },
    threadId,
  };
}

// Settings › General › While the agent is working: queue, as Core's context holds it.
const device = (state: State, deviceName: string, dispatched: Action[]) => ({
  state: {
    ...state,
    context: {
      ...state.context,
      prefs: { ...state.context.prefs, whileWorking: 'queue' as const },
    },
  },
  dispatch: (a: Action) => void dispatched.push(a),
  deviceName,
});

test('the first answer to a queue item wins; a later one, even against the same stale store, hears where it went', async () => {
  const { state } = machine();
  const dispatched: Action[] = [];
  assert.deepEqual(
    await runRemoteCommand(
      { type: 'resolve', queueId: 'q-1' },
      device(state, 'Laptop', dispatched),
    ),
    { isOk: true },
  );
  assert.deepEqual(
    await runRemoteCommand(
      { type: 'resolve', queueId: 'q-1', answers: [['no']] },
      device(state, 'Desk PC', dispatched),
    ),
    { isOk: false, error: 'Already answered on Laptop' },
  );
  assert.deepEqual(
    dispatched,
    [{ type: 'answer', queueId: 'q-1', answers: undefined }],
    'only the first answer reached the store',
  );
});

test('an answer given on the machine itself wins over a device', async () => {
  const { state } = machine();
  // The machine's own Queue answering (`storeDispatch`).
  markOwnAnswer('q-2');
  const dispatched: Action[] = [];
  const result = await runRemoteCommand(
    { type: 'resolve', queueId: 'q-2' },
    device(state, 'Laptop', dispatched),
  );
  assert.equal(result.isOk, false);
  assert.match(!result.isOk ? result.error : '', /^Already answered on /);
  assert.deepEqual(dispatched, []);
});

test('an item that is gone, a missing thread and an idle agent are refused without touching the store', async () => {
  const { state, threadId } = machine();
  const dispatched: Action[] = [];
  assert.deepEqual(
    await runRemoteCommand(
      { type: 'resolve', queueId: 'q-gone' },
      device(state, 'Laptop', dispatched),
    ),
    { isOk: false, error: 'This is no longer waiting for an answer' },
  );
  assert.deepEqual(
    await runRemoteCommand(
      { type: 'interrupt', threadId: 'nope' },
      device(state, 'Laptop', dispatched),
    ),
    { isOk: false, error: 'No such thread on this machine' },
  );
  assert.deepEqual(
    await runRemoteCommand(
      { type: 'interrupt', threadId },
      device(state, 'Laptop', dispatched),
    ),
    { isOk: false, error: 'The agent isn’t working' },
  );
  assert.deepEqual(dispatched, []);
});

test('a device answers only approvals and questions, and a question needs answers', async () => {
  const { state, threadId } = machine();
  const review = {
    id: 'q-review',
    threadId,
    kind: 'review',
    title: 'Review',
    detail: '',
  } as QueueItem;
  const question = {
    id: 'q-ask',
    threadId,
    kind: 'question',
    title: 'Which?',
    detail: '',
    requestId: 'ask',
  } as QueueItem;
  const withItems = { ...state, queue: [...state.queue, review, question] };
  const dispatched: Action[] = [];
  assert.deepEqual(
    await runRemoteCommand(
      { type: 'resolve', queueId: 'q-review' },
      device(withItems, 'Laptop', dispatched),
    ),
    {
      isOk: false,
      error: 'Only approvals and questions can be answered from a device',
    },
  );
  assert.deepEqual(
    await runRemoteCommand(
      { type: 'resolve', queueId: 'q-ask' },
      device(withItems, 'Laptop', dispatched),
    ),
    { isOk: false, error: 'A question needs answers' },
  );
  assert.deepEqual(dispatched, []);
  assert.deepEqual(
    await runRemoteCommand(
      { type: 'resolve', queueId: 'q-ask', answers: [['A']] },
      device(withItems, 'Laptop', dispatched),
    ),
    { isOk: true },
  );
});

test('send goes out now to an idle agent and queues behind a working one, like the composer', async () => {
  const { state, threadId } = machine();
  const idle: Action[] = [];
  await runRemoteCommand(
    { type: 'send', threadId, text: 'hello' },
    device(state, 'Laptop', idle),
  );
  assert.deepEqual(
    idle.map((a) => a.type),
    ['send'],
  );
  const working = {
    ...state,
    threads: state.threads.map((t) =>
      t.id === threadId ? { ...t, live: { ...t.live!, isWorking: true } } : t,
    ),
  };
  const queued: Action[] = [];
  await runRemoteCommand(
    { type: 'send', threadId, text: 'next' },
    device(working, 'Laptop', queued),
  );
  assert.deepEqual(
    queued.map((a) => a.type),
    ['queued-add'],
  );
});

test('operate and manage commands dispatch the same actions the UI does, and the reducer applies them', async () => {
  const { state, threadId } = machine();
  const dispatched: Action[] = [];
  let handOff = () => {};
  const handedOff = new Promise<void>((resolve) => (handOff = resolve));
  const env = {
    ...device(state, 'Laptop', dispatched),
    dispatch: (a: Action) =>
      void (dispatched.push(a), a.type === 'handoff' && handOff()),
  };
  for (const command of [
    { type: 'rename', threadId, title: 'Ship the login fix' },
    { type: 'edit-goal', threadId, goal: 'Login works with SSO' },
    { type: 'pin', threadId, isPinned: true },
    { type: 'fork', threadId, point: { kind: 'message', index: 0 } },
    // A live thread handed off starts working again, so settling comes after.
    { type: 'handoff', threadId, to: 'codex' },
    { type: 'settle', threadId, isSettled: true },
    {
      type: 'create',
      title: 'Write the changelog',
      provider: 'codex',
      project: null,
    },
  ] as const) {
    assert.deepEqual(
      await runRemoteCommand(command, env),
      { isOk: true },
      command.type,
    );
    // The handoff drafts its prompt first, as a click here does; it lands before the next command.
    if (command.type === 'handoff') await handedOff;
  }
  assert.deepEqual(
    dispatched.map((a) => a.type),
    [
      'rename',
      'edit-goal',
      'reorder',
      'fork',
      'handoff-draft',
      'handoff',
      'settle',
      'create',
    ],
  );

  const applied = dispatched.reduce(
    (s, a) => threadsReducer(s, a),
    state as State,
  );
  const thread = applied.threads.find((t) => t.id === threadId)!;
  assert.equal(thread.title, 'Ship the login fix');
  assert.equal(thread.goal, 'Login works with SSO');
  assert.equal(thread.status, 'settled');
  assert.equal(thread.providers[0], 'codex');
  assert.ok(
    applied.threads.some((t) => t.title === 'Write the changelog'),
    'the new thread exists',
  );
  const create = dispatched.at(-1) as Extract<Action, { type: 'create' }>;
  assert.equal(
    create.isBackground,
    true,
    'a device never moves the view on this machine',
  );
});

test('commands that would change nothing say so or do nothing', async () => {
  const { state, threadId } = machine();
  const dispatched: Action[] = [];
  const env = device(state, 'Laptop', dispatched);
  assert.deepEqual(
    await runRemoteCommand({ type: 'handoff', threadId, to: 'claude' }, env),
    { isOk: false, error: 'Already on Claude' },
  );
  assert.deepEqual(
    await runRemoteCommand({ type: 'pin', threadId, isPinned: false }, env),
    { isOk: true },
  );
  assert.deepEqual(
    await runRemoteCommand({ type: 'settle', threadId, isSettled: false }, env),
    { isOk: true },
  );
  assert.deepEqual(
    await runRemoteCommand(
      { type: 'rename', threadId: 'nope', title: 'x' },
      env,
    ),
    { isOk: false, error: 'No such thread on this machine' },
  );
  assert.deepEqual(dispatched, []);
});

test('delete, a line comment and a rewind dispatch what the UI does for them', async () => {
  const { state, threadId } = machine();
  const dispatched: Action[] = [];
  const env = device(state, 'Laptop', dispatched);
  assert.deepEqual(
    await runRemoteCommand(
      {
        type: 'comment',
        threadId,
        path: 'src/a.ts',
        side: 'deletions',
        line: 4,
        text: 'Why?',
      },
      env,
    ),
    { isOk: true },
  );
  assert.deepEqual(await runRemoteCommand({ type: 'delete', threadId }, env), {
    isOk: true,
  });
  assert.deepEqual(dispatched, [
    {
      type: 'say',
      threadId,
      entry: {
        who: 'you',
        kind: 'message',
        text: 'Review note on `src/a.ts, removed line 4`\n\nWhy?',
      },
    },
    { type: 'delete', threadIds: [threadId] },
  ]);
  // No checkpoint yet: nothing to rewind to, and nothing dispatched.
  assert.deepEqual(
    await runRemoteCommand(
      {
        type: 'rewind',
        threadId,
        point: { kind: 'checkpoint', n: 3 },
        mode: 'chat',
      },
      device(state, 'Laptop', []),
    ),
    {
      isOk: false,
      error: 'There is nothing to rewind to there',
    },
  );
});

test('code commands make the Changes and Files tabs’ host calls in the thread’s folder, resolved on the machine', async () => {
  const { state, threadId } = machine();
  const env = device(state, 'Laptop', []);
  const diff = { branch: 'b', base: 'main', files: [] };
  const diffCall = vi
    .spyOn(host.git, 'diff')
    .mockImplementation(async () => diff);
  const stage = vi.spyOn(host.git, 'stage').mockImplementation(async () => {});
  vi.spyOn(host.fs, 'list').mockImplementation(async () =>
    Array.from({ length: 10_001 }, (_, i) => `f${i}.ts`),
  );
  const read = vi
    .spyOn(host.fs, 'read')
    .mockImplementation(async (_root: string, path: string) =>
      path.endsWith('.png')
        ? { kind: 'binary', bytes: new Uint8Array(1), mtimeMs: 0 }
        : { kind: 'text', text: 'hi', mtimeMs: 0 },
    );

  assert.deepEqual(
    await runRemoteCommand(
      { type: 'diff', threadId, scope: 'uncommitted' },
      env,
    ),
    { isOk: true, data: diff },
  );
  assert.deepEqual(diffCall.mock.calls[0], [
    '/work/reply',
    'uncommitted',
    undefined,
  ]);
  await runRemoteCommand(
    {
      type: 'change',
      threadId,
      action: 'stage',
      target: { path: 'a.ts', staged: false },
    },
    env,
  );
  assert.deepEqual(stage.mock.calls[0], [
    '/work/reply',
    { path: 'a.ts', staged: false },
  ]);
  const files = await runRemoteCommand({ type: 'files', threadId }, env);
  assert.ok(
    files.isOk &&
      files.data &&
      'paths' in files.data &&
      files.data.paths.length === 10_000 &&
      files.data.isTruncated,
    'capped',
  );
  assert.deepEqual(
    await runRemoteCommand({ type: 'read-file', threadId, path: 'a.ts' }, env),
    { isOk: true, data: { text: 'hi' } },
  );
  assert.deepEqual(read.mock.calls[0], ['/work/reply', 'a.ts']);
  assert.deepEqual(
    await runRemoteCommand(
      { type: 'read-file', threadId, path: 'logo.png' },
      env,
    ),
    {
      isOk: false,
      error: 'This is a binary file; open it on that computer',
    },
  );

  const folderless = {
    ...state,
    threads: state.threads.map((th) => ({ ...th, live: undefined })),
  };
  assert.deepEqual(
    await runRemoteCommand(
      { type: 'diff', threadId, scope: 'branch' },
      device(folderless, 'Laptop', []),
    ),
    {
      isOk: false,
      error: 'This thread has no folder on this machine',
    },
  );
});

test('a device shell runs in the thread’s folder and is that thread’s alone; its output goes to Core in order', async () => {
  const T0 = 1_700_000_000_000;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  onTestFinished(() => void vi.useRealTimers());
  const { state, threadId } = machine();
  const env = device(state, 'Laptop', []);
  vi.spyOn(host.ports, 'allocate').mockImplementation(async () => 4100);
  const spawn = vi
    .spyOn(host.pty, 'spawn')
    .mockImplementation(async () => ({ id: 'pty-remote-1' }));
  const write = vi.spyOn(host.pty, 'write').mockImplementation(async () => {});
  let emit: (event: { id: string; data: string }) => void = () => {};
  vi.spyOn(host.pty, 'onData').mockImplementation(
    (listener: typeof emit) => ((emit = listener), () => {}),
  );
  vi.spyOn(host.pty, 'onExit').mockImplementation(() => () => {});
  vi.spyOn(host.pty, 'kill').mockImplementation(async () => {});
  const core: [string, unknown][] = [];
  let isWatched = false;
  vi.spyOn(terminalCore, 'call').mockImplementation(
    async (tag: string, payload: unknown) => (
      core.push([tag, payload]),
      tag === 'terminal.watched' ? isWatched : undefined
    ),
  );

  const opened = await runRemoteCommand(
    { type: 'terminal-open', threadId, cols: 80, rows: 24 },
    env,
  );
  assert.deepEqual(opened, {
    isOk: true,
    data: { terminalId: 'pty-remote-1' },
  });
  assert.deepEqual(spawn.mock.calls[0], [
    { cwd: '/work/reply', cols: 80, rows: 24, port: 4100, threadId },
  ]);
  emit({ id: 'pty-remote-1', data: 'hello ' });
  emit({ id: 'pty-remote-1', data: 'world' });
  assert.deepEqual(core, [
    ['terminal.open', { terminalId: 'pty-remote-1', threadId }],
    ['terminal.feed', { terminalId: 'pty-remote-1', data: 'hello ' }],
    ['terminal.feed', { terminalId: 'pty-remote-1', data: 'world' }],
  ]);
  await runRemoteCommand(
    {
      type: 'terminal-write',
      threadId,
      terminalId: 'pty-remote-1',
      data: 'ls\r',
    },
    env,
  );
  assert.deepEqual(write.mock.calls[0], ['pty-remote-1', 'ls\r']);

  const other = threadsReducer(state, {
    type: 'create',
    title: 'other',
    provider: 'claude',
    project: null,
    isLive: true,
  });
  const otherId = other.threads.at(-1)!.id;
  assert.deepEqual(
    await runRemoteCommand(
      {
        type: 'terminal-write',
        threadId: otherId,
        terminalId: 'pty-remote-1',
        data: 'x',
      },
      device(
        {
          ...other,
          threads: other.threads.map((th) => ({
            ...th,
            live: { ...th.live!, cwd: '/w' },
          })),
        },
        'Laptop',
        [],
      ),
    ),
    { isOk: false, error: 'That terminal is closed' },
  );
  assert.deepEqual(
    await runRemoteCommand(
      {
        type: 'terminal-write',
        threadId,
        terminalId: 'a-local-pty',
        data: 'x',
      },
      env,
    ),
    { isOk: false, error: 'That terminal is closed' },
    'the machine’s own terminals are out of reach',
  );
  await closeIdleShells(T0 + 30_000);
  assert.equal(
    shellOf('pty-remote-1', threadId)?.threadId,
    threadId,
    'a shell in use stays open',
  );
  isWatched = true;
  await closeIdleShells(T0 + 61_000);
  assert.ok(
    shellOf('pty-remote-1', threadId),
    'a shell a device is watching stays open',
  );
  isWatched = false;
  await closeIdleShells(T0 + 200_000);
  assert.equal(
    shellOf('pty-remote-1', threadId),
    undefined,
    'a device that left without closing it',
  );
  assert.deepEqual(core.at(-1), [
    'terminal.close',
    { terminalId: 'pty-remote-1' },
  ]);
});

test('a new thread starts only in a project the machine listed, by its id, with the controls and images sent', async () => {
  const { state } = machine();
  const withProject = {
    ...state,
    threads: [
      ...state.threads,
      {
        ...state.threads[0],
        id: 'p',
        spaceId: state.spaceId,
        repo: { project: 'api', branch: 'main', path: '/src/api' },
      },
    ],
  };
  vi.spyOn(host.settings, 'get').mockImplementation(
    async () =>
      ({
        harnesses: { claude: { model: 'opus' }, codex: { model: '' } },
      }) as never,
  );
  vi.spyOn(host.agent, 'models').mockImplementation(async () => []);
  const listed = await runRemoteCommand(
    { type: 'catalog' },
    device(withProject, 'Laptop', []),
  );
  assert.ok(listed.isOk);
  const catalog = listed.data as MachineCatalog;
  const [api] = catalog.projects;
  assert.equal(
    api.name,
    'api',
    'the thread’s folder was taken into the registry',
  );
  assert.notEqual(api.ref, '/src/api', 'a device gets an id, never the path');
  assert.deepEqual(catalog.defaults, { claude: 'opus', codex: '' });

  const dispatched: Action[] = [];
  for (const project of ['/etc', '/src/api'])
    assert.deepEqual(
      await runRemoteCommand(
        { type: 'create', title: 'x', provider: 'claude', project },
        device(withProject, 'Laptop', dispatched),
      ),
      {
        isOk: false,
        error: 'That project isn’t on this machine',
      },
    );
  const controls = {
    model: 'gpt-6',
    effort: 'high',
    speed: '',
    access: 'Auto',
  } as const;
  const images = [
    {
      mediaType: 'image/png' as const,
      data: 'iVBOR',
      thumb: 'data:image/png;base64,iVBOR',
    },
  ];
  const sent = await runRemoteCommand(
    {
      type: 'create',
      title: 'Fix it',
      provider: 'codex',
      project: api.ref,
      controls,
      images,
    },
    device(withProject, 'Laptop', dispatched),
  );
  assert.deepEqual(sent, { isOk: true });
  const create = dispatched[0] as Extract<Action, { type: 'create' }>;
  assert.equal(
    create.project,
    '/src/api',
    'the machine resolves the id to its own folder',
  );
  assert.deepEqual(
    create.controls,
    controls,
    'model, effort, speed and permissions as picked on the device',
  );
  assert.deepEqual(create.images, images);
});

test('a device’s clone lands in this machine’s projects folder, and its failure comes back as git said it', async () => {
  const { state } = machine();
  const clone = vi
    .spyOn(host.projects, 'clone')
    .mockImplementation(async (_space, source) => {
      if ('url' in source && source.url.includes('missing'))
        throw new Error('fatal: repository not found');
      return {
        id: 'p1',
        name: 'repo',
        path: '/home/me/dev/repo',
        origin: 'gitlab.com/me/repo',
        addedAt: 1,
        iconMode: 'auto',
        icon: null,
        favicon: null,
        isMissing: false,
      };
    });
  const added = await runRemoteCommand(
    {
      type: 'clone-project',
      source: { url: 'https://gitlab.com/me/repo.git' },
    },
    device(state, 'Laptop', []),
  );
  assert.deepEqual(added, { isOk: true, data: { ref: 'p1', name: 'repo' } });
  assert.equal(
    clone.mock.calls[0][2]?.parentDir,
    '~/dev',
    'Settings › Projects folder, picked here',
  );
  assert.deepEqual(
    await runRemoteCommand(
      {
        type: 'clone-project',
        source: { url: 'https://gitlab.com/me/missing.git' },
      },
      device(state, 'Laptop', []),
    ),
    { isOk: false, error: 'fatal: repository not found' },
  );
});

test('settings a device writes stay on the machine; Devices and the demo switch can’t be changed from one', async () => {
  const { state } = machine();
  vi.spyOn(host.settings, 'get').mockImplementation(
    async () =>
      ({ harnesses: { claude: { model: '' }, codex: { model: '' } } }) as never,
  );
  const env = device(state, 'Laptop', []);
  assert.deepEqual(
    await runRemoteCommand({ type: 'setting', key: 'nope', value: 'x' }, env),
    { isOk: false, error: 'No setting nope' },
  );
  const remoteRow = await runRemoteCommand(
    { type: 'setting', key: 'remoteEnabled', value: 'false' },
    env,
  );
  assert.match(
    !remoteRow.isOk ? remoteRow.error : '',
    /can only be changed on that computer$/,
  );
  const demo = await runRemoteCommand(
    { type: 'setting', key: 'demoData', value: 'true' },
    env,
  );
  assert.match(
    !demo.isOk ? demo.error : '',
    /can only be changed on that computer$/,
  );
});

test('a device reads the settings it may change, as this machine’s Settings reads them', async () => {
  const { state } = machine();
  const result = await runRemoteCommand(
    { type: 'settings' },
    device(state, 'Laptop', []),
  );
  assert.ok(result.isOk && result.data && !('paths' in result.data));
  const values = result.data as Record<string, string>;
  assert.equal(typeof values.diffStyle, 'string');
  assert.equal(
    typeof values['claude.model'],
    'string',
    'main’s settings are read too',
  );
  assert.equal(
    typeof values.shell,
    'string',
    'machine-specific rows are readable to change there',
  );
  assert.equal(
    'theme' in values || 'remoteEnabled' in values || 'demoData' in values,
    false,
    'what only changes on the machine isn’t offered',
  );
});

test('a pin with an order lands where the device put it among all computers’ pins; Pinned full refuses', async () => {
  const { state, threadId } = machine();
  const dispatched: Action[] = [];
  assert.deepEqual(
    await runRemoteCommand(
      { type: 'pin', threadId, isPinned: true, order: 150 },
      device(state, 'Laptop', dispatched),
    ),
    { isOk: true },
  );
  assert.deepEqual(dispatched, [{ type: 'pin-at', threadId, order: 150 }]);
  const pinned = threadsReducer(state, dispatched[0]).threads.find(
    (t) => t.id === threadId,
  )!;
  assert.deepEqual([pinned.orbitSlot, pinned.pinOrder], [1, 150]);

  const full = {
    ...state,
    threads: [
      ...state.threads,
      ...[1, 2, 3, 5, 7].map((slot, i) => ({
        ...state.threads[0],
        id: `p${i}`,
        orbitSlot: slot,
      })),
    ],
  };
  assert.deepEqual(
    await runRemoteCommand(
      { type: 'pin', threadId, isPinned: true, order: 1 },
      device(full, 'Laptop', []),
    ),
    { isOk: false, error: 'Pinned is full; unpin a thread first' },
  );
});

test('seen marks the thread and its asks read on the machine, and refuses a thread it doesn’t have', async () => {
  const { state, threadId } = machine();
  const dispatched: Action[] = [];
  assert.deepEqual(
    await runRemoteCommand(
      { type: 'seen', threadId },
      device(state, 'Laptop', dispatched),
    ),
    { isOk: true },
  );
  assert.deepEqual(dispatched, [
    { type: 'seen', threadId, queueIds: undefined },
  ]);
  const after = threadsReducer(state, dispatched[0]);
  assert.equal(
    after.threads.find((t) => t.id === threadId)?.seenActivity,
    after.threads.find((t) => t.id === threadId)?.activity.length,
  );
  assert.deepEqual(
    after.queue.map((q) => q.isSeen),
    [true, true],
  );
  assert.equal(
    threadsReducer(after, dispatched[0]),
    after,
    'nothing left unread: no store change',
  );
  assert.deepEqual(
    await runRemoteCommand(
      { type: 'seen', threadId: 'nope' },
      device(state, 'Laptop', []),
    ),
    { isOk: false, error: 'No such thread on this machine' },
  );
});
