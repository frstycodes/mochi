import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Action, State } from '../store/index.tsx';
import { initialQueue } from '../store/queue.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { agentCalls } from '../runtime/live.ts';
import type { Thread } from '../model.ts';
import { mentionOptions, mentionQuery, withoutQuery, withReferences, type Mention } from './mentions.ts';

const base = () => ({ ...initialThreads(), ...initialQueue(), spaceId: 'latitude', views: {} }) as unknown as State;
const calls = (s: State, action: Action) => agentCalls(s, action, () => threadsReducer(s, action));

const other = {
  id: 'auth',
  title: 'Fix "login" redirect',
  goal: 'Users land back where they signed in',
  status: 'running',
  repo: { project: 'web', branch: 'fix/login' },
  steps: [{ status: 'done' }, { status: 'running' }],
  activity: [
    { kind: 'message', who: 'you', text: 'Keep the return URL in state' },
    { kind: 'tool', who: 'claude', text: 'Edit src/auth.ts' },
    { kind: 'message', who: 'claude', text: `Done.\n${'x'.repeat(500)}` },
  ],
} as unknown as Thread;
const shot = { mediaType: 'image/jpeg', data: 'AAAA' } as const;

test('@ query is the last word after an @, never an email', () => {
  assert.equal(mentionQuery('@'), '');
  assert.equal(mentionQuery('look at @Saf'), 'Saf');
  assert.equal(mentionQuery('mail a@b.co'), null);
  assert.equal(mentionQuery('@Saf now'), null);
  assert.equal(withoutQuery('look at @Saf'), 'look at ');
});

test('options list other threads, then windows, by title', () => {
  const windows = [{ id: 'window:1', title: 'Safari — Docs' }];
  assert.deepEqual(
    mentionOptions('', [other], windows, 'auth').map((o) => o.kind),
    ['window'],
    'the thread you are in is not offered',
  );
  assert.deepEqual(
    mentionOptions('LOG', [other], windows, 'x').map((o) => o.kind),
    ['thread'],
  );
});

test('a thread reference becomes a digest and a window reference its screenshot, in the prompt the agent gets', () => {
  const create: Action = { type: 'create', title: 'reply with ok', provider: 'claude', project: '/Users/me/dev/harness', isLive: true, controls: { model: 'sonnet-5.5', effort: 'Low', access: 'Manual' } };
  let s = base();
  const id = calls(s, create)[0].threadId;
  s = threadsReducer(s, create);

  const mentions: Mention[] = [
    { kind: 'thread', id: 'auth', title: other.title },
    { kind: 'window', id: 'window:1', title: 'Safari — Docs', image: shot },
  ];
  const ref = withReferences('why does it loop?', mentions, [other]);
  assert.equal(ref.text, '@Fix "login" redirect @Safari — Docs\n\nwhy does it loop?');
  assert.match(ref.prompt, /<thread title="Fix &quot;login&quot; redirect">\nGoal: Users land back where they signed in\nStatus: running, 1\/2 steps done, web on fix\/login\nyou: Keep the return URL in state\nclaude: Done\. x+…\n<\/thread>/);
  assert.doesNotMatch(ref.prompt, /Edit src\/auth\.ts/, 'tool calls stay out of the digest');
  assert.match(ref.prompt, /<window title="Safari — Docs">Screenshot of this window attached\.<\/window>\n\nwhy does it loop\?$/);

  const send: Action = { type: 'send', threadId: id, text: ref.text, drift: 'on-goal', reason: '', prompt: ref.prompt, images: ref.images };
  assert.deepEqual(calls(s, send), [{ method: 'send', threadId: id, text: ref.prompt, images: [shot] }]);
  const said = threadsReducer(s, send).threads.find((t) => t.id === id)!.activity.at(-1)!;
  assert.equal(said.text, ref.text, 'the transcript keeps your message, not the injected context');
});

test('no references leaves the message alone', () => {
  assert.deepEqual(withReferences('hi', [], []), { text: 'hi', prompt: 'hi', images: [] });
});
