import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vite-plus/test';
import { host } from '../host/index.ts';
import type { SearchHits } from '@mochi/domain/host/types/fs';
import type { Thread } from '../model.ts';
import type { Action, State } from '../store/index.tsx';
import { initialNotifications } from '../notify/slice.ts';
import { initialQueue } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { runRemoteCommand } from './commands.ts';

afterEach(() => vi.restoreAllMocks());

/** One idle thread whose folder is /work/reply; `named` puts paths into its transcript, as an attached image or task output would. */
function machine(named: string[] = []) {
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
  const threads = s.threads.map((t) =>
    t.id === threadId
      ? ({
          ...t,
          live: { ...t.live!, isWorking: false, cwd: '/work/reply' },
          messages: named.map((path) => ({
            role: 'assistant',
            text: path,
          })),
        } as unknown as Thread)
      : t,
  );
  return { state: { ...s, threads } as State, threadId };
}

const device = (state: State) => ({
  state,
  dispatch: (_: Action) => {},
  deviceName: 'Laptop',
});

const folderless = (state: State): State => ({
  ...state,
  threads: state.threads.map((th) => ({ ...th, live: undefined })),
});

const NO_FOLDER = {
  isOk: false,
  error: 'This thread has no folder on this machine',
};

const hit = (id: string, path: string): SearchHits => ({
  id,
  path,
  lines: [
    { line: 1, text: 'x', isCut: false, ranges: [[0, 1]], column: [0, 1] },
  ],
});

test('read-file answers its text with the mtime a save will be based on', async () => {
  const { state, threadId } = machine();
  const read = vi.spyOn(host.fs, 'read').mockImplementation(async () => ({
    kind: 'text',
    text: 'hi',
    mtimeMs: 42,
  }));
  assert.deepEqual(
    await runRemoteCommand(
      { type: 'read-file', threadId, path: 'a.ts' },
      device(state),
    ),
    { isOk: true, data: { text: 'hi', mtimeMs: 42 } },
  );
  assert.deepEqual(read.mock.calls[0], ['/work/reply', 'a.ts']);
});

test('write-file passes the base mtime and force to the host and answers its result, saved or conflict', async () => {
  const { state, threadId } = machine();
  const write = vi
    .spyOn(host.fs, 'write')
    .mockImplementationOnce(async () => ({ status: 'saved', mtimeMs: 9 }))
    .mockImplementationOnce(async () => ({
      status: 'conflict',
      text: 'theirs',
      mtimeMs: 10,
    }));
  assert.deepEqual(
    await runRemoteCommand(
      {
        type: 'write-file',
        threadId,
        path: 'a.ts',
        text: 'mine',
        baseMtimeMs: 5,
      },
      device(state),
    ),
    { isOk: true, data: { status: 'saved', mtimeMs: 9 } },
  );
  assert.deepEqual(write.mock.calls[0], [
    '/work/reply',
    'a.ts',
    'mine',
    { baseMtimeMs: 5, force: undefined },
  ]);
  assert.deepEqual(
    await runRemoteCommand(
      {
        type: 'write-file',
        threadId,
        path: 'a.ts',
        text: 'mine',
        baseMtimeMs: 5,
        force: true,
      },
      device(state),
    ),
    {
      isOk: true,
      data: { status: 'conflict', text: 'theirs', mtimeMs: 10 },
    },
  );
  assert.deepEqual(write.mock.calls[1], [
    '/work/reply',
    'a.ts',
    'mine',
    { baseMtimeMs: 5, force: true },
  ]);
});

test('search gathers its own search’s hits without ids, and unsubscribes when done', async () => {
  const { state, threadId } = machine();
  let listener: (h: SearchHits) => void = () => {};
  const off = vi.fn();
  vi.spyOn(host.fs, 'onSearchHits').mockImplementation((l) => {
    listener = l;
    return off;
  });
  const search = vi
    .spyOn(host.fs, 'search')
    .mockImplementation(async (_root, id) => {
      listener(hit('someone-else', 'foreign.ts'));
      listener(hit(id, 'a.ts'));
      listener(hit(id, 'b.ts'));
      return { isTruncated: false } as Awaited<
        ReturnType<typeof host.fs.search>
      >;
    });
  const result = await runRemoteCommand(
    {
      type: 'search',
      threadId,
      pattern: 'x',
      isCaseSensitive: true,
      isRegex: false,
      isWholeWord: false,
    },
    device(state),
  );
  const lines = hit('', '').lines;
  assert.deepEqual(result, {
    isOk: true,
    data: {
      hits: [
        { path: 'a.ts', lines },
        { path: 'b.ts', lines },
      ],
      isTruncated: false,
    },
  });
  assert.equal(search.mock.calls[0]![0], '/work/reply');
  assert.deepEqual(search.mock.calls[0]!.slice(2), [
    'x',
    { isCaseSensitive: true, isRegex: false, isWholeWord: false },
  ]);
  assert.equal(off.mock.calls.length, 1);
});

