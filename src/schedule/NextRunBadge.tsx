import { Clock } from 'reicon-react';
import { GitPullRequestIcon } from '@/icons/github';
import { shortRunTime } from './cron';
import { describeTrigger } from './describe';
import { triggerNextRun, useTrigger } from './useSchedules';

/** A sidebar row's small clock (a PR icon for a pull request trigger): the next run time, "PR" while waiting on a pull request, or "Paused". */
export function NextRunBadge({ threadId }: { threadId: string }) {
  const trigger = useTrigger(threadId);
  if (!trigger) return null;
  const now = Date.now();
  const next = triggerNextRun(trigger, now);
  const label = trigger.isPaused ? 'Paused' : next ? shortRunTime(next, now) : 'PR';
  const what = describeTrigger(trigger.when);
  const Icon = trigger.when.kind === 'pr' ? GitPullRequestIcon : Clock;
  return (
    <span className="flex shrink-0 items-center gap-0.5 tabular" aria-label={`Scheduled: ${what}, ${trigger.isPaused ? 'paused' : next ? `next run ${label}` : 'waits for a pull request'}`} title={what}>
      <Icon aria-hidden className="size-3" />
      {label}
    </span>
  );
}
