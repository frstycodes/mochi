import { isMet, type Criterion, type Thread } from '../model.ts';

/** The PR description Mochi writes for `open_pr`: facts from the goal and its checks, the agent's one line of why. */
export function prBody(thread: Thread, why: string) {
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
  ].join('\n');
}

function checkLine(c: Criterion) {
  const proof = c.check?.status === 'passed' ? `\`${c.command}\` passed` : c.check?.status === 'failed' ? `\`${c.command}\` failed` : c.claim?.evidence;
  return `- [${isMet(c) ? 'x' : ' '}] ${c.text}${proof ? `: ${proof}` : ''}`;
}
