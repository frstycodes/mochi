import assert from 'node:assert/strict';
import { test } from 'node:test';
import { host } from '../host/index.ts';
import type { QueueItem } from '../model.ts';
import type { Action, State } from '../store/index.tsx';
import { initialNotifications } from '../notify/slice.ts';
import { initialQueue } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { runRemoteCommand } from './commands.ts';
import { tapAction } from './tap.ts';

function machine() {
  const base = {
    ...initialThreads(undefined, false),
    ...initialQueue(undefined, false),
    ...initialNotifications(),
    spaceId: 'latitude',
    views: {},
  } as unknown as State;
  const s = threadsReducer(base, { type: 'create', title: 'reply with ok', provider: 'claude', project: null, isLive: true });
  const threadId = s.threads.at(-1)!.id;
  // Its first turn is over: the agent is idle.
  const threads = s.threads.map((t) => (t.id === threadId ? { ...t, live: { ...t.live!, isWorking: false, cwd: '/work/reply' } } : t));
  const item = (id: string) => ({ id, threadId, kind: 'approval', title: 'Run pnpm test', detail: '', requestId: id }) as QueueItem;
  return { state: { ...s, threads, queue: [item('q-1'), item('q-2')] }, threadId };
}

const device = (state: State, deviceName: string, dispatched: Action[]) => ({
  state,
  dispatch: (a: Action) => void dispatched.push(a),
  deviceName,
  whileWorking: 'queue' as const,
});

test('the first answer to a queue item wins; a later one, even against the same stale store, hears where it went', async () => {
  const { state } = machine();
  const dispatched: Action[] = [];
  assert.deepEqual(await runRemoteCommand({ type: 'resolve', queueId: 'q-1' }, device(state, 'Laptop', dispatched)), { isOk: true });
  assert.deepEqual(await runRemoteCommand({ type: 'resolve', queueId: 'q-1', answers: [['no']] }, device(state, 'Desk PC', dispatched)), { isOk: false, error: 'Already answered on Laptop' });
  assert.deepEqual(dispatched, [{ type: 'answer', queueId: 'q-1', answers: undefined }], 'only the first answer reached the store');
});

test('an answer given on the machine itself wins over a device', async () => {
  const { state } = machine();
  // What the store tap sees when the machine's own Queue answers.
  tapAction({ type: 'answer', queueId: 'q-2' });
  const dispatched: Action[] = [];
  const result = await runRemoteCommand({ type: 'resolve', queueId: 'q-2' }, device(state, 'Laptop', dispatched));
  assert.equal(result.isOk, false);
  assert.match(!result.isOk ? result.error : '', /^Already answered on /);
  assert.deepEqual(dispatched, []);
});

test('an item that is gone, a missing thread and an idle agent are refused without touching the store', async () => {
  const { state, threadId } = machine();
  const dispatched: Action[] = [];
  assert.deepEqual(await runRemoteCommand({ type: 'resolve', queueId: 'q-gone' }, device(state, 'Laptop', dispatched)), { isOk: false, error: 'This is no longer waiting for an answer' });
  assert.deepEqual(await runRemoteCommand({ type: 'interrupt', threadId: 'nope' }, device(state, 'Laptop', dispatched)), { isOk: false, error: 'No such thread on this machine' });
  assert.deepEqual(await runRemoteCommand({ type: 'interrupt', threadId }, device(state, 'Laptop', dispatched)), { isOk: false, error: 'The agent isn’t working' });
  assert.deepEqual(dispatched, []);
});

test('a device answers only approvals and questions, and a question needs answers', async () => {
  const { state, threadId } = machine();
  const review = { id: 'q-review', threadId, kind: 'review', title: 'Review', detail: '' } as QueueItem;
  const question = { id: 'q-ask', threadId, kind: 'question', title: 'Which?', detail: '', requestId: 'ask' } as QueueItem;
  const withItems = { ...state, queue: [...state.queue, review, question] };
  const dispatched: Action[] = [];
  assert.deepEqual(await runRemoteCommand({ type: 'resolve', queueId: 'q-review' }, device(withItems, 'Laptop', dispatched)), { isOk: false, error: 'Only approvals and questions can be answered from a device' });
  assert.deepEqual(await runRemoteCommand({ type: 'resolve', queueId: 'q-ask' }, device(withItems, 'Laptop', dispatched)), { isOk: false, error: 'A question needs answers' });
  assert.deepEqual(dispatched, []);
  assert.deepEqual(await runRemoteCommand({ type: 'resolve', queueId: 'q-ask', answers: [['A']] }, device(withItems, 'Laptop', dispatched)), { isOk: true });
});

