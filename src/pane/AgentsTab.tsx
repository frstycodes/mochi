import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { FileIcon } from '@react-symbols/icons/utils';
import { ArrowLeft, ChevronRight, Hierarchy, Send, Stop } from '@/icons';
import { MessageResponse } from '@/components/ai-elements/message';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { formatElapsed, SubagentAvatar, SubagentLine, SubagentMeta, SubagentModel, subagentPersona, TOKENS, useElapsed } from '../agents/parts';
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
import { PaneActions, PaneTitle } from './PaneHeader';
import type { PaneTabProps } from './tabs';

/** Every agent this thread's agent started as a card, running first; a card opens that agent's transcript in place of the list. */
export function AgentsTab({ thread, tab }: PaneTabProps) {
  const agents = ordered(thread.subagents ?? []);
  const shown = agents.find((s) => s.id === tab.agentId);
  if (!agents.length) return <NoAgents />;
  return (
    // The log's file rows open in the thread's file viewer.
    <VizThreadProvider value={thread.id}>{shown ? <AgentTranscript key={shown.id} thread={thread} subagent={shown} /> : <AgentList thread={thread} agents={agents} />}</VizThreadProvider>
  );
}

function AgentList({ thread, agents }: { thread: Thread; agents: Subagent[] }) {
  const running = agents.filter((s) => s.status === 'running');
  const finished = agents.filter((s) => s.status !== 'running');
  const [isFinishedOpen, setFinishedOpen] = useState(!running.length);
  return (
    <ScrollArea type="scroll" className="h-full min-h-0">
      <div className="flex flex-col gap-3 px-2 pb-3">
        {running.length > 0 && (
          <section aria-label="Running" className="flex flex-col gap-1.5">
            <h3 className="flex h-6 items-center px-1 type-meta text-subtle-foreground">Running</h3>
            <AgentCards thread={thread} agents={running} />
          </section>
        )}
        {finished.length > 0 && (
          <section aria-label="Finished" className="flex flex-col gap-1.5">
            <button type="button" aria-expanded={isFinishedOpen} onClick={() => setFinishedOpen((o) => !o)} className="flex h-6 w-fit cursor-default items-center gap-1 rounded-md px-1 type-meta text-subtle-foreground hover:text-muted-foreground">
              Finished <span className="tabular">{finished.length}</span>
              <ChevronRight aria-hidden className={cn('size-3 transition-transform duration-150', isFinishedOpen && 'rotate-90')} />
            </button>
            <Expand isOpen={isFinishedOpen}>
              <AgentCards thread={thread} agents={finished} />
            </Expand>
          </section>
        )}
      </div>
    </ScrollArea>
  );
}

function AgentCards({ thread, agents }: { thread: Thread; agents: Subagent[] }) {
  return (
    <ol className="flex flex-col gap-1.5">
      {agents.map((s) => (
        <AgentCard key={s.id} thread={thread} subagent={s} />
      ))}
    </ol>
  );
}

/** The whole card opens the transcript (a stretched button); Stop sits above it. */
function AgentCard({ thread, subagent }: { thread: Thread; subagent: Subagent }) {
  const { dispatch } = useHarness();
  const { flavor, name } = subagentPersona(thread, subagent);
  const elapsed = useElapsed(subagent.startedAt, subagent.endedAt);
  return (
    <li className="relative isolate flex flex-col gap-1 rounded-lg border bg-card px-3 py-2.5 transition-colors has-[>button:first-child:hover]:bg-accent/40">
      <button
        type="button"
        onClick={() => dispatch({ type: 'pane-show-agent', threadId: thread.id, subagentId: subagent.id })}
        aria-label={`${name}, ${subagent.name}: open transcript`}
        className="absolute inset-0 cursor-default rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex min-w-0 items-start gap-2">
        <span className="min-w-0 flex-1 truncate type-body text-foreground">{subagent.name}</span>
        {subagent.status === 'running' && <StopAgent thread={thread} subagent={subagent} name={name} className="relative z-10 -my-1 -mr-1.5" />}
      </div>
      <div className="flex min-w-0 items-center gap-2 type-meta">
        <SubagentAvatar flavor={flavor} subagent={subagent} className="size-5" />
        <span className="text-muted-foreground">{name}</span>
        <span className="text-subtle-foreground">{kindOf(subagent)}</span>
        <span className="tabular text-subtle-foreground">{formatElapsed(elapsed)}</span>
      </div>
      <div className="flex min-w-0 items-center gap-2.5 type-meta text-subtle-foreground">
        {!!subagent.model && <SubagentModel provider={subagent.provider} model={subagent.model} />}
        {subagent.tokens > 0 && <Count value={TOKENS.format(subagent.tokens)} unit="tokens" />}
        {subagent.steps.length > 0 && <Count value={String(subagent.steps.length)} unit={subagent.steps.length === 1 ? 'tool use' : 'tool uses'} />}
        <SubagentLine subagent={subagent} />
      </div>
    </li>
  );
}

