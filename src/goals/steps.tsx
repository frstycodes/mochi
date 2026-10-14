import { Button } from '@/components/ui/button';
import type { Step, Thread } from '../model';
import { useHarness } from '../store';
import { lineColor, StepStatusIcon } from '../ui';

/** One step of the agent's own checklist: its status icon and title. */
export function StepLine({ step }: { step: Step }) {
  return (
    <span className="flex min-w-0 items-center gap-2 type-meta">
      <span className="flex w-4 justify-center">
        <StepStatusIcon status={step.status} />
      </span>
      <span className="truncate">{step.title}</span>
    </span>
  );
}

export function StepLinkLine({ thread, step }: { thread: Thread; step: Step }) {
  const { state, dispatch } = useHarness();
  if (!step.link) return null;
  const link = step.link;
  const ids = link.mode === 'provides-for' ? link.threadIds : [link.threadId];
  const others = ids.map((id) => state.threads.find((t) => t.id === id)).filter((t): t is Thread => !!t && t.id !== thread.id);
  const verb = { 'provided-by': 'From', 'provides-for': 'Also used by', race: 'Racing', related: 'Related to' } satisfies Record<typeof link.mode, string>;

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1 type-meta text-muted-foreground">
      {verb[link.mode]}
      {/* z-10 lifts it above the goal card's stretched open button. */}
      {others.map((o) => (
        <Button key={o.id} variant="ghost" size="xs" className="relative z-10 min-w-0" onClick={() => dispatch({ type: 'go', view: { kind: 'thread', id: o.id } })}>
          <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: lineColor(o.line) }} />
          <span className="truncate">{o.title}</span>
        </Button>
      ))}
    </span>
  );
}