test('send goes out now to an idle agent and queues behind a working one, like the composer', async () => {
  const { state, threadId } = machine();
  const idle: Action[] = [];
  await runRemoteCommand({ type: 'send', threadId, text: 'hello' }, device(state, 'Laptop', idle));
  assert.deepEqual(idle.map((a) => a.type), ['send']);
  const working = { ...state, threads: state.threads.map((t) => (t.id === threadId ? { ...t, live: { ...t.live!, isWorking: true } } : t)) };
  const queued: Action[] = [];
  await runRemoteCommand({ type: 'send', threadId, text: 'next' }, device(working, 'Laptop', queued));
  assert.deepEqual(queued.map((a) => a.type), ['queued-add']);
});

test('operate and manage commands dispatch the same actions the UI does, and the reducer applies them', async () => {
  const { state, threadId } = machine();
  const dispatched: Action[] = [];
  const env = device(state, 'Laptop', dispatched);
  for (const command of [
    { type: 'rename', threadId, title: 'Ship the login fix' },
    { type: 'edit-goal', threadId, goal: 'Login works with SSO' },
    { type: 'pin', threadId, isPinned: true },
    { type: 'fork', threadId, point: { kind: 'message', index: 0 } },
    // A live thread handed off starts working again, so settling comes after.
    { type: 'handoff', threadId, to: 'codex' },
    { type: 'settle', threadId, isSettled: true },
    { type: 'create', title: 'Write the changelog', provider: 'codex', project: null },
  ] as const)
    assert.deepEqual(await runRemoteCommand(command, env), { isOk: true }, command.type);
  assert.deepEqual(dispatched.map((a) => a.type), ['rename', 'edit-goal', 'reorder', 'fork', 'handoff', 'settle', 'create']);

  const applied = dispatched.reduce((s, a) => threadsReducer(s, a), state as State);
  const thread = applied.threads.find((t) => t.id === threadId)!;
  assert.equal(thread.title, 'Ship the login fix');
  assert.equal(thread.goal, 'Login works with SSO');
  assert.equal(thread.status, 'settled');
  assert.equal(thread.providers[0], 'codex');
  assert.ok(applied.threads.some((t) => t.title === 'Write the changelog'), 'the new thread exists');
  const create = dispatched.at(-1) as Extract<Action, { type: 'create' }>;
  assert.equal(create.isBackground, true, 'a device never moves the view on this machine');
});

test('commands that would change nothing say so or do nothing', async () => {
  const { state, threadId } = machine();
  const dispatched: Action[] = [];
  const env = device(state, 'Laptop', dispatched);
  assert.deepEqual(await runRemoteCommand({ type: 'handoff', threadId, to: 'claude' }, env), { isOk: false, error: 'The thread is already on that agent' });
  assert.deepEqual(await runRemoteCommand({ type: 'pin', threadId, isPinned: false }, env), { isOk: true });
  assert.deepEqual(await runRemoteCommand({ type: 'settle', threadId, isSettled: false }, env), { isOk: true });
  assert.deepEqual(await runRemoteCommand({ type: 'rename', threadId: 'nope', title: 'x' }, env), { isOk: false, error: 'No such thread on this machine' });
  assert.deepEqual(dispatched, []);
});

