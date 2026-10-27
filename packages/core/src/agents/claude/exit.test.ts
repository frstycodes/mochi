import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { exitEvent } from './exit.ts';

// What the SDK threw for new-275..277 when an agent's `pkill -f "cat" -n` SIGTERMed every Claude Code process, minutes after their turns ended done.
const KILLED = new Error('Claude Code process exited with code 143');

test('a process killed between turns ends no turn', () => {
  assert.equal(exitEvent('new-275', false, KILLED), null);
});

test('a process killed mid-turn fails that turn with its error', () => {
  assert.deepEqual(exitEvent('new-275', true, KILLED), {
    threadId: 'new-275',
    type: 'turn-end',
    status: 'failed',
    error: 'Claude Code process exited with code 143',
  });
});
