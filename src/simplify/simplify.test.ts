import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_PREFS } from '../settings/prefs.ts';
import type { State } from '../store/index.tsx';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { localSimplify, rulesKey, simplifyPrompt, wordCount } from './simplify.ts';

const reply = 'I kept the old cookie name. Then I added a test.\n\n```ts\nexport const COOKIE = "latitude.sid";\n```\n\nShould the 429 body be JSON?';

test('the local fallback makes one bullet per sentence and keeps code blocks whole', () => {
  assert.equal(localSimplify(reply, 'short'), '- I kept the old cookie name.\n- Then I added a test.\n- Should the 429 body be JSON?\n```ts\nexport const COOKIE = "latitude.sid";\n```');
  assert.equal(wordCount(reply), 17, 'code is not counted toward "long"');
});

test('the prompt asks for the simplest form, carries your rules, and any rule change makes stored versions stale', () => {
  const prompt = simplifyPrompt('x', { ...DEFAULT_PREFS, simplifyRules: ' no jargon ' });
  assert.match(prompt, /^Write the simplest form that fits.*Use bullets only when.*number steps only when their order matters\.\nKeep it short.*\n.*stay exactly as written\.\nIf anything needs the reader.*\nThe reader's own rules: no jargon\n\nReply to simplify:\nx$/s);
  assert.notEqual(rulesKey(DEFAULT_PREFS), rulesKey({ ...DEFAULT_PREFS, simplifyLength: 'detailed' }));
});

test('the simplified version sits on the message for display; the message text the agent saw is unchanged', () => {
  const state = { ...initialThreads(), queue: [], spaceId: 'latitude', views: {} } as unknown as State;
  const rl = state.threads.find((t) => t.id === 'rl')!;
  const index = rl.activity.findIndex((e) => e.kind === 'message' && e.who === 'claude');
  let s = threadsReducer(state, { type: 'simplified', threadId: 'rl', index, text: '- short', rulesKey: 'k' });
  const entry = s.threads.find((t) => t.id === 'rl')!.activity[index];
  assert.deepEqual(entry.simplified, { text: '- short', rulesKey: 'k', isShown: true });
  assert.equal(entry.text, rl.activity[index].text);
  s = threadsReducer(s, { type: 'simplify-toggle', threadId: 'rl', index });
  assert.equal(s.threads.find((t) => t.id === 'rl')!.activity[index].simplified!.isShown, false);
});
