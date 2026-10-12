import type { Subagent, Thread } from '../model';
import { useHarness } from '../store';
import { SubagentAvatar, SubagentLine, SubagentMeta, subagentPersona } from './parts';

/** A subagent where it was started in the chat: its Mochi, name and task, and one line (live, or its report's first line). Click opens it in the Agents tab. */
export function SubagentRow({ thread, subagent }: { thread: Thread; subagent: Subagent }) {
  const { dispatch } = useHarness();
  const { flavor, name } = subagentPersona(thread, subagent);
  return (
    <button
      type="button"
      onClick={() => dispatch({ type: 'pane-show-agent', threadId: thread.id, subagentId: subagent.id })}
      aria-label={`${name}, ${subagent.name}: open in Agents`}
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