function Count({ value, unit }: { value: string; unit: string }) {
  return (
    <span className="shrink-0">
      <span className="tabular text-muted-foreground">{value}</span> {unit}
    </span>
  );
}

function StopAgent({ thread, subagent, name, className }: { thread: Thread; subagent: Subagent; name: string; className?: string }) {
  const { dispatch } = useHarness();
  return (
    <TooltipIconButton label="Stop agent" hint={`Stops ${name}; its work so far stays`} size="icon-sm" variant="ghost" className={className} onClick={() => dispatch({ type: 'bg-stop', threadId: thread.id, subagentId: subagent.id })}>
      <Stop filled className="size-3.5" />
    </TooltipIconButton>
  );
}

function kindOf(s: Subagent) {
  if (s.origin === 'mochi') return s.hasOwnWorktree ? 'Own worktree' : 'Shared worktree';
  return s.isBackground ? 'Background' : 'Agent';
}

/** One agent's page: its prompt, log, report and changes, flat in the pane; back returns to the list. */
function AgentTranscript({ thread, subagent }: { thread: Thread; subagent: Subagent }) {
  const { dispatch } = useHarness();
  const { flavor, name } = subagentPersona(thread, subagent);
  const isRunning = subagent.status === 'running';
  const report = subagent.result ?? subagent.error;
  return (
    <div data-file-scope className="flex h-full min-h-0 flex-col">
      <PaneTitle>
        <TooltipIconButton label="All agents" hint="Back to this thread's agents" size="icon-sm" variant="ghost" className="-ml-1.5 shrink-0" onClick={() => dispatch({ type: 'pane-show-agent', threadId: thread.id })}>
          <ArrowLeft />
        </TooltipIconButton>
        <SubagentAvatar flavor={flavor} subagent={subagent} className="size-5" />
        <span className="shrink-0 type-meta text-foreground">{name}</span>
        <span className="min-w-0 truncate type-meta text-subtle-foreground">{subagent.name}</span>
      </PaneTitle>
      {isRunning && (
        <PaneActions>
          <StopAgent thread={thread} subagent={subagent} name={name} />
        </PaneActions>
      )}
      <ScrollArea type="scroll" className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 px-3 pt-1 pb-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 type-meta text-subtle-foreground">
              {!!subagent.model && <SubagentModel provider={subagent.provider} model={subagent.model} />}
              <SubagentMeta subagent={subagent} className="ml-auto" />
            </div>
            {!!subagent.prompt && <AgentPrompt prompt={subagent.prompt} />}
          </div>
          <SubagentSteps subagent={subagent} />
          {!isRunning && !!report && (
            <div className="flex flex-col gap-3">
              <MessageResponse plugins={VIZ_PLUGINS} components={VIZ_COMPONENTS} rehypePlugins={VIZ_REHYPE_PLUGINS} className={cn('type-prose', subagent.error && 'text-destructive')}>
                {report}
              </MessageResponse>
              <Button size="sm" variant="secondary" className="w-fit rounded-full" onClick={() => dispatch({ type: 'send', threadId: thread.id, text: reportOf(subagent), reason: 'A subagent report you sent on' })}>
                <Send data-icon="inline-start" />
                Send to thread
              </Button>
            </div>
          )}
          <AgentChanges thread={thread} subagent={subagent} />
        </div>
      </ScrollArea>
    </div>
  );
}

/** The task it was given, clamped with Show more once it runs past six lines. */
function AgentPrompt({ prompt }: { prompt: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [isOpen, setOpen] = useState(false);
  const [isClamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !isOpen) setClamped(el.scrollHeight > el.clientHeight);
  }, [prompt, isOpen]);
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-muted/60 px-3 py-2.5">
      <p ref={ref} className={cn('type-meta whitespace-pre-wrap text-muted-foreground', !isOpen && 'line-clamp-6')}>
        {prompt}
      </p>
      {(isClamped || isOpen) && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="w-fit cursor-default type-meta text-foreground hover:underline">
          {isOpen ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
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
