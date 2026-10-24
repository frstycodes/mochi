import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyShell, emptyThread, projectShell, projectThread, summarizeProjects, summarizeThread, type LoggedEvent } from './index.ts';

const event = (sequence: number, type: string, threadId: string | null, payload: unknown): LoggedEvent => ({ sequence, type, threadId, payload });

test('the shell folds saves, deletes and projects, drops stale items and advances past unknown types', () => {
  const items = [
    { _tag: 'event', event: event(1, 'thread.saved', 'a', summarizeThread('a', { thread: { title: 'A', status: 'idle', project: 'p' } })) },
    { _tag: 'event', event: event(2, 'thread.saved', 'b', summarizeThread('b', { thread: { title: 3 } })) },
    { _tag: 'event', event: event(3, 'thread.saved', 'a', summarizeThread('a', { thread: { title: 'A2' } })) },
    { _tag: 'event', event: event(2, 'thread.deleted', 'a', {}) },
    { _tag: 'event', event: event(4, 'thread.deleted', 'b', {}) },
    { _tag: 'event', event: event(5, 'projects.saved', null, { projects: summarizeProjects({ spaces: { s: { projects: [{ id: 'p', name: 'P', path: '/p' }] } } }) }) },
    { _tag: 'event', event: event(6, 'from.the.future', null, {}) },
  ] as const;
  const shell = items.reduce(projectShell, emptyShell);
  assert.deepEqual(shell, {
    sequence: 6,
    threads: [{ id: 'a', title: 'A2', status: null, project: null }],
    projects: [{ id: 'p', name: 'P', path: '/p', space: 's' }],
  });
  assert.equal(projectShell(shell, { _tag: 'snapshot', shell: { ...emptyShell, sequence: 5 } }), shell);
});

test('a thread snapshot replaces the events it covers', () => {
  let view = projectThread(emptyThread, { _tag: 'event', event: event(3, 'agent.text', 't', { text: 'hi' }) });
  view = projectThread(view, { _tag: 'event', event: event(3, 'agent.text', 't', {}) });
  assert.equal(view.events.length, 1);
  view = projectThread(view, { _tag: 'snapshot', sequence: 4, saved: { thread: { id: 't' } } });
  view = projectThread(view, { _tag: 'event', event: event(5, 'agent.text', 't', {}) });
  assert.deepEqual(view, { sequence: 5, saved: { thread: { id: 't' } }, events: [event(5, 'agent.text', 't', {})] });
});
