import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  agentPhase,
  currentAction,
  pendingWork,
  workingLabel,
} from './agentPhase.ts';
import type { ActivityEntry, Thread } from './model.ts';

const thread = (patch: Partial<Thread>) =>
  ({
    status: 'running',
    activity: [{ at: 0, who: 'you', kind: 'message', text: 'hi' }],
    ...patch,
  }) as Thread;
const live = (patch: Partial<NonNullable<Thread['live']>>) => ({
  isWorking: true,
  ...patch,
});

test('the avatar reads idle once a live turn ends, even though the thread stays running', () => {
  assert.equal(
    agentPhase(thread({ live: live({ starting: 'codex' }) })),
    'start',
  );
  assert.deepEqual(pendingWork(thread({ live: live({ starting: 'codex' }) })), {
    phase: 'start',
    label: 'Starting Codex',
  });
  assert.equal(
    agentPhase(thread({ live: live({}) })),
    'think',
    'started, nothing reported yet',
  );
  const ran = thread({
    live: live({}),
    activity: [
      { at: 0, who: 'you', kind: 'message', text: 'hi' },
      { at: 1, who: 'claude', kind: 'tool', text: 'Read src/a.ts' },
    ],
  });
  assert.equal(agentPhase(ran), 'read');
  assert.equal(
    agentPhase({ ...ran, live: live({ isWorking: false }) }),
    'idle',
    'turn over',
  );
  assert.equal(
    pendingWork(thread({ live: live({ isWorking: false }) })),
    undefined,
  );
  assert.equal(
    agentPhase(thread({ status: 'needs-you', live: live({}) })),
    'wait',
  );
  assert.equal(
    agentPhase(thread({ status: 'review' })),
    'idle',
    'demo thread not running',
  );
});

test('a live row says what the agent is doing while it works, and nothing once it stops', () => {
  const you = { at: 0, who: 'you', kind: 'message', text: 'hi' } as const;
  assert.equal(
    workingLabel(thread({ live: live({ starting: 'claude' }) })),
    'Starting Claude Code',
  );
  assert.equal(workingLabel(thread({ live: live({}) })), 'Thinking');
  assert.equal(
    workingLabel(
      thread({
        live: live({}),
        activity: [
          you,
          {
            at: 1,
            who: 'claude',
            kind: 'tool',
            text: 'Edit src/index.ts +3 -1',
          },
        ],
      }),
    ),
    'Editing index.ts',
  );
  assert.equal(
    workingLabel(
      thread({
        live: live({}),
        activity: [
          you,
          { at: 1, who: 'claude', kind: 'tool', text: 'Run pnpm test' },
        ],
      }),
    ),
    'Running pnpm test',
  );
  assert.equal(
    workingLabel(
      thread({
        live: live({}),
        activity: [
          you,
          {
            at: 1,
            who: 'claude',
            kind: 'tool',
            text: 'Run gh pr checks 260 --watch',
            description: 'Watch PR 260 checks',
          },
        ],
      }),
    ),
    'Watch PR 260 checks',
  );
  assert.equal(
    workingLabel(
      thread({
        live: live({}),
        activity: [
          you,
          {
            at: 1,
            who: 'claude',
            kind: 'tool',
            text: 'Grep: foo',
            description: 'Searched for “foo”',
          },
        ],
      }),
    ),
    'Running Grep: foo',
  );
  assert.equal(
    workingLabel(
      thread({
        live: live({}),
        activity: [
          you,
          { at: 1, who: 'claude', kind: 'message', text: 'Sure' },
        ],
      }),
    ),
    'Replying',
  );
  assert.equal(
    workingLabel(thread({ live: live({ isWorking: false }) })),
    undefined,
  );
});

test('the turn title names the current action, its favicons, and what an approval waits on', () => {
  const you = { at: 0, who: 'you', kind: 'message', text: 'hi' } as const;
  const search: ActivityEntry = {
    at: 1,
    who: 'claude',
    kind: 'tool',
    text: 'Search EX271UZ review',
    links: [{ url: 'https://rtings.com/a' }],
  };
  const wait = {
    at: 1,
    who: 'harness',
    kind: 'event',
    text: 'Waiting on you: Search the web for “EX271UZ review”',
  } as const;
  const action = currentAction(
    thread({ live: live({}), activity: [you, search] }),
  );
  assert.equal(action?.label, 'Searching EX271UZ review');
  assert.deepEqual(action?.links, [{ url: 'https://rtings.com/a' }]);
  assert.equal(
    workingLabel(
      thread({
        status: 'needs-you',
        live: live({}),
        activity: [you, search, wait],
      }),
    ),
    'Waiting for your approval to search the web',
  );
  assert.equal(
    workingLabel(
      thread({
        status: 'needs-you',
        live: live({}),
        activity: [you, { ...search, text: 'Run pnpm test' }, wait],
      }),
    ),
    'Waiting for your approval to run pnpm test',
  );
  const approved = {
    at: 2,
    who: 'you',
    kind: 'event',
    text: 'Approved: search the web',
  } as const;
  assert.equal(
    workingLabel(
      thread({ live: live({}), activity: [you, search, wait, approved] }),
    ),
    'Searching EX271UZ review',
    'back to the call once answered',
  );
});
