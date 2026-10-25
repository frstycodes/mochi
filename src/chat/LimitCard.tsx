import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNow } from '../useNow';
import { ChevronDown, Copy, Hourglass } from '@/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { host } from '../host';
import type { ActivityEntry, Provider, Thread } from '../model';
import { PROVIDER_NAME } from '../rewind/handoff';
import { copyHandoffPrompt, handOffHere, isHandingOff, otherProvider } from '../rewind/runHandoff';
import { HARNESSES } from '../settings/harnesses';
import { useDispatch } from '../store';
import { ProviderMark } from '../ui';
import { resetLabel, untilLabel } from '../usage/limits';
import { EventLine } from './MochiWidget';
import { queryKeys } from '../queryKeys';

/** Where a thread paused on a usage limit: the live card while the pause lasts (only the latest such entry), then a one-line record. */
export function LimitEntry({ thread, entry }: { thread: Thread; entry: ActivityEntry }) {
  const limit = thread.live?.limit;
  const isCurrent = !!limit && thread.activity.findLast((e) => e.isLimit) === entry;
  if (!isCurrent) return <EventLine text={entry.text} at={entry.at} />;
  return <LimitCard thread={thread} title={entry.text} limit={limit} />;
}

/**
 * Says what the harness does: Claude Code waits out the reset in the same turn; Codex stopped and waits for you. Every other way
 * forward is a click: nothing resumes, bills or switches harness unless you chose it for this thread.
 */
function LimitCard({ thread, title, limit }: { thread: Thread; title: string; limit: NonNullable<NonNullable<Thread['live']>['limit']> }) {
  const dispatch = useDispatch();
  const provider = thread.providers[0];
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
          {limit.isTurnHeld ? 'Waiting for the reset' : 'Stopped until reset'}
        </CardDescription>
        <CardTitle className="text-pretty">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 type-body text-muted-foreground">
        <p className="tabular">{at ? (isReset ? `Reset at ${at}.` : `Resets in ${untilLabel(until)}, at ${at}.`) : 'No reset time was reported.'}</p>
        <p className="type-caption text-subtle-foreground text-pretty">
          {limit.isTurnHeld ? 'Claude Code holds this turn and continues it on its own after the reset.' : limit.autoResume && !isReset ? 'Codex ended the turn. Mochi sends "Continue where you left off." at the reset.' : 'Codex ended the turn.'}
        </p>
      </CardContent>
      <CardFooter className="flex-wrap justify-end gap-2 border-t-0 bg-transparent pt-0">
        <HandoffMenu thread={thread} />
        {hasApiKey && (
          <Button variant="outline" size="sm" onClick={() => resume(true)}>
            Use API key
            <span className="text-subtle-foreground">· billed per use</span>
          </Button>
        )}
        {!limit.isTurnHeld && <ResumeButton isReset={isReset || !at} isArmed={!!limit.autoResume} at={at} onResume={() => resume()} onArm={arm} />}
      </CardFooter>
    </Card>
  );
}

/** Both ways to hand off at once: here, or the prompt on the clipboard to take anywhere. */
function HandoffMenu({ thread }: { thread: Thread }) {
  const dispatch = useDispatch();
  const other = otherProvider(thread);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          <ProviderMark provider={other} size={14} />
          Hand off to {PROVIDER_NAME[other]}
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-max">
        <DropdownMenuItem disabled={isHandingOff(thread)} onSelect={() => handOffHere(thread, dispatch)}>
          <ProviderMark provider={other} size={14} />
          Hand off to {PROVIDER_NAME[other]} here
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => copyHandoffPrompt(thread)}>
          <Copy />
          Copy handoff prompt
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
  const [expiredTarget, setExpiredTarget] = useState<number>();
  const isPending = !Number.isNaN(target) && expiredTarget !== target;
  const now = useNow(isPending ? 60_000 : null);
  useEffect(() => {
    if (!isPending) return;
    // A past target fires at once and stops the clock; one past setTimeout's 24.8-day cap is left to the minute clock.
    const id = window.setTimeout(() => {
      if (Date.now() >= target) setExpiredTarget(target);
    }, Math.min(target - Date.now(), 2_147_483_647));
    return () => window.clearTimeout(id);
  }, [target, isPending]);
  return isPending && target > now ? target - now : 0;
}

function useHasApiKey(provider: Provider) {
  const keyQuery = useQuery({ queryKey: queryKeys.agent.apiKey(provider), queryFn: () => host.settings.apiKey(provider), enabled: !!HARNESSES[provider].apiKey });
  return keyQuery.data?.isSet ?? false;
}

/** The header's status chip while a limit stops the thread: "Waiting · resets 3:40 PM". */
export function LimitChip({ thread }: { thread: Thread }) {
  const label = limitStatus(thread);
  if (!label) return null;
  return (
    <Badge variant="secondary" className="hidden bg-warning/12 tabular text-warning @md:inline-flex dark:bg-warning/20">
      <Hourglass aria-hidden />
      {label}
    </Badge>
  );
}

/** One line while a limit stops the thread, shared by the header chip, the sidebar row and the summary. */
export function limitStatus(thread: Thread) {
  const limit = thread.live?.limit;
  if (!limit) return;
  const verb = limit.isTurnHeld ? 'Waiting' : 'Stopped';
  if (!limit.resetsAt) return `${verb} · usage limit`;
  return Date.parse(limit.resetsAt) > Date.now() ? `${verb} · resets ${resetLabel(limit.resetsAt)}` : `${verb} · limit reset`;
}

/** The composer's note while the thread's account is at its limit. */
export function LimitHint({ limit }: { limit: NonNullable<NonNullable<Thread['live']>['limit']> }) {
  const until = useUntil(limit.resetsAt);
  return (
    <span className="ml-auto flex min-w-0 items-center gap-1 text-warning">
      <Hourglass aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate tabular">{until > 0 ? `Usage limit · resets in ${untilLabel(until)}` : 'Usage limit reached'}</span>
    </span>
  );
}
