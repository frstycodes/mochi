import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seedThreads } from '../model.ts';
import type { Action } from '../store/index.tsx';
import { agentAskSecondOpinion } from './run.ts';

const demoThread = () => {
  const thread = seedThreads().find((t) => t.repo && !t.live && t.providers[0] === 'claude');
  assert.ok(thread, 'a demo thread with a project');
  return { ...thread, reviews: [] };
};

test('an agent-asked second opinion sends its verdict back to the agent, steering its turn', async () => {
  const thread = demoThread();
  const actions: Action[] = [];
  const sent = new Promise<Extract<Action, { type: 'send' }>>((resolve) => {
    const provider = agentAskSecondOpinion(thread, (action) => {
      actions.push(action);
      if (action.type === 'send') resolve(action);
    });
    void provider.then((p) => assert.equal(p, 'codex'));
  });
  const send = await sent;
  assert.equal(send.threadId, thread.id);
  assert.equal(send.steers, true);
  assert.equal(send.secondOpinion?.provider, 'codex', 'marked, so the chat shows the card there instead of a bubble');
  assert.match(send.text, /^\[Second opinion you asked for\] Codex reviewed the diff \(verdict: \w+\)[\s\S]*This is the reviewer, not the user\./);
  const start = actions.find((a) => a.type === 'review-start');
  assert.equal(start?.type === 'review-start' && start.review.isAgentAsked, true);
});

test('an agent-asked second opinion refuses while one is already running', async () => {
  const thread = demoThread();
  const running = { id: 'so-1', provider: 'codex' as const, afterIndex: 0, startedAt: 0, status: 'running' as const, steps: [] };
  await assert.rejects(agentAskSecondOpinion({ ...thread, reviews: [running] }, () => {}), /already running/);
});
