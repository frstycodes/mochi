import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentPhase, pendingWork, workingLabel } from './agentPhase.ts';
import type { Thread } from './model.ts';

const thread = (patch: Partial<Thread>) => ({ status: 'running', activity: [{ at: 0, who: 'you', kind: 'message', text: 'hi' }], ...patch }) as Thread;
const live = (patch: Partial<NonNullable<Thread['live']>>) => ({ isWorking: true, usage: [], ...patch });

test('the avatar reads idle once a live turn ends, even though the thread stays running', () => {
  assert.equal(agentPhase(thread({ live: live({ starting: 'codex' }) })), 'start');
  assert.deepEqual(pendingWork(thread({ live: live({ starting: 'codex' }) })), { phase: 'start', label: 'Starting Codex' });
  assert.equal(agentPhase(thread({ live: live({}) })), 'think', 'started, nothing reported yet');
  const ran = thread({ live: live({}), activity: [{ at: 0, who: 'you', kind: 'message', text: 'hi' }, { at: 1, who: 'claude', kind: 'tool', text: 'Read src/a.ts' }] });
  assert.equal(agentPhase(ran), 'read');
  assert.equal(agentPhase({ ...ran, live: live({ isWorking: false }) }), 'idle', 'turn over');
  assert.equal(pendingWork(thread({ live: live({ isWorking: false }) })), undefined);
  assert.equal(agentPhase(thread({ status: 'needs-you', live: live({}) })), 'wait');
  assert.equal(agentPhase(thread({ status: 'review' })), 'idle', 'demo thread not running');
});

test('a live row says what the agent is doing while it works, and nothing once it stops', () => {
  const you = { at: 0, who: 'you', kind: 'message', text: 'hi' } as const;
  assert.equal(workingLabel(thread({ live: live({ starting: 'claude' }) })), 'Starting Claude Code');
  assert.equal(workingLabel(thread({ live: live({}) })), 'Thinking');
  assert.equal(workingLabel(thread({ live: live({}), activity: [you, { at: 1, who: 'claude', kind: 'tool', text: 'Edit src/index.ts +3 -1' }] })), 'Editing index.ts');
  assert.equal(workingLabel(thread({ live: live({}), activity: [you, { at: 1, who: 'claude', kind: 'tool', text: 'Run pnpm test' }] })), 'Running pnpm test');
  assert.equal(workingLabel(thread({ live: live({}), activity: [you, { at: 1, who: 'claude', kind: 'message', text: 'Sure' }] })), 'Replying');
  assert.equal(workingLabel(thread({ live: live({ isWorking: false }) })), undefined);
});
