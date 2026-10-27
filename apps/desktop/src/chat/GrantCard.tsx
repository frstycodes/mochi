import { useState } from 'react';
import { Check, DiagramTree } from '@/icons';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { plural } from '@mochi/domain/lib/format';
import {
  authorName,
  type ActivityEntry,
  type OrchestrationGrant,
  type Thread,
} from '../model';
import { useHarness, useHarnessSelector } from '../store';
import { SubThreadState } from '../goals/SubThreads';
import { useThreadStatus } from '../goals/VerdictChip';
import {
  durationText,
  grantStatus,
  threadsLeft,
  type GrantStatus,
} from './grants';
import { ThreadName } from './ThreadMessage';

/** The agent's `request_orchestration_grant` where it asked: Allow / Don't allow, then the grant's live budget with Revoke. */
export function GrantEntry({
  thread,
  entry,
}: {
  thread: Thread;
  entry: ActivityEntry;
}) {
  const { state, dispatch } = useHarness();
  const grant = entry.grant!;
  const answer = (answer: 'allow' | 'deny' | 'revoke', models?: string[]) =>
    dispatch({
      type: 'grant-answer',
      threadId: thread.id,
      grantId: grant.id,
      answer,
      models,
    });
  return (
    <GrantCard
      grant={grant}
      status={grantStatus(grant, state.now)}
      minutesLeft={(grant.expiresAt ?? state.now) - state.now}
      agent={authorName(thread.providers[0])}
      onAllow={(models) => answer('allow', models)}
      onDeny={() => answer('deny')}
      onRevoke={() => answer('revoke')}
    />
  );
}

export function GrantCard({
  grant,
  status,
  minutesLeft,
  agent,
  onAllow,
  onDeny,
  onRevoke,
}: {
  grant: OrchestrationGrant;
  status: GrantStatus;
  minutesLeft: number;
  agent: string;
  onAllow: (models: string[]) => void;
  onDeny: () => void;
  onRevoke: () => void;
}) {
  if (status === 'pending')
    return (
      <GrantAsk grant={grant} agent={agent} onAllow={onAllow} onDeny={onDeny} />
    );
  const isActive = status === 'active';
  return (
    <section
      aria-label="Orchestration grant"
      className="flex flex-col rounded-xl border p-1"
    >
      <div className="flex min-h-7 min-w-0 items-center gap-2 px-2 py-1 type-body">
        <DiagramTree
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span
          className={isActive ? 'text-foreground' : 'text-muted-foreground'}
        >
          {`${agent} can start threads on its own`}
        </span>
        <span
          role="status"
          className="ml-auto shrink-0 type-meta text-subtle-foreground tabular-nums"
        >
          {isActive
            ? `${plural(threadsLeft(grant), '1 thread', `${threadsLeft(grant)} threads`)} left · ${durationText(minutesLeft)} left`
            : CLOSED[status]}
        </span>
        {isActive && (
          <Button size="sm" variant="ghost" onClick={onRevoke}>
            Revoke
          </Button>
        )}
      </div>
      {isActive && (
        <p className="pr-2 pb-1 pl-8 type-caption text-subtle-foreground [overflow-wrap:anywhere]">
          {`Nested only, on ${grant.models.join(', ')}`}
        </p>
      )}
      {grant.started.length > 0 && (
        <ul className="flex flex-col pb-1">
          {grant.started.map((t, i) => (
            <li
              key={t.threadId ?? i}
              className="flex min-h-7 min-w-0 items-center gap-2 pr-2 pl-8 type-meta"
            >
              <ThreadName peer={t} />
              {t.threadId && (
                <span className="ml-auto shrink-0">
                  <StartedState threadId={t.threadId} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const CLOSED = {
  denied: "You didn't allow it",
  revoked: 'Revoked',
  replaced: 'Replaced by a newer grant',
  spent: 'All threads used',
  expired: 'Expired',
} satisfies Record<Exclude<GrantStatus, 'pending' | 'active'>, string>;

/** Asked, not yet answered: the budget in one sentence, each model a toggle you can switch off, then Allow. */
function GrantAsk({
  grant,
  agent,
  onAllow,
  onDeny,
}: {
  grant: OrchestrationGrant;
  agent: string;
  onAllow: (models: string[]) => void;
  onDeny: () => void;
}) {
  const [models, setModels] = useState(grant.models);
  const toggle = (m: string, isOn: boolean) =>
    setModels((all) =>
      isOn
        ? grant.models.filter((g) => g === m || all.includes(g))
        : all.filter((g) => g !== m),
    );
  return (
    <section
      aria-label="Let the agent start threads on its own?"
      className="flex flex-col gap-2 rounded-xl border px-3 py-2.5"
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning"
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="type-body text-pretty">
            {`Let ${agent} start up to `}
            <span className="font-medium tabular-nums">
              {plural(
                grant.maxThreads,
                '1 thread',
                `${grant.maxThreads} threads`,
              )}
            </span>
            {' on its own for the next '}
            <span className="font-medium tabular-nums">
              {durationText(grant.minutes)}
            </span>
            ?
          </p>
          <p className="type-meta text-muted-foreground [overflow-wrap:anywhere]">
            {grant.reason}
          </p>
          <p className="type-caption text-subtle-foreground text-pretty">
            Only nested under this thread, with its permissions, when sub-thread
            reports or Auto-fix start a turn. Revoke it here any time.
          </p>
        </div>
      </div>
      <div
        role="group"
        aria-label="Models it may use"
        className="flex flex-wrap gap-1.5 pl-3.5"
      >
        {grant.models.map((m) => {
          const isOn = models.includes(m);
          return (
            <Toggle
              key={m}
              size="sm"
              variant="outline"
              pressed={isOn}
              onPressedChange={(on) => toggle(m, on)}
              className="max-w-full font-normal"
            >
              <Check
                aria-hidden
                className={isOn ? 'opacity-100' : 'opacity-0'}
              />
              <span className="truncate">{m}</span>
            </Toggle>
          );
        })}
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onDeny}>
          Don't allow
        </Button>
        <Button
          size="sm"
          disabled={!models.length}
          onClick={() => onAllow(models)}
        >
          {`Allow ${plural(grant.maxThreads, '1 thread', `${grant.maxThreads} threads`)}`}
        </Button>
      </div>
    </section>
  );
}

/** What a thread the grant started is doing now, like its sidebar row. */
function StartedState({ threadId }: { threadId: string }) {
  const sub = useHarnessSelector((s) =>
    s.threads.find((t) => t.id === threadId),
  );
  if (!sub)
    return <span className="type-meta text-subtle-foreground">Removed</span>;
  return <LiveState sub={sub} />;
}

function LiveState({ sub }: { sub: Thread }) {
  return (
    <SubThreadState
      sub={sub}
      status={useThreadStatus(sub)}
      className="type-meta"
    />
  );
}
