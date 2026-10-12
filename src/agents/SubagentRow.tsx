import { useState } from 'react';
import { ChevronRight } from 'reicon-react';
import { cn } from '@/lib/utils';
import type { Subagent, Thread } from '../model';
import { Expand } from '../WorkLog';
import { SubagentActions, SubagentLine, SubagentMark, SubagentMeta, SubagentResult, SubagentSteps } from './parts';

/** A subagent where it was started in the chat: one line, live while it runs, expandable to its own steps; once it ends, its report and what to do with it. */
export function SubagentRow({ thread, subagent }: { thread: Thread; subagent: Subagent }) {
  const [isOpen, setOpen] = useState(false);
  const isEnded = subagent.status !== 'running';
  return (
    <div data-file-scope className="-mx-2 flex flex-col">
      <button type="button" aria-expanded={isOpen} onClick={() => setOpen((o) => !o)} className="flex h-7 min-w-0 cursor-default items-center gap-2 rounded-lg px-2 text-left type-meta text-muted-foreground hover:bg-accent/60">
        <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 text-subtle-foreground transition-transform duration-150', isOpen && 'rotate-90')} />
        <SubagentMark subagent={subagent} />
        <span className="max-w-[45%] shrink-0 truncate text-foreground">{subagent.name}</span>
        <SubagentLine subagent={subagent} />
        <SubagentMeta subagent={subagent} className="hidden sm:flex" />
      </button>
      <Expand isOpen={isOpen}>
        <div className="flex flex-col gap-1 pt-0.5 pl-5">
          {!!subagent.prompt && <p className="line-clamp-2 px-2 type-caption text-subtle-foreground">{subagent.prompt}</p>}
          <SubagentSteps subagent={subagent} />
          <SubagentMeta subagent={subagent} className="px-2 type-caption sm:hidden" />
        </div>
      </Expand>
      {isEnded && (
        <div className={cn('flex flex-col gap-2 pt-1 pl-[2.75rem]', !subagent.result && !subagent.error && 'pt-0')}>
          <SubagentResult subagent={subagent} isClamped />
          <SubagentActions thread={thread} subagent={subagent} />
        </div>
      )}
    </div>
  );
}
