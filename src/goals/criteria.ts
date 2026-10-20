import type { Criterion } from '../model.ts';

export type CriterionState = 'verified' | 'claimed' | 'failed' | 'running' | 'open';

/** Verified by a passing check or user confirmation; a failed check outweighs either. */
export function criterionState(c: Criterion, isConfirmed = false): CriterionState {
  if (c.check?.status === 'running') return 'running';
  if (c.check?.status === 'failed') return 'failed';
  if (c.check?.status === 'passed') return 'verified';
  if (!c.command && isConfirmed) return 'verified';
  return c.claim ? 'claimed' : 'open';
}
