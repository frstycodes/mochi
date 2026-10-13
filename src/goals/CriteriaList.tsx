import { TickCircle } from 'reicon-react';
import { cn } from '@/lib/utils';
import type { Criterion } from '../model';

/** What done means for a goal, one line per criterion; claimed ones show the agent's evidence. */
export function CriteriaList({ criteria, className }: { criteria: Criterion[]; className?: string }) {
  return (
    <ul aria-label="Done when" className={cn('flex flex-col gap-1', className)}>
      {criteria.map((c) => (
        <li key={c.id} className="flex gap-2 type-meta text-muted-foreground">
          <TickCircle aria-label={c.claim ? 'Claimed done' : 'Open'} className={cn('mt-0.5 size-3.5 shrink-0', c.claim ? 'text-success' : 'text-subtle-foreground')} />
          <span className="flex min-w-0 flex-col text-pretty">
            <span className={cn(c.claim && 'text-foreground')}>{c.text}</span>
            {!!c.claim && <span className="type-caption text-subtle-foreground">{c.claim.evidence}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
