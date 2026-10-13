import type { RunResult } from '../fixtures.ts';

// "fail 0" / "0 failed" is a summary that nothing failed, not a failure.
const FAIL = /[✗✖×]|\b(error|failure)\b|\bfail(ed|s)?\b(?!\s*[:=]?\s*0\b)(?<!\b0 fail(ed|s)?)/i;
const PASS = /[✓✔]|\b(pass(ed|es)?|ok)\b/i;

/** A live command's output as toned lines: failures red, passes green, the rest plain. A heuristic: tools print these words in their own ways. */
export function outputLines(output: string): RunResult['lines'] {
  const text = output.replace(/\n+$/, '');
  if (!text) return [];
  return text.split('\n').map((line) => ({ text: line, tone: FAIL.test(line) ? 'fail' : PASS.test(line) ? 'pass' : 'plain' }));
}
