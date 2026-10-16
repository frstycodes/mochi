import type { Gap } from '../goals/verdict.ts';
import { isMet, type Criterion, type Thread } from '../model.ts';

/**
 * The PR description Mochi writes for `open_pr`: facts from the goal and its checks, the agent's one line of why, and `noted`, the
 * gaps it opens with (unverified, accepted, or critical ones you chose Open anyway on) under Not verified.
 */
export function prBody(thread: Thread, why: string, noted: Gap[] = []) {
  const criteria = thread.criteria ?? [];
  const decided = thread.report?.decisions ?? [];
  return [
    '## What',
    thread.goal || thread.title,
    ...(decided.length ? ['', ...decided.map((d) => `- ${d}`)] : []),
    '',
    '## Why',
    why.trim(),
    ...(criteria.length ? ['', '## Checks', ...criteria.map(checkLine)] : []),
    ...(noted.length ? ['', '## Not verified', ...noted.map((g) => `- ${g.severity === 'critical' ? '**Critical, opened anyway:** ' : ''}${g.text}${g.quote ? ` (agent: "${g.quote}")` : ''}`)] : []),
  ].join('\n');
}

function checkLine(c: Criterion) {
  const proof = c.check?.status === 'passed' ? `\`${c.command}\` passed` : c.check?.status === 'failed' ? `\`${c.command}\` failed` : c.claim?.evidence;
  return `- [${isMet(c) ? 'x' : ' '}] ${c.text}${proof ? `: ${proof}` : ''}`;
}
