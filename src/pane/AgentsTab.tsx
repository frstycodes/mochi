import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FileIcon } from '@react-symbols/icons/utils';
import { ChevronRight, Hierarchy, Send2, Stop } from 'reicon-react';
import { MessageResponse } from '@/components/ai-elements/message';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { ScrollArea } from '@/components/ui/scroll-area';
import { revealIn } from '@/lib/revealIn';
import { cn } from '@/lib/utils';
import { SubagentAvatar, SubagentLine, SubagentMeta, subagentPersona } from '../agents/parts';
import { useThreadFiles } from '../files/viewer';
import { reportOf } from '../runtime/subagents';
import { VIZ_COMPONENTS, VIZ_PLUGINS, VIZ_REHYPE_PLUGINS } from '../viz/FenceVisual';
import { useGitDiff } from '../git/useGit';
import { useWorktreePath } from '../git/worktrees';
import { threadCwd } from '../host/cwd';
import type { DiffFile } from '../host/types/git';
import type { Subagent, Thread } from '../model';
import { useHarness } from '../store';
import { TooltipIconButton } from '../ui';
import { VizThreadProvider } from '../viz/WidgetVisual';
import { CallList, CallRow, DiffStat, DiffView, Expand } from '../WorkLog';
import type { PaneTabProps } from './tabs';

/** Every agent this thread's agent started, running first, each with its live log, a stop button and what it changed. */
export function AgentsTab({ thread, tab }: PaneTabProps) {
  const agents = ordered(thread.subagents ?? []);
  const running = agents.filter((s) => s.status === 'running').length;
  if (!agents.length) return <NoAgents />;
  return (
    // The log's file rows open in the thread's file viewer.
    <VizThreadProvider value={thread.id}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2 px-4 type-meta text-muted-foreground">
          <span className="tabular">{running} running</span>
          <span className="tabular text-subtle-foreground">{agents.length - running} finished</span>
        </div>
        <ScrollArea type="scroll" className="min-h-0 flex-1">
          <ol className="flex flex-col gap-2 px-2 pb-3">
            {agents.map((s) => (
              <AgentCard key={`${s.id}-${s.id === tab.agentId}`} thread={thread} subagent={s} isFocused={s.id === tab.agentId} />
            ))}
          </ol>
        </ScrollArea>
      </div>
    </VizThreadProvider>
  );
}

function AgentCard({ thread, subagent, isFocused }: { thread: Thread; subagent: Subagent; isFocused: boolean }) {
  const { dispatch } = useHarness();
  const [isOpen, setOpen] = useState(isFocused || subagent.status === 'running');
  const isRunning = subagent.status === 'running';
  const { flavor, name } = subagentPersona(thread, subagent);
  const report = subagent.result ?? subagent.error;
  const ref = useRevealOnFocus(isFocused);
  return (
    <li ref={ref} data-file-scope className={cn('flex flex-col rounded-xl border bg-card', isFocused && 'border-foreground/20')}>
      <div className="flex h-9 items-center gap-1 pr-1.5 pl-1">
        <button type="button" aria-expanded={isOpen} onClick={() => setOpen((o) => !o)} className="flex h-7 min-w-0 flex-1 cursor-default items-center gap-2 rounded-lg px-1.5 text-left type-meta text-muted-foreground hover:bg-accent/60">
          <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 text-subtle-foreground transition-transform duration-150', isOpen && 'rotate-90')} />
          <SubagentAvatar flavor={flavor} subagent={subagent} />
          <span className="shrink-0 text-foreground">{name}</span>
          <span className="max-w-[40%] shrink-0 truncate text-subtle-foreground">{subagent.name}</span>
          <SubagentLine subagent={subagent} />
        </button>
        {isRunning && (
          <TooltipIconButton
            label="Stop agent"
            hint={`Stops ${name}; its work so far stays`}
            size="icon-sm"
            variant="ghost"
            onClick={() =>
              dispatch({
                type: 'bg-stop',
                threadId: thread.id,
                subagentId: subagent.id,
              })
            }
          >
            <Stop weight="Filled" className="size-3.5" />
          </TooltipIconButton>
        )}
      </div>
      <div className="flex items-center gap-2 px-3 pb-2 type-caption text-subtle-foreground">
        <SubagentMeta subagent={subagent} />
        {!!subagent.model && <span className="min-w-0 truncate">{subagent.model}</span>}
        <span className="ml-auto shrink-0">{subagent.origin === 'mochi' ? (subagent.hasOwnWorktree ? 'Own worktree' : 'Shared worktree') : subagent.isBackground ? 'Background' : 'Subagent'}</span>
      </div>
      <Expand isOpen={isOpen}>
        <div className="flex flex-col gap-3 px-1 pb-3">
          {!!subagent.prompt && <p className="line-clamp-4 px-2 type-meta whitespace-pre-wrap text-muted-foreground">{subagent.prompt}</p>}
          <Section title="Log">
            <SubagentSteps subagent={subagent} />
          </Section>
          {!isRunning && !!report && (
            <Section title={subagent.error ? 'Error' : 'Report'}>
              <MessageResponse plugins={VIZ_PLUGINS} components={VIZ_COMPONENTS} rehypePlugins={VIZ_REHYPE_PLUGINS} className="px-2 type-meta text-muted-foreground">
                {report}
              </MessageResponse>
              <div className="px-2 pt-2">
                <Button size="sm" variant="secondary" className="rounded-full" onClick={() => dispatch({ type: 'send', threadId: thread.id, text: reportOf(subagent), reason: 'A subagent report you sent on' })}>
                  <Send2 data-icon="inline-start" />
                  Send to thread
                </Button>
              </div>
            </Section>
          )}
          <AgentChanges thread={thread} subagent={subagent} />
        </div>
      </Expand>
    </li>
  );
}

