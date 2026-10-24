import { ChevronRight } from '@/icons';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { ActivityEntry, Subagent, Thread } from '../model';
import { useDispatch } from '../store';
import { SubagentAvatar, SubagentLine, SubagentMeta, subagentPersona } from './parts';

/** Subagents started together: a lone one is its own row; several fold into one line with their Mochis stacked, opening to each. */
export function SubagentGroup({ thread, entries }: { thread: Thread; entries: ActivityEntry[] }) {
  const subagents = entries.flatMap((e) => thread.subagents?.find((s) => s.id === e.subagentId) ?? []);
  if (subagents.length <= 1) return subagents.length === 1 && <SubagentRow thread={thread} subagent={subagents[0]} />;
  return (
    <Collapsible className="flex flex-col">
      <CollapsibleTrigger className="group -mx-2 flex h-7 w-[calc(100%+1rem)] min-w-0 cursor-default items-center gap-2 rounded-lg px-2 text-left type-meta text-muted-foreground hover:bg-accent/60 focus-visible:outline-2">
        <span className="flex shrink-0 -space-x-2.5">
          {subagents.slice(0, MAX_AVATARS).map((s) => (
            <SubagentAvatar key={s.id} flavor={subagentPersona(thread, s).flavor} subagent={s} className="rounded-full bg-background ring-2 ring-background" />
          ))}
        </span>
        <span className="shrink-0 text-foreground">{`${subagents.length} agents`}</span>
        <span className="min-w-0 flex-1 truncate text-subtle-foreground">{groupStatus(subagents)}</span>
        <ChevronRight aria-hidden className="size-3.5 shrink-0 text-subtle-foreground transition-transform duration-150 group-data-[state=open]:rotate-90 motion-reduce:transition-none" />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down motion-reduce:animate-none">
        <div className="flex flex-col pl-4">
          {subagents.map((s) => (
            <SubagentRow key={s.id} thread={thread} subagent={s} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

const MAX_AVATARS = 4;

/** "2 running · 1 done · 1 failed", in that order, empty counts left out. */
function groupStatus(subagents: Subagent[]) {
  const count = (status: Subagent['status']) => subagents.filter((s) => s.status === status).length;
  const parts = [
    [count('running'), 'running'],
    [count('done'), 'done'],
    [count('stopped'), 'stopped'],
    [count('failed'), 'failed'],
  ] as const;
  return parts.flatMap(([n, word]) => (n ? [`${n} ${word}`] : [])).join(' · ');
}

/** A subagent where it was started in the chat: its Mochi, name and task, and one line (live, or its report's first line). Click opens it in the Background tasks tab. */
export function SubagentRow({ thread, subagent }: { thread: Thread; subagent: Subagent }) {
  const dispatch = useDispatch();
  const { flavor, name } = subagentPersona(thread, subagent);
  return (
    <button
      type="button"
      onClick={() => dispatch({ type: 'pane-show-agent', threadId: thread.id, subagentId: subagent.id })}
      aria-label={`${name}, ${subagent.name}: open in Background tasks`}
      className="-mx-2 flex h-7 w-[calc(100%+1rem)] min-w-0 cursor-default items-center gap-2 rounded-lg px-2 text-left type-meta text-muted-foreground hover:bg-accent/60"
    >
      <SubagentAvatar flavor={flavor} subagent={subagent} />
      <span className="shrink-0 text-foreground">{name}</span>
      <span className="max-w-[35%] shrink-0 truncate text-subtle-foreground">{subagent.name}</span>
      <SubagentLine subagent={subagent} />
      <SubagentMeta subagent={subagent} className="hidden sm:flex" />
    </button>
  );
}
