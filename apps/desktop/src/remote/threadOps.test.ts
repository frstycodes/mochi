import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vite-plus/test';
import { setWorktreePath } from '../git/worktrees.ts';
import { host } from '../host/index.ts';
import type { PrReview } from '../host/types/git.ts';
import type { Trigger } from '../host/types/schedule.ts';
import type { Project } from '@mochi/domain/host/types/projects';
import type { Action, State } from '../store/index.tsx';
import { initialNotifications } from '../notify/slice.ts';
import { initialQueue } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { runRemoteCommand } from './commands.ts';

afterEach(() => vi.restoreAllMocks());

/** An idle folderless chat in `/work/chat`, one PR recorded, beside a thread in the `api` project. */
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
    title: 'tidy the docs',
    provider: 'claude',
    project: null,
    isLive: true,
  });
  const chat = s.threads.at(-1)!;
  const threads = [
    {
      ...chat,
      live: { ...chat.live!, isWorking: false, cwd: '/work/chat' },
      prs: [{ number: 12, title: 'Docs', url: '' }],
    },
    {
      ...chat,
      id: 'api-thread',
      repo: { project: 'api', branch: 'main', path: '/src/api' },
    },
  ] as State['threads'];
  return { state: { ...s, threads }, threadId: chat.id };
}

const env = (state: State, dispatched: Action[] = []) => ({
  state,
  dispatch: (a: Action) => void dispatched.push(a),
  deviceName: 'Laptop',
});

const review = (threadIds: string[]) =>
  ({
    number: 12,
    threads: threadIds.map((id) => ({ id })),
  }) as unknown as PrReview;

test('pr reads and writes act only on the thread’s own PRs, in its folder as its profile', async () => {
  const { state, threadId } = machine();
  vi.spyOn(host.git, 'pr').mockImplementation(async () => null);
  const prReview = vi
    .spyOn(host.git, 'prReview')
    .mockImplementation(async () => review(['PRRT_1']));
  const comment = vi
    .spyOn(host.git, 'commentPr')
    .mockImplementation(async () => {});
  const merge = vi
    .spyOn(host.git, 'mergePr')
    .mockImplementation(async () => {});
  const reply = vi
    .spyOn(host.git, 'replyThread')
    .mockImplementation(async () => {});

  assert.deepEqual(
    await runRemoteCommand({ type: 'pr-status', threadId }, env(state)),
    { isOk: true },
    'no PR on the branch: no data',
  );
  assert.deepEqual(
    await runRemoteCommand(
      { type: 'pr-review', threadId, number: 99 },
      env(state),
    ),
    { isOk: false, error: 'That pull request isn’t this thread’s' },
  );
  assert.deepEqual(
    await runRemoteCommand(
      {
        type: 'pr',
        threadId,
        number: 99,
        action: { kind: 'merge', method: 'squash', mode: 'now' },
      },
      env(state),
    ),
    { isOk: false, error: 'That pull request isn’t this thread’s' },
  );
  assert.equal(merge.mock.calls.length, 0);

  assert.deepEqual(
    await runRemoteCommand(
      { type: 'pr-review', threadId, number: 12 },
      env(state),
    ),
    { isOk: true, data: review(['PRRT_1']) },
  );
  assert.deepEqual(prReview.mock.calls[0], ['/work/chat', 12, undefined]);
  await runRemoteCommand(
    {
      type: 'pr',
      threadId,
      number: 12,
      action: { kind: 'comment', body: 'LGTM' },
    },
    env(state),
  );
  assert.deepEqual(comment.mock.calls[0], [
    '/work/chat',
    12,
    'LGTM',
    undefined,
  ]);
  await runRemoteCommand(
    {
      type: 'pr',
      threadId,
      number: 12,
      action: { kind: 'merge', method: 'rebase', mode: 'auto' },
    },
    env(state),
  );
  assert.deepEqual(merge.mock.calls[0], [
    '/work/chat',
    12,
    'rebase',
    'auto',
    undefined,
  ]);

  // A review thread id is GitHub-wide: one from another PR is refused before gh sees it.
  assert.deepEqual(
    await runRemoteCommand(
      {
        type: 'pr',
        threadId,
        number: 12,
        action: { kind: 'reply', reviewThreadId: 'PRRT_other', body: 'x' },
      },
      env(state),
    ),
    { isOk: false, error: 'That review thread isn’t on this pull request' },
  );
  assert.equal(reply.mock.calls.length, 0);
  assert.deepEqual(
    await runRemoteCommand(
      {
        type: 'pr',
        threadId,
        number: 12,
        action: { kind: 'reply', reviewThreadId: 'PRRT_1', body: 'Done' },
      },
      env(state),
    ),
    { isOk: true },
  );
  assert.deepEqual(reply.mock.calls[0], [
    '/work/chat',
    'PRRT_1',
    'Done',
    undefined,
  ]);
});

