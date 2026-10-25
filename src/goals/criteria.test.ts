import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { Criterion } from '../model.ts';
import { criterionState } from './criteria.ts';

const claim = {
  evidence: 'curl -i shows Retry-After',
  at: 0,
  by: 'claude' as const,
};
const check = (status: 'running' | 'passed' | 'failed') => ({ status, at: 0 });
const c = (patch: Partial<Criterion> = {}): Criterion => ({
  id: 'c1',
  text: 'Every 429 carries Retry-After',
  ...patch,
});

test("a check outweighs the agent's claim; a claim alone is only claimed", () => {
  assert.equal(criterionState(c()), 'open');
  assert.equal(criterionState(c({ claim })), 'claimed');
  assert.equal(
    criterionState(c({ claim, check: check('passed') })),
    'verified',
  );
  assert.equal(criterionState(c({ claim, check: check('failed') })), 'failed');
  assert.equal(
    criterionState(c({ claim, check: check('running') })),
    'running',
  );
});

test('user confirmation verifies judged criteria, never overrides command checks', () => {
  assert.equal(criterionState(c({ claim }), true), 'verified');
  assert.equal(
    criterionState(c({ command: 'pnpm test', claim }), true),
    'claimed',
  );
  assert.equal(criterionState(c({ check: check('failed') }), true), 'failed');
});
