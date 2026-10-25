import { useNow } from '../useNow';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { BackgroundTask } from '@/icons';
import { cn } from '@/lib/utils';
import { AgentLoader, type MochiFlavor } from '../AgentLoader';
import { toolLabel, toolPhase } from '../agentPhase';
import type { Provider, Subagent, Thread } from '../model';
import { formatElapsed } from '../progress';
import { oneLine } from '../runtime/subagents';
import type { TaskRow } from '../runtime/tasks';
import { TerminalIcon } from '../icons/panes';
import { useModels } from '../ModelControls';
import { optionFor } from '../runtime/models';
import { useSpace } from '../store';
import { parseTool } from '../summary';
import { ProviderMark } from '../ui';
import { TOKENS } from '@mochi/domain/lib/format';

/** Each subagent is a Mochi of its own flavor, named after it; vanilla stays the thread's own Mochi. Past five, names count up ("Matcha 2"). */
export function subagentPersona(
  thread: Thread,
  subagent: Subagent,
): { flavor: MochiFlavor; name: string } {
  const i = Math.max(
    0,
    thread.subagents?.findIndex((s) => s.id === subagent.id) ?? 0,
  );
  const flavor = PERSONA_FLAVORS[i % PERSONA_FLAVORS.length];
  const round = Math.floor(i / PERSONA_FLAVORS.length);
  const name = flavor[0].toUpperCase() + flavor.slice(1);
  return { flavor, name: round ? `${name} ${round + 1}` : name };
}

const PERSONA_FLAVORS = [
  'matcha',
  'sakura',
  'ube',
  'mango',
  'soda',
] as const satisfies MochiFlavor[];

/** The agent's Mochi: acting out what it does while it runs, idle once it ends. */
export function SubagentAvatar({
  flavor,
  subagent,
  className,
}: {
  flavor: MochiFlavor;
  subagent: Subagent;
  className?: string;
}) {
  return (
    <AgentLoader
      phase={subagent.status === 'running' ? runningPhase(subagent) : 'idle'}
      flavor={flavor}
      className={cn('-my-1 size-6 shrink-0 text-foreground', className)}
    />
  );
}

function runningPhase(s: Subagent) {
  const last = s.steps.at(-1);
  if (!last) return s.message ? 'think' : 'start';
  return last.isDone ? 'think' : toolPhase(last.text);
}

/** The row's one line: what a running agent does now, else its report's first line, or how it ended. */
export function SubagentLine({ subagent }: { subagent: Subagent }) {
  if (subagent.status === 'running') {
    const text =
      currentStep(subagent) ??
      subagent.activity ??
      (subagent.message || subagent.steps.length ? 'Thinking' : 'Starting');
    return (
      <span className="flex min-w-0 flex-1" title={text}>
        <Shimmer as="span" className="min-w-0 truncate">
          {text}
        </Shimmer>
      </span>
    );
  }
  if (subagent.status === 'failed')
    return (
      <span className="min-w-0 flex-1 truncate text-destructive">
        {oneLine(subagent.error) || 'Failed'}
      </span>
    );
  const text =
    subagent.status === 'stopped'
      ? 'Stopped'
      : oneLine(subagent.result) || 'Finished';
  return (
    <span className="min-w-0 flex-1 truncate text-muted-foreground">
      {text}
    </span>
  );
}

function currentStep(s: Subagent) {
  const last = s.steps.at(-1);
  return last && !last.isDone ? toolLabel(parseTool(last.text)) : undefined;
}

/** The model it ran on by its picker name ("Haiku 5.5") beside its harness's mark; an id the list lacks shows as written. */
export function SubagentModel({
  provider,
  model,
  className,
}: {
  provider: Provider;
  model: string;
  className?: string;
}) {
  const models = useModels(useSpace().id)[provider];
  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1.5 text-muted-foreground',
        className,
      )}
    >
      <ProviderMark provider={provider} size={14} />
      {optionFor(models, model, provider).name}
    </span>
  );
}

/** Elapsed time and tokens, live while it runs. */
export function SubagentMeta({
  subagent,
  className,
}: {
  subagent: Subagent;
  className?: string;
}) {
  const elapsed = useElapsed(subagent.startedAt, subagent.endedAt);
  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-2 tabular text-subtle-foreground',
        className,
      )}
    >
      <span>{formatElapsed(elapsed)}</span>
      {subagent.tokens > 0 && (
        <span>{TOKENS.format(subagent.tokens)} tokens</span>
      )}
    </span>
  );
}

export function useElapsed(startedAt: number, endedAt?: number) {
  const now = useNow(endedAt === undefined ? 1000 : null);
  return Math.max(0, (endedAt ?? now) - startedAt);
}

/** A task's kind at a glance: the agent's own Mochi, the terminal glyph for a command, else the background-task glyph. */
export function TaskIcon({ thread, task }: { thread: Thread; task: TaskRow }) {
  if (task.subagent)
    return (
      <SubagentAvatar
        flavor={subagentPersona(thread, task.subagent).flavor}
        subagent={task.subagent}
        className="-mx-0.5 size-5"
      />
    );
  const Icon = task.kind === 'shell' ? TerminalIcon : BackgroundTask;
  return (
    <Icon
      aria-label={task.kind === 'shell' ? 'Command' : 'Task'}
      className="size-4 text-muted-foreground"
    />
  );
}
