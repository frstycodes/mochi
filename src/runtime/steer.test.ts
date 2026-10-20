import assert from 'node:assert/strict';
import { test } from 'node:test';
import { queuedMessage } from '../chat/outbox.ts';
import type { Action, State } from '../store/index.tsx';
import { initialQueue } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { applyAgentEvent } from './apply.ts';
import { agentCalls } from './live.ts';

const base = () => ({ ...initialThreads(), ...initialQueue(), spaceId: 'latitude', views: {} }) as unknown as State;
const calls = (s: State, action: Action) => agentCalls(s, action, () => threadsReducer(s, action));

function working() {
  const s = threadsReducer(base(), { type: 'create', title: 'fix the cookie', provider: 'claude', project: '/Users/me/dev/app', isLive: true });
  const id = s.threads.at(-1)!.id;
  return { s, id, thread: (state: State) => state.threads.find((t) => t.id === id)! };
}

const steer = (id: string, draft: string): Action & { type: 'send' } => {
  const typed = queuedMessage(draft, { mentions: [], isCommand: false, typedSkills: [] });
  return { type: 'send', threadId: id, text: draft, reason: '', steers: true, typed };
};

test('a message sent mid-turn waits outside the transcript, then lands after the step that read it, marked seen', () => {
  let { s, id, thread } = working();
  s = applyAgentEvent(s, { threadId: id, type: 'message', text: 'Running the suite', isDelta: false });
  const send = steer(id, 'create a PR and merge');
  assert.deepEqual(calls(s, send), [{ method: 'send', threadId: id, text: 'create a PR and merge', steer: true, steerId: send.typed!.id }]);
  s = threadsReducer(s, send);
  assert.equal(thread(s).activity.some((e) => e.who === 'you' && e.text === 'create a PR and merge'), false, 'not in the transcript while unread');
  assert.equal(thread(s).steering?.length, 1);

  s = applyAgentEvent(s, { threadId: id, type: 'message', text: ' before I wrap up.', isDelta: true });
  s = applyAgentEvent(s, { threadId: id, type: 'tool', id: 't1', phase: 'start', text: 'Run pnpm test' });
  s = applyAgentEvent(s, { threadId: id, type: 'tool', id: 't1', phase: 'end', text: 'Run pnpm test' });
  s = applyAgentEvent(s, { threadId: id, type: 'steer-read', id: send.typed!.id });
  s = applyAgentEvent(s, { threadId: id, type: 'message', text: 'Opening the PR.', isDelta: false });

  const texts = thread(s).activity.filter((e) => e.kind !== 'event').map((e) => e.text);
  assert.deepEqual(texts.slice(-4), ['Running the suite before I wrap up.', 'Run pnpm test', 'create a PR and merge', 'Opening the PR.'], 'text written before the read stays above, the reply after it below');
  assert.equal(thread(s).activity.find((e) => e.text === 'create a PR and merge')?.isSeen, true);
  assert.equal(thread(s).steering, undefined);
});

test('taking a message back removes it without a transcript entry or another agent call', () => {
  let { s, id, thread } = working();
  const send = steer(id, 'also bump the version');
  s = threadsReducer(s, send);
  const takeBack: Action = { type: 'steer-take-back', threadId: id, id: send.typed!.id };
  assert.deepEqual(calls(s, takeBack), []);
  s = threadsReducer(s, takeBack);
  assert.equal(thread(s).steering, undefined);
  assert.equal(thread(s).activity.some((e) => e.text === 'also bump the version'), false);
  s = applyAgentEvent(s, { threadId: id, type: 'steer-read', id: send.typed!.id });
  assert.equal(thread(s).activity.some((e) => e.text === 'also bump the version'), false, 'a late read of a taken-back message logs nothing');
});

test("a report written while a message waited is superseded once the agent reads it, and isn't once you take it back", () => {
  const report = { decisions: [], left: [], question: 'Open a pull request?', by: 'claude' as const };
  let { s, id, thread } = working();
  const read = steer(id, 'create a PR and merge');
  s = threadsReducer(s, read);
  s = threadsReducer(s, { type: 'report', threadId: id, report });
  assert.equal(thread(s).report?.isSuperseded, undefined, 'not yet: the agent may never read it');
  s = applyAgentEvent(s, { threadId: id, type: 'steer-read', id: read.typed!.id });
  assert.equal(thread(s).report?.isSuperseded, true);

  const taken = steer(id, 'never mind');
  s = threadsReducer(s, taken);
  s = threadsReducer(s, { type: 'report', threadId: id, report });
  s = threadsReducer(s, { type: 'steer-take-back', threadId: id, id: taken.typed!.id });
  assert.equal(thread(s).report?.isSuperseded, undefined);
});

test('read after its turn ended, a message starts the next turn', () => {
  let { s, id, thread } = working();
  const send = steer(id, 'and the docs');
  s = threadsReducer(s, send);
  s = applyAgentEvent(s, { threadId: id, type: 'turn-end', status: 'done' });
  assert.equal(thread(s).live?.isWorking, false);
  s = applyAgentEvent(s, { threadId: id, type: 'steer-read', id: send.typed!.id });
  assert.equal(thread(s).live?.isWorking, true);
  assert.equal(thread(s).activity.at(-1)?.text, 'and the docs');
});
