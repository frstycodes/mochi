import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Thread } from '../model.ts';
import { agentCalls } from '../runtime/live.ts';
import type { Action, State } from '../store/index.tsx';
import { parseSaved, toSaved } from '../store/saved.ts';
import { initialQueue } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { turnSummary } from '../summary.ts';
import { migrateReceived } from './threadMessages.ts';

const run = (s: State, action: Action) => threadsReducer(s, action);

function twoLiveThreads() {
  let s = { ...initialThreads(undefined, false), ...initialQueue(), spaceId: 'latitude', views: {} } as unknown as State;
  s = run(s, { type: 'create', title: 'Crypto module', provider: 'claude', project: null, isLive: true });
  s = run(s, { type: 'create', title: 'Sync engine', provider: 'codex', project: null, isLive: true });
  const [sender, receiver] = s.threads.slice(-2);
  return { s, sender, receiver };
}

test('a message from another thread reaches the agent with its sender, while the transcript keeps the bare text', () => {
  const { s, sender, receiver } = twoLiveThreads();
  const send: Action = { type: 'send', threadId: receiver.id, text: 'Keys rotate hourly', prompt: 'From "Crypto module": Keys rotate hourly', from: { threadId: sender.id, title: sender.title }, reason: '' };
  const next = run(s, send);
  assert.deepEqual(agentCalls(s, send, () => next).find((c) => c.method === 'send'), { method: 'send', threadId: receiver.id, text: 'From "Crypto module": Keys rotate hourly' });
  const entry = next.threads.find((t) => t.id === receiver.id)!.activity.at(-1)!;
  assert.equal(entry.text, 'Keys rotate hourly');
  assert.deepEqual(entry.from, { threadId: sender.id, title: 'Crypto module' });
});

test('saves from before `from` come back with the old prefix parsed into the sender', () => {
  const { s, sender, receiver } = twoLiveThreads();
  const legacy = run(s, { type: 'send', threadId: receiver.id, text: 'From "Crypto module": Keys rotate hourly\n\nSecond line', reason: '' });
  const gone = run(legacy, { type: 'send', threadId: receiver.id, text: 'From "Deleted thread": still readable', reason: '' });
  const mine = run(gone, { type: 'send', threadId: receiver.id, text: 'From here on, use pnpm', reason: '' });
  const restored = parseSaved(JSON.stringify(toSaved(mine)))!.threads.find((t) => t.id === receiver.id)!;
  const tail = restored.activity.filter((e) => e.kind === 'message').slice(-3).map((e) => ({ text: e.text, from: e.from }));
  assert.deepEqual(tail, [
    { text: 'Keys rotate hourly\n\nSecond line', from: { threadId: sender.id, title: 'Crypto module' } },
    { text: 'still readable', from: { title: 'Deleted thread' } },
    { text: 'From here on, use pnpm', from: undefined },
  ]);
});

test('migration leaves threads without the prefix untouched', () => {
  const threads = [{ id: 'a', title: 'A', activity: [{ at: 0, who: 'claude', kind: 'message', text: 'From "A": not yours' }] }] as unknown as Thread[];
  assert.equal(migrateReceived(threads)[0], threads[0]);
});

test('a finished group names the threads it messaged instead of counting an MCP call', () => {
  const call = { at: 0, who: 'claude' as const, kind: 'tool' as const, text: 'Mcp mochi: send_to_thread', mcp: { server: 'mochi', tool: 'send_to_thread' } };
  assert.equal(turnSummary([call, { ...call, text: 'Mcp linear: get_issue' }, { ...call, text: 'Run pnpm test' }]), 'Ran 1 command, messaged 1 thread, called 1 MCP tool');
});