test('delete, a line comment and a rewind dispatch what the UI does for them', async () => {
  const { state, threadId } = machine();
  const dispatched: Action[] = [];
  const env = device(state, 'Laptop', dispatched);
  assert.deepEqual(await runRemoteCommand({ type: 'comment', threadId, path: 'src/a.ts', side: 'deletions', line: 4, text: 'Why?' }, env), { isOk: true });
  assert.deepEqual(await runRemoteCommand({ type: 'delete', threadId }, env), { isOk: true });
  assert.deepEqual(dispatched, [
    { type: 'say', threadId, entry: { who: 'you', kind: 'message', text: 'Review note on `src/a.ts, removed line 4`\n\nWhy?' } },
    { type: 'delete', threadIds: [threadId] },
  ]);
  // No checkpoint yet: nothing to rewind to, and nothing dispatched.
  assert.deepEqual(await runRemoteCommand({ type: 'rewind', threadId, point: { kind: 'checkpoint', n: 3 }, mode: 'chat' }, device(state, 'Laptop', [])), {
    isOk: false,
    error: 'There is nothing to rewind to there',
  });
});

test('code commands make the Changes and Files tabs’ host calls in the thread’s folder, resolved on the machine', async (t) => {
  const { state, threadId } = machine();
  const env = device(state, 'Laptop', []);
  const diff = { branch: 'b', base: 'main', files: [] };
  const diffCall = t.mock.method(host.git, 'diff', async () => diff);
  const stage = t.mock.method(host.git, 'stage', async () => {});
  t.mock.method(host.fs, 'list', async () => Array.from({ length: 10_001 }, (_, i) => `f${i}.ts`));
  const read = t.mock.method(host.fs, 'read', async (_root: string, path: string) =>
    path.endsWith('.png') ? { kind: 'binary', bytes: new Uint8Array(1), mtimeMs: 0 } : { kind: 'text', text: 'hi', mtimeMs: 0 },
  );

  assert.deepEqual(await runRemoteCommand({ type: 'diff', threadId, scope: 'uncommitted' }, env), { isOk: true, data: diff });
  assert.deepEqual(diffCall.mock.calls[0].arguments, ['/work/reply', 'uncommitted', undefined]);
  await runRemoteCommand({ type: 'change', threadId, action: 'stage', target: { path: 'a.ts', staged: false } }, env);
  assert.deepEqual(stage.mock.calls[0].arguments, ['/work/reply', { path: 'a.ts', staged: false }]);
  const files = await runRemoteCommand({ type: 'files', threadId }, env);
  assert.ok(files.isOk && files.data && 'paths' in files.data && files.data.paths.length === 10_000 && files.data.isTruncated, 'capped');
  assert.deepEqual(await runRemoteCommand({ type: 'read-file', threadId, path: 'a.ts' }, env), { isOk: true, data: { text: 'hi' } });
  assert.deepEqual(read.mock.calls[0].arguments, ['/work/reply', 'a.ts']);
  assert.deepEqual(await runRemoteCommand({ type: 'read-file', threadId, path: 'logo.png' }, env), {
    isOk: false,
    error: 'This is a binary file; open it on that computer',
  });

  const folderless = { ...state, threads: state.threads.map((th) => ({ ...th, live: undefined })) };
  assert.deepEqual(await runRemoteCommand({ type: 'diff', threadId, scope: 'branch' }, device(folderless, 'Laptop', [])), {
    isOk: false,
    error: 'This thread has no folder on this machine',
  });
});

