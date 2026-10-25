import { ChevronRight, Flag } from '@/icons';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type { ActivityEntry } from '../model';
import { clock } from '../progress';
import { EventLine } from './MochiWidget';
import { planSummary } from './rows';

/** A run of plan changes as one muted line; open, each change. A lone change reads as its own event line. */
export function PlanRow({ entries }: { entries: ActivityEntry[] }) {
  const last = entries.at(-1)!;
  if (entries.length === 1) return <EventLine text={last.text} at={last.at} />;
  return (
    <Collapsible className="flex flex-col">
      <CollapsibleTrigger className="group flex w-fit max-w-full cursor-default gap-2 rounded-sm text-left type-caption text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2">
        <Flag aria-hidden className="mt-px size-3.5 shrink-0" />
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {planSummary(entries)}
          <span className="whitespace-nowrap tabular text-subtle-foreground">
            {' '}
            · {clock(last.at)}
          </span>
        </span>
        <ChevronRight
          aria-hidden
          className="mt-px size-3.5 shrink-0 text-subtle-foreground transition-transform duration-150 group-data-[state=open]:rotate-90 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down motion-reduce:animate-none">
        <ul className="mt-1 ml-5.5 flex flex-col gap-0.5 type-caption text-subtle-foreground">
          {entries.map((e, i) => (
            <li key={i} className="[overflow-wrap:anywhere]">
              {e.text.replace(/^Plan: /, '')}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