test('the PR open on the branch counts before the thread recorded one', async () => {
  const { state, threadId } = machine();
  const bare = {
    ...state,
    threads: state.threads.map((t) => ({ ...t, prs: [] })),
  };
  vi.spyOn(host.git, 'pr').mockImplementation(async () => ({
    number: 7,
    url: '',
    title: 'Branch PR',
    state: 'OPEN',
    checks: [],
  }));
  const resolve = vi
    .spyOn(host.git, 'resolveThread')
    .mockImplementation(async () => {});
  vi.spyOn(host.git, 'prReview').mockImplementation(async () =>
    review(['PRRT_7']),
  );
  assert.deepEqual(
    await runRemoteCommand(
      {
        type: 'pr',
        threadId,
        number: 7,
        action: { kind: 'resolve', reviewThreadId: 'PRRT_7', isResolved: true },
      },
      env(bare),
    ),
    { isOk: true },
  );
  assert.deepEqual(resolve.mock.calls[0], [
    '/work/chat',
    'PRRT_7',
    true,
    undefined,
  ]);
});

test('sync and disk usage run in the thread’s folder; a thread elsewhere is refused', async () => {
  const { state, threadId } = machine();
  const sync = vi
    .spyOn(host.git, 'sync')
    .mockImplementation(async () => ({ base: 'main', conflicts: [] }));
  vi.spyOn(host.git, 'diskUsage').mockImplementation(async () => 2048);
  assert.deepEqual(
    await runRemoteCommand({ type: 'sync', threadId }, env(state)),
    { isOk: true, data: { base: 'main', conflicts: [] } },
  );
  assert.deepEqual(sync.mock.calls[0], ['/work/chat', undefined]);
  assert.deepEqual(
    await runRemoteCommand({ type: 'disk-usage', threadId }, env(state)),
    { isOk: true, data: { bytes: 2048 } },
  );
  assert.deepEqual(
    await runRemoteCommand({ type: 'sync', threadId: 'gone' }, env(state)),
    { isOk: false, error: 'No such thread on this machine' },
  );
});

test('schedules lists this machine’s triggers for its threads, without their runs; schedule-set saves the editor’s draft', async () => {
  const { state, threadId } = machine();
  const trigger = (id: string) =>
    ({
      threadId: id,
      name: 'Nightly',
      prompt: 'p',
      when: { kind: 'cron', cron: '0 3 * * *' },
      missed: 'skip',
      start: { provider: 'claude', spaceId: 'latitude', cwd: '/work/chat' },
      isPaused: false,
      createdAt: 1,
      checkedAt: 2,
      seen: ['r1'],
      runs: [
        {
          id: 'r1',
          threadId: id,
          reason: 'cron',
          startedAt: 1,
          status: 'done',
          summary: 'secret',
        },
      ],
    }) as Trigger;
  vi.spyOn(host.schedule, 'list').mockImplementation(async () => [
    trigger(threadId),
    trigger('deleted-thread'),
  ]);
  const listed = await runRemoteCommand({ type: 'schedules' }, env(state));
  assert.ok(listed.isOk);
  const { seen: _seen, ...kept } = trigger(threadId);
  assert.deepEqual(listed.data, [{ ...kept, runs: [] }]);

  const set = vi.spyOn(host.schedule, 'set').mockImplementation(async () => {});
  assert.deepEqual(
    await runRemoteCommand(
      {
        type: 'schedule-set',
        threadId,
        name: '  ',
        prompt: 'run the tests',
        when: { kind: 'pr', event: 'ci-failed' },
        missed: 'run-once',
      },
      env(state),
    ),
    { isOk: true },
  );
  const [input] = set.mock.calls[0];
  assert.equal(input.threadId, threadId);
  assert.equal(input.name, 'tidy the docs', 'a blank name is the title');
  assert.equal(input.prompt, 'run the tests');
  assert.deepEqual(input.when, { kind: 'pr', event: 'ci-failed' });
  assert.equal(input.start.cwd, '/work/chat', 'the folder is resolved here');
});

