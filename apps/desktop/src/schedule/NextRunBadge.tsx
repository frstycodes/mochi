import { Clock } from '@/icons';
import { useNow } from '../useNow';
import { shortRunTime } from '@mochi/domain/schedule/cron';
import { describeTrigger } from './describe';
import type { Trigger } from '../host/types/schedule';
import { parseRemoteThreadId } from '../remote/ids';
import { triggerNextRun, useRemoteTrigger, useTrigger } from './useSchedules';

/** A sidebar row's small clock: the next run time, "PR" for a pull request trigger, or "Paused". */
export function NextRunBadge({ threadId }: { threadId: string }) {
  const remote = parseRemoteThreadId(threadId);
  return remote ? (
    <RemoteNextRun remote={remote} />
  ) : (
    <LocalNextRun threadId={threadId} />
  );
}

function LocalNextRun({ threadId }: { threadId: string }) {
  return <TriggerClock trigger={useTrigger(threadId)} />;
}

function RemoteNextRun({
  remote,
}: {
  remote: { machineId: string; threadId: string };
}) {
  return <TriggerClock trigger={useRemoteTrigger(remote)} />;
}

function TriggerClock({ trigger }: { trigger: Trigger | undefined }) {
  const now = useNow(60_000);
  if (!trigger) return null;
  const next = triggerNextRun(trigger, now);
  const label = trigger.isPaused
    ? 'Paused'
    : next
      ? shortRunTime(next, now)
      : 'PR';
  const what = describeTrigger(trigger.when);
  return (
    <span
      className="flex shrink-0 items-center gap-0.5 tabular"
      aria-label={`Scheduled: ${what}, ${trigger.isPaused ? 'paused' : next ? `next run ${label}` : 'waits for a pull request'}`}
      title={what}
    >
      <Clock aria-hidden className="size-3" />
      {label}
    </span>
  );
}
