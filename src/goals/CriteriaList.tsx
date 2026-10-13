import { TickCircle } from 'reicon-react';
import { cn } from '@/lib/utils';
import type { Criterion } from '../model';

/** What done means for a goal, one line per criterion. */
export function CriteriaList({ criteria, className }: { criteria: Criterion[]; className?: string }) {
  return (
    <ul aria-label="Done when" className={cn('flex flex-col gap-1', className)}>
      {criteria.map((c) => (
        <li key={c.id} className="flex gap-2 type-meta text-muted-foreground">
          <TickCircle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-subtle-foreground" />
          <span className="min-w-0 text-pretty">{c.text}</span>
        </li>
      ))}
    </ul>
  );
}
