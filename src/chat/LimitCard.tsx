import { useEffect, useState } from 'react';
import { Hourglass } from 'reicon-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { host } from '../host';
import type { ActivityEntry, Provider, Thread } from '../model';
import { openRewind } from '../rewind/requests';
import { PROVIDER_NAME } from '../rewind/handoff';
import { HARNESSES } from '../settings/harnesses';
import { limitPhase, type AccountHold } from '../runtime/limits';
import { useHarness } from '../store';
import { ProviderMark } from '../ui';
import { resetLabel, untilLabel } from '../usage/limits';
import { EventLine } from './MochiWidget';

/** Where a thread paused on a usage limit: the live card while the pause lasts (only the latest such entry), then a one-line record. */
export function LimitEntry({ thread, entry }: { thread: Thread; entry: ActivityEntry }) {
  const limit = thread.live?.limit;
  const isCurrent = !!limit && thread.activity.findLast((e) => e.isLimit) === entry;
  if (!isCurrent) return <EventLine text={entry.text} at={entry.at} />;
  return <LimitCard thread={thread} title={entry.text} limit={limit} />;
}

/** Every way forward is a click: nothing resumes, bills or switches harness unless you chose it for this thread. */
function LimitCard({ thread, title, limit }: { thread: Thread; title: string; limit: NonNullable<NonNullable<Thread['live']>['limit']> }) {
  const { dispatch } = useHarness();
  const provider = thread.providers[0];
  const other: Provider = provider === 'claude' ? 'codex' : 'claude';
  const until = useUntil(limit.resetsAt);
  const isReset = until <= 0;
  const hasApiKey = useHasApiKey(provider) && !thread.live?.isOnApiKey;
  const resume = (onApiKey?: boolean) => dispatch({ type: 'resume', threadId: thread.id, onApiKey });
  const arm = (isOn: boolean) => dispatch({ type: 'limit-auto-resume', threadId: thread.id, isOn });
  const at = limit.resetsAt && resetLabel(limit.resetsAt);

  return (
    <Card size="sm" role="group" aria-label={title}>
      <CardHeader>
        <CardDescription className="flex items-center gap-1 type-caption font-medium text-warning">
          <Hourglass aria-hidden className="size-3.5" />
          Paused until reset
        </CardDescription>
        <CardTitle className="text-pretty">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 type-body text-muted-foreground">
        {at ? (
          <p className="tabular">
            {isReset ? `Reset at ${at}.` : `Resets in ${untilLabel(until)}, at ${at}.`} {limit.autoResume && !isReset && 'Resumes on its own then.'}
          </p>
        ) : (
          <p>No reset time was reported.</p>
        )}
        <p className="type-caption text-subtle-foreground text-pretty">Nothing starts on this account until then; messages you send wait in the queue.</p>
      </CardContent>
      <CardFooter className="flex-wrap justify-end gap-2 border-t-0 bg-transparent pt-0">
        <Button variant="ghost" size="sm" onClick={() => openRewind({ kind: 'handoff', threadId: thread.id })}>
          <ProviderMark provider={other} size={14} />
          Hand off to {PROVIDER_NAME[other]}
        </Button>
        {hasApiKey && (
          <Button variant="outline" size="sm" onClick={() => resume(true)}>
            Use API key
            <span className="text-subtle-foreground">· billed per use</span>
          </Button>
        )}
        <ResumeButton isReset={isReset || !at} isArmed={!!limit.autoResume} at={at} onResume={() => resume()} onArm={arm} />
      </CardFooter>
    </Card>
  );
}

function ResumeButton({ isReset, isArmed, at, onResume, onArm }: { isReset: boolean; isArmed: boolean; at?: string; onResume: () => void; onArm: (isOn: boolean) => void }) {
  if (isReset)
    return (
      <Button size="sm" onClick={onResume}>
        Resume
      </Button>
    );
  if (isArmed)
    return (
      <Button variant="outline" size="sm" onClick={() => onArm(false)}>
        Don&apos;t resume at {at}
      </Button>
    );
  return (
    <Button size="sm" onClick={() => onArm(true)}>
      Resume at {at}
    </Button>
  );
}

/** Milliseconds left until `at`, re-rendering each minute (and at the moment it passes); 0 once past or with no time. */
export function useUntil(at?: string) {
  const target = at ? Date.parse(at) : NaN;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!(target > Date.now())) return;
    const id = window.setInterval(() => setNow(Date.now()), Math.min(60_000, Math.max(1000, target - Date.now())));
    return () => window.clearInterval(id);
  }, [target, now]);
  return target > now ? target - now : 0;
}

function useHasApiKey(provider: Provider) {
  const [isSet, setSet] = useState(false);
  useEffect(() => {
    if (!HARNESSES[provider].apiKey) return;
    let isCurrent = true;
    host.settings.apiKey(provider).then(
      (key) => isCurrent && setSet(key.isSet),
      () => {},
    );
    return () => {
      isCurrent = false;
    };
  }, [provider]);
  return isSet;
}

/** The header's status chip while a limit shapes the thread: "Paused · resets 3:40 PM", or the wrap-up in flight. */
export function LimitChip({ thread }: { thread: Thread }) {
  const phase = limitPhase(thread);
  const label = limitStatus(thread);
  if (!label) return null;
  return (
    <Badge variant="secondary" className={cn('hidden tabular @md:inline-flex', phase === 'paused' && 'bg-warning/12 text-warning dark:bg-warning/20')}>
      <Hourglass aria-hidden />
      {label}
    </Badge>
  );
}

/** One line while a limit stops or winds down the thread, shared by the header chip, the sidebar row and the summary; approaching says nothing here (the ring and the transcript do). */
export function limitStatus(thread: Thread) {
  const live = thread.live;
  const phase = limitPhase(thread);
  if (phase === 'paused') {
    const at = live!.limit!.resetsAt;
    if (!at) return 'Paused · usage limit';
    return Date.parse(at) > Date.now() ? `Paused · resets ${resetLabel(at)}` : 'Paused · limit reset';
  }
  if (phase === 'wrapping-up') return `Wrapping up · ${live!.limitWarning!.label.toLowerCase()} limit ${Math.round(live!.limitWarning!.usedPct)}%`;
}

/** Why send waits instead of starting a turn: this thread's pause, or another thread's on the same account. */
export function HeldHint({ held }: { held: AccountHold }) {
  const until = useUntil(held.resetsAt);
  return (
    <span className="ml-auto flex min-w-0 items-center gap-1 text-warning">
      <Hourglass aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate tabular">{until > 0 ? `Usage limit · resets in ${untilLabel(until)}` : 'Usage limit · resume to send'}</span>
    </span>
  );
}
