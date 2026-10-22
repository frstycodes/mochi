import { Clock, Edit, Pause, Play, PlayCircle, Trash } from '@/icons';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { toast } from '../../toast/store.ts';
import { host } from '../../host';
import type { ScheduleRun, Trigger } from '../../host/types/schedule';
import { shortRunTime } from '../../schedule/cron';
import { describeTrigger } from '../../schedule/describe';
import { openSchedule } from '../../schedule/ScheduleDialog';
import { runOutcome } from '../../schedule/slice';
import { triggerNextRun, useSchedules } from '../../schedule/useSchedules';
import { useHarness, useDispatch } from '../../store';
import { IconSwap, TooltipIconButton } from '../../ui';
import { goHome } from '../../routes/nav';
import { SettingsGroup, SettingsRow } from '../parts';

export function SchedulesSection() {
  const triggers = useSchedules();
  if (!triggers.length) return <NoSchedules />;
  return (
    <div className="flex flex-col gap-10">
      <SettingsGroup id="schedules" footer="Runs start each thread's agent in its worktree without opening it, while Mochi is running, windows open or not. Add one from a thread's menu or the clock in the new-thread composer.">
        {triggers.map((t) => (
          <TriggerRow key={t.threadId} trigger={t} />
        ))}
      </SettingsGroup>
    </div>
  );
}

/** What a schedule is and where one starts: the clock in the new-thread composer, one click away. */
function NoSchedules() {
  const dispatch = useDispatch();
  const startOne = () => {
    goHome();
    dispatch({ type: 'go', view: { kind: 'new' } });
  };
  return (
    <Empty data-setting-id="schedules" className="rounded-xl border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Clock />
        </EmptyMedia>
        <EmptyTitle>No schedules yet</EmptyTitle>
        <EmptyDescription>A schedule runs a thread's agent on its own, on a timetable or when a pull request changes, in its worktree, while Mochi is running. Add one with the clock in the new-thread composer, or from a thread's menu.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" onClick={startOne}>
          New thread
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function TriggerRow({ trigger }: { trigger: Trigger }) {
  const { state } = useHarness();
  const thread = state.threads.find((t) => t.id === trigger.threadId);
  const now = Date.now();
  const next = triggerNextRun(trigger, now);
  const last = trigger.runs.at(-1);
  const when = [describeTrigger(trigger.when), trigger.isPaused ? 'Paused' : next && `next ${shortRunTime(next, now)}`].filter(Boolean).join(' · ');
  const attempt = (what: string, run: () => Promise<void>) => run().catch((error: Error) => toast.error(`${what} failed: ${error.message}`));
  return (
    <SettingsRow
      label={<span className="block truncate">{thread ? trigger.name : `${trigger.name} (thread deleted)`}</span>}
      description={
        <>
          <span className="block truncate">{when}</span>
          {!!last && <span className="block truncate">{lastRun(last, now)}</span>}
        </>
      }
      control={
        <div className="flex items-center gap-0.5">
          {!!thread && (
            <TooltipIconButton label="Run now" hint="Starts a run in the background, unless the thread is working" onClick={() => attempt('Run now', () => host.schedule.runNow(trigger.threadId).then(() => void toast.success(`Running "${trigger.name}"`)))}>
              <PlayCircle />
            </TooltipIconButton>
          )}
          <TooltipIconButton label={trigger.isPaused ? 'Resume' : 'Pause'} hint={trigger.isPaused ? 'Runs from the next scheduled time; missed ones stay skipped' : 'Stops runs until you resume'} onClick={() => attempt('Pausing', () => host.schedule.setPaused(trigger.threadId, !trigger.isPaused))}>
            <IconSwap id={trigger.isPaused ? 'play' : 'pause'}>{trigger.isPaused ? <Play /> : <Pause />}</IconSwap>
          </TooltipIconButton>
          {!!thread && (
            <TooltipIconButton label="Edit" hint="Change when it runs and what it's asked" onClick={() => openSchedule(trigger.threadId)}>
              <Edit />
            </TooltipIconButton>
          )}
          <TooltipIconButton label="Delete" hint="Removes the schedule; the thread stays" onClick={() => attempt('Deleting', () => host.schedule.remove(trigger.threadId))}>
            <Trash />
          </TooltipIconButton>
        </div>
      }
    />
  );
}

function lastRun(run: ScheduleRun, now: number) {
  if (run.status === 'running') return `Running since ${shortRunTime(run.startedAt, now)}`;
  return `Last run ${shortRunTime(run.endedAt ?? run.startedAt, now)} ${runOutcome(run)}`;
}
