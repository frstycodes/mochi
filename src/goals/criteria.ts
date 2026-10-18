import type { Criterion } from '../model.ts';

export type CriterionState = 'verified' | 'claimed' | 'failed' | 'running' | 'open';

/** Verified: Mochi's check passed. Claimed: only the agent's word. A failed check outweighs a claim. */
export function criterionState(c: Criterion): CriterionState {
  if (c.check?.status === 'running') return 'running';
  if (c.check?.status === 'failed') return 'failed';
  if (c.check?.status === 'passed') return 'verified';
  return c.claim ? 'claimed' : 'open';
}
