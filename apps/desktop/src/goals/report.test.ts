import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { Thread } from '../model.ts';
import type { State } from '../store/index.tsx';
import { threadsReducer } from '../store/threads.ts';
import {
  currentReport,
  showsVerdictCard,
  suggestedReply,
  turnReport,
} from './report.ts';

test('answering the next move keeps it in the chat as a record and hides the card until the next turn ends', () => {
  const t = {
    id: 't',
    status: 'running',
    steps: [],
    activity: [],
    prs: [],
    idle: { at: 5 },
  } as unknown as Thread;
  const state = {
    now: 6,
    threads: [t],
    checkpoints: { t: [] },
    checkpointSeq: 0,
  } as unknown as State;
  assert.equal(showsVerdictCard(t), true);
  const record = {
    summary: 'Added the limiter.',
    question: 'Open a PR?',
    answer: 'Open pull request',
  };
  const [after] = threadsReducer(state, {
    type: 'next-move-record',
    threadId: 't',
    record,
  }).threads;
  assert.equal(showsVerdictCard(after), false);
  assert.deepEqual(after.activity.at(-1)?.nextMove, record);
});

test('without a goal, a reported turn still ends in the next-move card, and the next turn brings it back after an answer', () => {
  const t = {
    id: 't',
    status: 'running',
    steps: [],
    activity: [],
    prs: [],
    report: {
      at: 5,
      by: 'claude',
      decisions: [],
      left: [],
      next: 'Commit it?',
      options: [{ label: 'Commit', reply: 'Commit it.' }],
    },
  } as unknown as Thread;
  const at = (now: number, s: Thread) =>
    ({
      now,
      threads: [s],
      checkpoints: { t: [] },
      checkpointSeq: 0,
    }) as unknown as State;
  assert.equal(showsVerdictCard(t), true);
  const [answered] = threadsReducer(at(6, t), {
    type: 'next-move-record',
    threadId: 't',
    record: { question: 'Commit it?', answer: 'Not now' },
  }).threads;
  assert.equal(showsVerdictCard(answered), false);
  const reported = { ...answered, report: { ...t.report!, at: 9 } };
  const [idle] = threadsReducer(at(10, reported), {
    type: 'idle-start',
    threadId: 't',
  }).threads;
  assert.equal(showsVerdictCard(idle), true);
});

test("a quick turn without its own report doesn't bring back the last turn's question", () => {
  const t = {
    id: 't',
    status: 'running',
    steps: [],
    activity: [],
    prs: [],
  } as unknown as Thread;
  const at = (now: number, s: Thread) =>
    ({
      now,
      threads: [s],
      checkpoints: { t: [] },
      checkpointSeq: 0,
    }) as unknown as State;
  const report = {
    by: 'claude' as const,
    recap: '',
    decisions: [],
    ask: 'Wait for it?',
    actions: [{ label: 'Wait' }],
  };
  const [reported] = threadsReducer(at(5, t), {
    type: 'report',
    threadId: 't',
    report,
  }).threads;
  const [first] = threadsReducer(at(5, reported), {
    type: 'idle-start',
    threadId: 't',
  }).threads;
  assert.equal(turnReport(first)?.ask, 'Wait for it?');
  const [second] = threadsReducer(at(5, first), {
    type: 'idle-start',
    threadId: 't',
  }).threads;
  assert.equal(turnReport(second), undefined);
  assert.equal(currentReport(second), null, 'the sidebar drops it too');
});

test("the composer suggests the agent's pick, never its question, and nothing without answers", () => {
  const at = (now: number, s: Thread) =>
    ({
      now,
      threads: [s],
      checkpoints: { t: [] },
      checkpointSeq: 0,
    }) as unknown as State;
  const ended = (report: Record<string, unknown>) => {
    const t = {
      id: 't',
      status: 'running',
      steps: [],
      activity: [],
      prs: [],
    } as unknown as Thread;
    const [reported] = threadsReducer(at(5, t), {
      type: 'report',
      threadId: 't',
      report: { by: 'claude', recap: '', decisions: [], ...report } as never,
    }).threads;
    return threadsReducer(at(5, reported), {
      type: 'idle-start',
      threadId: 't',
    }).threads[0];
  };
  const ask = 'Commit both fixes and open a PR into `main`?';
  const actions = [{ label: 'Commit and open a PR' }, { label: 'Only commit' }];
  assert.equal(suggestedReply(ended({ ask, actions })), 'Commit and open a PR');
  assert.equal(suggestedReply(ended({ ask })), undefined);
  assert.equal(
    suggestedReply(ended({ ask, actions, isSuperseded: true })),
    undefined,
  );
  assert.equal(
    suggestedReply({
      ...ended({ ask, actions }),
      live: { isWorking: true },
    } as unknown as Thread),
    undefined,
  );
});