test('a device shell runs in the thread’s folder and is that thread’s alone; output reads from an offset', async (t) => {
  const { state, threadId } = machine();
  const env = device(state, 'Laptop', []);
  t.mock.method(host.ports, 'allocate', async () => 4100);
  const spawn = t.mock.method(host.pty, 'spawn', async () => ({ id: 'pty-remote-1' }));
  const write = t.mock.method(host.pty, 'write', async () => {});
  let emit: (event: { id: string; data: string }) => void = () => {};
  t.mock.method(host.pty, 'onData', (listener: typeof emit) => ((emit = listener), () => {}));
  t.mock.method(host.pty, 'onExit', () => () => {});
  t.mock.method(host.pty, 'kill', async () => {});

  const opened = await runRemoteCommand({ type: 'terminal-open', threadId, cols: 80, rows: 24 }, env);
  assert.deepEqual(opened, { isOk: true, data: { terminalId: 'pty-remote-1' } });
  assert.deepEqual(spawn.mock.calls[0].arguments, [{ cwd: '/work/reply', cols: 80, rows: 24, port: 4100, threadId }]);
  emit({ id: 'pty-remote-1', data: 'hello ' });
  emit({ id: 'pty-remote-1', data: 'world' });
  assert.deepEqual(await runRemoteCommand({ type: 'terminal-read', threadId, terminalId: 'pty-remote-1', after: 6 }, env), {
    isOk: true,
    data: { data: 'world', next: 11 },
  });
  await runRemoteCommand({ type: 'terminal-write', threadId, terminalId: 'pty-remote-1', data: 'ls\r' }, env);
  assert.deepEqual(write.mock.calls[0].arguments, ['pty-remote-1', 'ls\r']);

  const other = threadsReducer(state, { type: 'create', title: 'other', provider: 'claude', project: null, isLive: true });
  const otherId = other.threads.at(-1)!.id;
  assert.deepEqual(
    await runRemoteCommand(
      { type: 'terminal-write', threadId: otherId, terminalId: 'pty-remote-1', data: 'x' },
      device({ ...other, threads: other.threads.map((th) => ({ ...th, live: { ...th.live!, cwd: '/w' } })) }, 'Laptop', []),
    ),
    { isOk: false, error: 'That terminal is closed' },
  );
  assert.deepEqual(
    await runRemoteCommand({ type: 'terminal-write', threadId, terminalId: 'a-local-pty', data: 'x' }, env),
    { isOk: false, error: 'That terminal is closed' },
    'the machine’s own terminals are out of reach',
  );
  await runRemoteCommand({ type: 'terminal-close', threadId, terminalId: 'pty-remote-1' }, env);
  assert.deepEqual(await runRemoteCommand({ type: 'terminal-read', threadId, terminalId: 'pty-remote-1', after: 0 }, env), {
    isOk: false,
    error: 'That terminal is closed',
  });
});

test('a new thread starts only in a project the machine listed, with the model asked for', async (t) => {
  const { state } = machine();
  const withProject = {
    ...state,
    threads: [...state.threads, { ...state.threads[0], id: 'p', spaceId: state.spaceId, repo: { project: 'api', branch: 'main', path: '/src/api' } }],
  };
  t.mock.method(host.settings, 'get', async () => ({ harnesses: { claude: { model: 'opus' }, codex: { model: '' } } }));
  t.mock.method(host.agent, 'models', async () => []);
  const listed = await runRemoteCommand({ type: 'catalog' }, device(withProject, 'Laptop', []));
  assert.ok(listed.isOk && listed.data && 'projects' in listed.data);
  assert.deepEqual(listed.data.projects, [{ ref: '/src/api', name: 'api' }]);
  assert.deepEqual(listed.data.defaults, { claude: 'opus', codex: '' });

  const dispatched: Action[] = [];
  assert.deepEqual(await runRemoteCommand({ type: 'create', title: 'x', provider: 'claude', project: '/etc' }, device(withProject, 'Laptop', dispatched)), {
    isOk: false,
    error: 'That project isn’t on this machine',
  });
  assert.deepEqual(
    await runRemoteCommand(
      { type: 'create', title: 'Fix it', provider: 'codex', project: '/src/api', model: 'gpt-6' },
      device(withProject, 'Laptop', dispatched),
    ),
    { isOk: true },
  );
  const create = dispatched[0] as Extract<Action, { type: 'create' }>;
  assert.equal(create.project, '/src/api');
  assert.equal(create.controls?.model, 'gpt-6');
});

test('settings a device writes stay on the machine; Devices and the demo switch can’t be changed from one', async (t) => {
  const { state } = machine();
  t.mock.method(host.settings, 'get', async () => ({ harnesses: { claude: { model: '' }, codex: { model: '' } } }));
  const env = device(state, 'Laptop', []);
  assert.deepEqual(await runRemoteCommand({ type: 'setting', key: 'nope', value: 'x' }, env), { isOk: false, error: 'No setting nope' });
  const remoteRow = await runRemoteCommand({ type: 'setting', key: 'remoteEnabled', value: 'false' }, env);
  assert.match(!remoteRow.isOk ? remoteRow.error : '', /can only be changed on that computer$/);
  const demo = await runRemoteCommand({ type: 'setting', key: 'demoData', value: 'true' }, env);
  assert.match(!demo.isOk ? demo.error : '', /can only be changed on that computer$/);
});