test('attach-project moves a folderless chat into a project here by id, never by a path', async () => {
  const { state, threadId } = machine();
  const listed = await runRemoteCommand({ type: 'projects' }, env(state));
  assert.ok(listed.isOk);
  const api = (listed.data as Project[]).find((p) => p.name === 'api')!;

  const dispatched: Action[] = [];
  for (const project of ['/src/api', 'no-such-id'])
    assert.deepEqual(
      await runRemoteCommand(
        { type: 'attach-project', threadId, project },
        env(state, dispatched),
      ),
      { isOk: false, error: 'That project isn’t on this machine' },
    );
  assert.deepEqual(
    await runRemoteCommand(
      { type: 'attach-project', threadId: 'api-thread', project: api.id },
      env(state, dispatched),
    ),
    { isOk: false, error: 'This thread is already in a project' },
  );
  const working = {
    ...state,
    threads: state.threads.map((t) =>
      t.id === threadId ? { ...t, live: { ...t.live!, isWorking: true } } : t,
    ),
  };
  assert.deepEqual(
    await runRemoteCommand(
      { type: 'attach-project', threadId, project: api.id },
      env(working, dispatched),
    ),
    { isOk: false, error: 'Available once the agent finishes this turn' },
  );
  assert.deepEqual(dispatched, []);

  assert.deepEqual(
    await runRemoteCommand(
      { type: 'attach-project', threadId, project: api.id },
      env(state, dispatched),
    ),
    { isOk: true },
  );
  assert.deepEqual(dispatched, [
    { type: 'attach-project', threadId, project: '/src/api' },
  ]);
});

test('port-kill stops only a process listening in the thread’s folder', async () => {
  const { state, threadId } = machine();
  const list = vi
    .spyOn(host.ports, 'list')
    .mockImplementation(async () => [
      { ports: [{ port: 5173, pid: 4242, command: 'vite', startedAt: 1 }] },
    ]);
  const kill = vi.spyOn(host.ports, 'kill').mockImplementation(async () => {});
  assert.deepEqual(
    await runRemoteCommand({ type: 'ports', threadId }, env(state)),
    {
      isOk: true,
      data: {
        ports: [{ port: 5173, pid: 4242, command: 'vite', startedAt: 1 }],
      },
    },
  );
  assert.deepEqual(list.mock.calls[0], [['/work/chat']]);
  assert.deepEqual(
    await runRemoteCommand({ type: 'port-kill', threadId, pid: 1 }, env(state)),
    {
      isOk: false,
      error: 'That process isn’t listening in this thread’s folder',
    },
  );
  assert.equal(kill.mock.calls.length, 0);
  assert.deepEqual(
    await runRemoteCommand(
      { type: 'port-kill', threadId, pid: 4242 },
      env(state),
    ),
    { isOk: true },
  );
  assert.deepEqual(kill.mock.calls[0], [4242]);
});

test('rewind-preview reads the thread’s own worktree, and only that', async () => {
  const { state, threadId } = machine();
  const preview = vi
    .spyOn(host.git, 'rewindPreview')
    .mockImplementation(async () => ({ files: ['a.ts'], outside: [] }));
  assert.deepEqual(
    await runRemoteCommand(
      { type: 'rewind-preview', threadId, n: 2 },
      env(state),
    ),
    { isOk: false, error: 'This thread has no worktree of its own' },
  );
  setWorktreePath(threadId, '/wt/chat');
  try {
    assert.deepEqual(
      await runRemoteCommand(
        { type: 'rewind-preview', threadId, n: 2 },
        env(state),
      ),
      { isOk: true, data: { files: ['a.ts'], outside: [] } },
    );
    assert.deepEqual(preview.mock.calls[0], ['/wt/chat', threadId, 2]);
  } finally {
    setWorktreePath(threadId, null);
  }
});
