import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { Step, Thread } from '../model.ts';
import { idleVerdict } from './verdict.ts';

const step = (id: string, status: Step['status']) =>
  ({ id, title: id, status }) as Step;

const thread = (t: Partial<Thread> = {}) =>
  ({
    id: 't',
    repo: { project: 'harness', branch: 'fix/x' },
    status: 'running',
    steps: [],
    activity: [],
    prs: [],
    live: { isWorking: false },
    ...t,
  }) as Thread;

function pick(v: ReturnType<typeof idleVerdict>) {
  return v && [v.kind, v.chip, v.reason];
}

test('a working thread has no verdict', () => {
  assert.equal(idleVerdict(thread({ live: { isWorking: true } })), null);
});

test('a thread with nothing to say is plainly idle', () => {
  assert.deepEqual(pick(idleVerdict(thread())), ['idle', 'Idle', 'Idle']);
});

test('a question in the tray reads Question, a blocked step reads Approval', () => {
  assert.deepEqual(pick(idleVerdict(thread({ status: 'needs-you' }))), [
    'needs-you',
    'Question',
    'Waiting on your answer',
  ]);
  assert.deepEqual(
    pick(
      idleVerdict(
        thread({
          status: 'needs-you',
          steps: [step('Run the migration', 'blocked')],
        }),
      ),
    ),
    ['needs-you', 'Approval', 'Paused before "Run the migration"'],
  );
});

test('a limit or a failed turn reads stalled before anything else', () => {
  assert.deepEqual(
    pick(
      idleVerdict(
        thread({
          status: 'needs-you',
          live: { isWorking: false, limit: { label: 'Weekly' } },
        }),
      ),
    ),
    ['stalled', 'Limit', 'Weekly limit'],
  );
  const activity = [
    {
      at: 1,
      who: 'harness' as const,
      kind: 'event' as const,
      text: 'Turn failed: Claude Code exited with code 1',
    },
  ];
  assert.deepEqual(
    pick(idleVerdict(thread({ queuePause: 'failed', activity }))),
    ['stalled', 'Error', 'Claude Code exited with code 1'],
  );
});

test("a question from an earlier turn's report is answered: once you replied and the agent went idle again, it no longer reads Needs you", () => {
  const report = {
    by: 'claude' as const,
    decisions: [],
    left: [],
    question: 'Commit it as fix(sum)?',
    at: 862,
  };
  assert.deepEqual(
    pick(idleVerdict(thread({ report, idle: { at: 862 } }))),
    ['needs-you', 'Question', 'Commit it as fix(sum)?'],
    'asked this turn',
  );
  assert.deepEqual(pick(idleVerdict(thread({ report, idle: { at: 864 } }))), [
    'idle',
    'Idle',
    'Idle',
  ]);
  assert.deepEqual(
    pick(
      idleVerdict(
        thread({
          report: { ...report, isSuperseded: true },
          idle: { at: 862 },
        }),
      ),
    ),
    ['idle', 'Idle', 'Idle'],
    'written before your message',
  );
});