test('search stops at 500 files, cancels the host search and says it was cut short', async () => {
  const { state, threadId } = machine();
  let listener: (h: SearchHits) => void = () => {};
  const off = vi.fn();
  vi.spyOn(host.fs, 'onSearchHits').mockImplementation((l) => {
    listener = l;
    return off;
  });
  const cancel = vi
    .spyOn(host.fs, 'cancelSearch')
    .mockImplementation(async () => {});
  let searchId = '';
  vi.spyOn(host.fs, 'search').mockImplementation(async (_root, id) => {
    searchId = id;
    for (let i = 0; i < 600; i++) listener(hit(id, `f${i}.ts`));
    return { isTruncated: false } as Awaited<ReturnType<typeof host.fs.search>>;
  });
  const result = await runRemoteCommand(
    {
      type: 'search',
      threadId,
      pattern: 'x',
      isCaseSensitive: false,
      isRegex: false,
      isWholeWord: false,
    },
    device(state),
  );
  assert.ok(result.isOk && result.data && 'hits' in result.data);
  assert.equal(result.data.hits.length, 500);
  assert.equal(result.data.isTruncated, true);
  assert.deepEqual(cancel.mock.calls, [[searchId]]);
  assert.equal(off.mock.calls.length, 1);
});

test('turn-diff asks the host for the commits’ files and answers them as turnFiles', async () => {
  const { state, threadId } = machine();
  const files = [{ path: 'a.ts' }] as unknown as Awaited<
    ReturnType<typeof host.git.turnDiff>
  >;
  const turnDiff = vi
    .spyOn(host.git, 'turnDiff')
    .mockImplementation(async () => files);
  assert.deepEqual(
    await runRemoteCommand(
      { type: 'turn-diff', threadId, from: 'abcd', to: 'beef' },
      device(state),
    ),
    { isOk: true, data: { turnFiles: files } },
  );
  assert.deepEqual(turnDiff.mock.calls[0], ['/work/reply', 'abcd', 'beef']);
  await runRemoteCommand(
    { type: 'turn-diff', threadId, from: 'abcd' },
    device(state),
  );
  assert.deepEqual(turnDiff.mock.calls[1], ['/work/reply', 'abcd', undefined]);
});

test('read-image answers only a path the thread names, and only an image', async () => {
  const png = '/tmp/shots/a.png';
  const svg = '/tmp/shots/b.svg';
  const txt = '/tmp/shots/notes.txt';
  const { state, threadId } = machine([png, svg, txt]);
  const bytes = new Uint8Array([137, 80, 78, 71, 0, 255]);
  const read = vi
    .spyOn(host.fs, 'read')
    .mockImplementation(async (_root: string, name: string) =>
      name === 'b.svg'
        ? { kind: 'text', text: '<svg/>', mtimeMs: 1 }
        : { kind: 'binary', bytes, mtimeMs: 1 },
    );
  const run = (path: string, s: State = state) =>
    runRemoteCommand({ type: 'read-image', threadId, path }, device(s));

  assert.deepEqual(await run('/etc/passwd.png'), {
    isOk: false,
    error: 'This thread doesn’t name that file',
  });
  assert.equal(read.mock.calls.length, 0);

  assert.deepEqual(await run(png), {
    isOk: true,
    data: {
      mediaType: 'image/png',
      base64: Buffer.from(bytes).toString('base64'),
    },
  });
  assert.deepEqual(read.mock.calls[0], ['/tmp/shots', 'a.png']);

  assert.deepEqual(await run(svg), {
    isOk: true,
    data: {
      mediaType: 'image/svg+xml',
      base64: Buffer.from('<svg/>').toString('base64'),
    },
  });

  assert.deepEqual(await run(txt), {
    isOk: false,
    error: 'That file isn’t an image',
  });

  // No folder needed: the thread names the file.
  const result = await run(png, folderless(state));
  assert.ok(result.isOk && result.data && 'mediaType' in result.data);
});

test('read-task-output answers text a thread names with its mtime, and refuses any other path', async () => {
  const out = '/tmp/tasks/out.log';
  const { state, threadId } = machine([out]);
  vi.spyOn(host.fs, 'read').mockImplementation(async () => ({
    kind: 'text',
    text: 'done',
    mtimeMs: 7,
  }));
  assert.deepEqual(
    await runRemoteCommand(
      { type: 'read-task-output', threadId, path: out },
      device(folderless(state)),
    ),
    { isOk: true, data: { text: 'done', mtimeMs: 7 } },
  );
  assert.deepEqual(
    await runRemoteCommand(
      { type: 'read-task-output', threadId, path: '/tmp/tasks/other.log' },
      device(state),
    ),
    { isOk: false, error: 'This thread doesn’t name that file' },
  );
});

test('a thread without a folder can’t write, search or diff turns', async () => {
  const { state, threadId } = machine();
  const env = device(folderless(state));
  for (const command of [
    {
      type: 'write-file',
      threadId,
      path: 'a.ts',
      text: '',
      baseMtimeMs: 0,
    },
    {
      type: 'search',
      threadId,
      pattern: 'x',
      isCaseSensitive: false,
      isRegex: false,
      isWholeWord: false,
    },
    { type: 'turn-diff', threadId, from: 'abcd' },
  ] as const)
    assert.deepEqual(await runRemoteCommand(command, env), NO_FOLDER);
});