/** "Open" from the chat lands on this card: scrolled into view inside the tab's own scroller only. */
function useRevealOnFocus(isFocused: boolean) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const el = ref.current;
    const scroller = el?.closest<HTMLElement>('[data-slot=scroll-area-viewport]');
    if (isFocused && el && scroller) revealIn(scroller, el, { align: 'start' });
  }, [isFocused]);
  return ref;
}

/** Its own tool calls, as the same call list an open work group shows. */
function SubagentSteps({ subagent }: { subagent: Subagent }) {
  const files = useThreadFiles();
  if (!subagent.steps.length) return <p className="px-2 py-1 type-meta text-subtle-foreground">{subagent.status === 'running' ? 'No tool calls yet' : 'No tool calls'}</p>;
  return (
    <CallList>
      {subagent.steps.map((step) => (
        <CallRow key={step.id} entry={step} isRunning={!step.isDone && subagent.status === 'running'} files={files} />
      ))}
    </CallList>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-0.5">
      <h3 className="flex h-6 items-center px-2 type-caption font-medium text-subtle-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** What it changed: its own worktree's whole branch diff, or the files it edited in the worktree it shares with the thread. */
function AgentChanges({ thread, subagent }: { thread: Thread; subagent: Subagent }) {
  const shared = useWorktreePath(thread.id) ?? threadCwd(thread);
  const cwd = subagent.hasOwnWorktree ? subagent.cwd : shared;
  const edited = [...new Set(subagent.steps.flatMap((s) => s.files ?? []))];
  if (!cwd || (!subagent.hasOwnWorktree && !edited.length)) return null;
  return <ChangedFiles cwd={cwd} only={subagent.hasOwnWorktree ? undefined : edited} />;
}

function ChangedFiles({ cwd, only }: { cwd: string; only?: string[] }) {
  const diffQuery = useGitDiff(cwd, 'branch');
  const files = (diffQuery.data?.files ?? []).filter((f) => !only || only.includes(f.path));
  if (!files.length) return null;
  return (
    <Section title="Changes">
      <ol className="flex flex-col gap-0.5">
        {files.map((f) => (
          <ChangedFile key={f.path} file={f} />
        ))}
      </ol>
    </Section>
  );
}

function ChangedFile({ file }: { file: DiffFile }) {
  const [isOpen, setOpen] = useState(false);
  const slash = file.path.lastIndexOf('/');
  return (
    <li className="flex flex-col">
      <button type="button" aria-expanded={isOpen} onClick={() => setOpen((o) => !o)} className="flex h-7 min-w-0 cursor-default items-center gap-2 rounded-lg px-2 text-left type-meta hover:bg-accent/60">
        <FileIcon fileName={file.path.slice(slash + 1)} autoAssign aria-hidden className="size-4 shrink-0" />
        <span className="flex min-w-0 flex-1 font-mono text-xs" title={file.path}>
          <span className="truncate text-subtle-foreground">{file.path.slice(0, slash + 1)}</span>
          <span className="shrink-0 text-foreground">{file.path.slice(slash + 1)}</span>
        </span>
        <DiffStat added={file.added} removed={file.removed} withBar />
      </button>
      <Expand isOpen={isOpen}>
        <div className="pt-1 pb-2">{file.binary ? <p className="px-2 type-meta text-subtle-foreground">Binary file</p> : <DiffView patch={file.patch} />}</div>
      </Expand>
    </li>
  );
}

function NoAgents() {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Hierarchy />
        </EmptyMedia>
        <EmptyTitle>No agents yet</EmptyTitle>
        <EmptyDescription>Subagents and background agents this thread's agent starts show here, with their logs and changes.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** Running first, newest first within each. */
function ordered(agents: Subagent[]) {
  return [...agents].sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || b.startedAt - a.startedAt);
}
