import { useEffect, useState } from 'react';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { cn } from '@/lib/utils';
import { AgentLoader, type MochiFlavor } from '../AgentLoader';
import { toolLabel, toolPhase } from '../agentPhase';
import type { Subagent, Thread } from '../model';
import { oneLine } from '../runtime/subagents';
import { parseTool } from '../summary';

/** Each subagent is a Mochi of its own flavor, named after it; vanilla stays the thread's own Mochi. Past five, names count up ("Matcha 2"). */
export function subagentPersona(thread: Thread, subagent: Subagent): { flavor: MochiFlavor; name: string } {
  const i = Math.max(0, thread.subagents?.findIndex((s) => s.id === subagent.id) ?? 0);
  const flavor = PERSONA_FLAVORS[i % PERSONA_FLAVORS.length];
  const round = Math.floor(i / PERSONA_FLAVORS.length);
  const name = flavor[0].toUpperCase() + flavor.slice(1);
  return { flavor, name: round ? `${name} ${round + 1}` : name };
}

const PERSONA_FLAVORS = ['matcha', 'sakura', 'ube', 'mango', 'soda'] as const satisfies MochiFlavor[];

/** The agent's Mochi: acting out what it does while it runs, idle once it ends. */
export function SubagentAvatar({ flavor, subagent, className }: { flavor: MochiFlavor; subagent: Subagent; className?: string }) {
  return <AgentLoader phase={subagent.status === 'running' ? runningPhase(subagent) : 'idle'} flavor={flavor} className={cn('-my-1 size-6 shrink-0 text-foreground', className)} />;
}

function runningPhase(s: Subagent) {
  const last = s.steps.at(-1);
  if (!last) return s.message ? 'think' : 'start';
  return last.isDone ? 'think' : toolPhase(last.text);
}

/** The row's one line: what a running agent does now, else its report's first line, or how it ended. */
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
  if (subagent.status === 'failed') return <span className="min-w-0 flex-1 truncate text-destructive">{oneLine(subagent.error) || 'Failed'}</span>;
  const text = subagent.status === 'stopped' ? 'Stopped' : oneLine(subagent.result) || 'Finished';
  return <span className="min-w-0 flex-1 truncate text-muted-foreground">{text}</span>;
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

const TOKENS = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

export function useElapsed(startedAt: number, endedAt?: number) {
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
