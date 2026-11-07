import { ClipboardList } from '@/icons';
import { FoldChevron } from '@/Fold';
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
      <CollapsibleTrigger className="group group/fold -mx-2 flex min-h-7 w-fit max-w-full cursor-default items-start gap-2 rounded-lg px-2 py-1 text-left type-meta text-muted-foreground hover:bg-accent/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2">
        <ClipboardList aria-hidden className="mt-px size-4 shrink-0" />
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {planSummary(entries)}
          <span className="whitespace-nowrap tabular text-subtle-foreground">
            {' '}
            · {clock(last.at)}
          </span>
        </span>
        <FoldChevron className="mt-[3px] text-subtle-foreground" />
      </CollapsibleTrigger>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
        <ul className="mt-1 ml-6 flex flex-col gap-0.5 type-meta text-subtle-foreground">
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
