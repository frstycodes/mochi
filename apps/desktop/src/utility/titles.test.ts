import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { Action, State } from '../store/index.tsx';
import { initialQueue } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { hasTempBranch, startTitleRequest, titleRequest } from './titles.ts';

const demoState = () =>
  ({
    ...initialThreads(null, true),
    ...initialQueue(null, true),
    spaceId: 'personal',
    views: {},
  }) as unknown as State;
const run = (s: State, action: Action) => threadsReducer(s, action);

test('a live thread is named once after its first exchange, and never over a title you renamed', () => {
  let s = run(demoState(), {
    type: 'create',
    title:
      'fix the login redirect so it keeps the next parameter after sign in',
    provider: 'claude',
    project: '/Users/me/dev/app',
    isLive: true,
  });
  const id = s.threads.at(-1)!.id;
  const t = () => s.threads.find((x) => x.id === id)!;
  const answered = (isWorking: boolean) => ({
    ...t(),
    live: { ...t().live!, isWorking },
    activity: [
      ...t().activity,
      {
        at: 1,
        who: 'claude' as const,
        kind: 'message' as const,
        text: 'Fixed: the callback keeps ?next.',
      },
    ],
  });

  assert.equal(titleRequest(t()), null, 'no agent reply yet');
  assert.equal(titleRequest(answered(true)), null, 'still working');
  assert.match(
    titleRequest(answered(false))!,
    /^User: fix the login redirect[\s\S]*Agent: Fixed: the callback keeps \?next\.$/,
  );

  s = run(s, {
    type: 'title-generated',
    threadId: id,
    title: 'Login redirect keeps next',
  });
  assert.equal(t().title, 'Login redirect keeps next');
  assert.equal(titleRequest(answered(false)), null, 'named once');

  s = run(s, { type: 'rename', threadId: id, title: 'Auth bug' });
  s = run(s, {
    type: 'title-generated',
    threadId: id,
    title: 'Something else',
  });
  assert.equal(t().title, 'Auth bug', 'your name stays');
});

test('a thread started with "hi" waits for a real goal before it is named', () => {
  let s = run(demoState(), {
    type: 'create',
    title: 'hi',
    provider: 'claude',
    project: null,
    isLive: true,
  });
  const t = s.threads.at(-1)!;
  assert.equal(
    titleRequest({
      ...t,
      live: { isWorking: false },
      activity: [
        ...t.activity,
        {
          at: 1,
          who: 'claude',
          kind: 'message',
          text: 'Hello! What are we building?',
        },
      ],
    }),
    null,
  );
});

test('a new worktree thread is named from its first message before it starts, unless that message is small talk', () => {
  const create = (
    title: string,
    workspace?: { mode: 'worktree'; branch?: string },
  ) =>
    run(demoState(), {
      type: 'create',
      title,
      provider: 'claude',
      project: '/app',
      isLive: true,
      workspace,
    }).threads.at(-1)!;
  const t = create('I still have issues with the login redirect', {
    mode: 'worktree',
  });
  assert.match(t.repo!.branch, /^mochi\/[0-9a-f]{8}$/, 'a temp name first');
  assert.equal(t.repo!.autoBranch, t.repo!.branch);
  assert.equal(
    startTitleRequest(t),
    'User: I still have issues with the login redirect',
    'the first message alone',
  );
  assert.equal(
    startTitleRequest(create('hi', { mode: 'worktree' })),
    undefined,
    'vague: named after the first exchange instead',
  );
  assert.equal(
    startTitleRequest(
      create('Fix login', { mode: 'worktree', branch: 'my-name' }),
    ),
    undefined,
    'a branch you named stays',
  );
  assert.equal(startTitleRequest({ ...t, isTitleRenamed: true }), undefined);
});

test('only a branch still on its temp name may be renamed after the title', () => {
  const t = run(demoState(), {
    type: 'create',
    title: 'Fix login',
    provider: 'claude',
    project: '/app',
    isLive: true,
    workspace: { mode: 'worktree' },
  }).threads.at(-1)!;
  assert.equal(hasTempBranch(t), true);
  for (const change of [
    { autoBranch: undefined },
    { branch: 'my-branch' },
    { mode: 'folder' as const },
    { isExisting: true },
    { isDetached: true },
  ]) {
    assert.equal(
      hasTempBranch({ ...t, repo: { ...t.repo!, ...change } }),
      false,
      JSON.stringify(change),
    );
  }
  const named = run(demoState(), {
    type: 'create',
    title: 'Fix login',
    provider: 'claude',
    project: '/app',
    workspace: { mode: 'worktree', branch: 'my-name' },
  }).threads.at(-1)!;
  assert.equal(named.repo!.autoBranch, undefined);
});
