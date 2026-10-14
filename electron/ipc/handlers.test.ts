import assert from 'node:assert/strict';
import test from 'node:test';
import { agentDecision } from './handlers.ts';

test('a question answer passes with one list of picks per question, typed answers included', () => {
  const decision = { kind: 'answer', answers: [['use gh pr create for now'], ['Redis', 'Postgres'], []] };
  assert.deepEqual(agentDecision(decision), decision);
});

test('a malformed decision is refused', () => {
  assert.throws(() => agentDecision({ kind: 'answer', answers: ['flat'] }), /list of string lists/);
  assert.throws(() => agentDecision({ kind: 'answer', answers: [[1]] }), /list of string lists/);
  assert.throws(() => agentDecision({ kind: 'maybe' }), /decision.kind/);
  assert.throws(() => agentDecision({ kind: 'allow', forSession: 'yes' }), /forSession/);
});
