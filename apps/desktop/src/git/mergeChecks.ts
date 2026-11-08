import { plural } from '@mochi/domain/lib/format';
import { CHECK } from './Checks';
import type { CheckTally } from './MergeButton';
import type { PrCheck } from '../host/types/git';

/** Completed results first; preserve the order within each group. */
export function finishedChecksFirst(checks: PrCheck[]): PrCheck[] {
  return checks.toSorted(
    (a, b) => Number(a.state === 'pending') - Number(b.state === 'pending'),
  );
}

export function mergeCheckTitle({ failed, running }: CheckTally): string {
  if (failed && running)
    return `${failed} ${plural(failed, 'check', 'checks')} failed, ${running} still running`;
  if (failed) return `${failed} ${plural(failed, 'check', 'checks')} failed`;
  if (running)
    return `${running} ${plural(running, 'check', 'checks')} still running`;
  return 'All checks finished';
}

export function mergeCheckSummary(checks: PrCheck[]): string {
  return (['fail', 'pending', 'pass', 'skipping', 'cancel'] as const)
    .flatMap((state) => {
      const count = checks.filter((check) => check.state === state).length;
      return count ? [`${count} ${CHECK[state].label.toLowerCase()}`] : [];
    })
    .join(' · ');
}
