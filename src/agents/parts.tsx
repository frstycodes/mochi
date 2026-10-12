import { useEffect, useState, type ComponentProps } from 'react';
import { CheckCircle, CloseCircle, Send2, StopCircle } from 'reicon-react';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AgentLoader } from '../AgentLoader';
import { toolLabel, toolPhase } from '../agentPhase';
import type { Subagent, Thread } from '../model';
import { reportOf } from '../runtime/subagents';
import { parseTool } from '../summary';
import { useHarness } from '../store';
import { useThreadFiles } from '../files/viewer';
import { ToolRow } from '../WorkLog';

/** Mochi acting out what a running agent does; a status mark once it ends. */
export function SubagentMark({ subagent, className }: { subagent: Subagent; className?: string }) {
  if (subagent.status === 'running') return <AgentLoader phase={runningPhase(subagent)} className={cn('-my-1 size-6 shrink-0 text-foreground', className)} />;
  const { icon: Icon, tone, label } = ENDED[subagent.status];
  return <Icon aria-label={label} className={cn('size-4 shrink-0', tone, className)} />;
}

const ENDED = {
  done: { icon: CheckCircle, tone: 'text-success', label: 'Finished' },
  failed: { icon: CloseCircle, tone: 'text-destructive', label: 'Failed' },
  stopped: {
    icon: StopCircle,
    tone: 'text-subtle-foreground',
    label: 'Stopped',
  },
} satisfies Record<Exclude<Subagent['status'], 'running'>, { icon: typeof CheckCircle; tone: string; label: string }>;

function runningPhase(s: Subagent) {
  const last = s.steps.at(-1);
  if (!last) return s.message ? 'think' : 'start';
  return last.isDone ? 'think' : toolPhase(last.text);
}

/** The row's one line: what a running agent does now, else how it ended. */
export function SubagentLine({ subagent }: { subagent: Subagent }) {
  if (subagent.status === 'running') {
    const text = currentStep(subagent) ?? subagent.activity ?? (subagent.message || subagent.steps.length ? 'Thinking' : 'Starting');
    return (
      <span className="flex min-w-0 flex-1" title={text}>
        <Shimmer as="span" className="min-w-0 truncate">
          {text}
        </Shimmer>
      </span>
    );
  }
  const text = subagent.status === 'failed' ? (subagent.error ?? 'Failed') : `${subagent.status === 'stopped' ? 'Stopped' : 'Finished'} · ${toolCalls(subagent.steps.length)}`;
  return <span className={cn('min-w-0 flex-1 truncate', subagent.status === 'failed' ? 'text-destructive' : 'text-subtle-foreground')}>{text}</span>;
}

function currentStep(s: Subagent) {
  const last = s.steps.at(-1);
  return last && !last.isDone ? toolLabel(parseTool(last.text)) : undefined;
}

/** Elapsed time and tokens, live while it runs. */
export function SubagentMeta({ subagent, className }: { subagent: Subagent; className?: string }) {
  const elapsed = useElapsed(subagent.startedAt, subagent.endedAt);
  return (
    <span className={cn('flex shrink-0 items-center gap-2 tabular text-subtle-foreground', className)}>
      <span>{formatElapsed(elapsed)}</span>
      {subagent.tokens > 0 && <span>{TOKENS.format(subagent.tokens)} tokens</span>}
    </span>
  );
}

const TOKENS = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function useElapsed(startedAt: number, endedAt?: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endedAt !== undefined) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [endedAt]);
  return Math.max(0, (endedAt ?? now) - startedAt);
}

export function formatElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Its own tool calls, as work log rows. */
export function SubagentSteps({ subagent, className }: { subagent: Subagent; className?: string }) {
  const files = useThreadFiles();
  if (!subagent.steps.length) return <p className={cn('px-2 py-1 type-meta text-subtle-foreground', className)}>{subagent.status === 'running' ? 'No tool calls yet' : 'No tool calls'}</p>;
  return (
    <ol className={cn('flex flex-col gap-0.5', className)}>
      {subagent.steps.map((step) => (
        <ToolRow key={step.id} call={parseTool(step.text)} isRunning={!step.isDone && subagent.status === 'running'} files={files} />
      ))}
    </ol>
  );
}

/** "Open" shows it in the Agents tab; "Send to thread" hands its report to the thread's agent now. */
export function SubagentActions({ thread, subagent, isOpenHidden }: { thread: Thread; subagent: Subagent; isOpenHidden?: boolean }) {
  const { dispatch } = useHarness();
  const canSend = !!subagent.result || !!subagent.error;
  return (
    <div className="flex items-center gap-1.5">
      {!isOpenHidden && (
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          onClick={() =>
            dispatch({
              type: 'pane-show-agent',
              threadId: thread.id,
              subagentId: subagent.id,
            })
          }
        >
          Open
        </Button>
      )}
      {canSend && (
        <Button
          size="sm"
          variant="secondary"
          className="rounded-full"
          onClick={() =>
            dispatch({
              type: 'send',
              threadId: thread.id,
              text: reportOf(subagent),
              reason: 'A subagent report you sent on',
            })
          }
        >
          <Send2 data-icon="inline-start" />
          Send to thread
        </Button>
      )}
    </div>
  );
}

/** A finished agent's answer, a few lines of it; the whole text is in the Agents tab. */
export function SubagentResult({ subagent, isClamped, className, ...props }: { subagent: Subagent; isClamped?: boolean } & ComponentProps<'p'>) {
  const text = subagent.result ?? subagent.error;
  if (!text) return null;
  return (
    <p className={cn('type-meta break-words whitespace-pre-wrap text-muted-foreground', isClamped && 'line-clamp-3', className)} {...props}>
      {text}
    </p>
  );
}

const PLURAL = new Intl.PluralRules('en');

function toolCalls(n: number) {
  return `${n} tool ${PLURAL.select(n) === 'one' ? 'call' : 'calls'}`;
}
