import { useQuery } from '@tanstack/react-query';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { FileIcon } from '@react-symbols/icons/utils';
import {
  ArrowLeft,
  BackgroundTask,
  ChevronRight,
  ArrowUp,
  Stop,
} from '@/icons';
import { MessageResponse } from '@/components/ai-elements/message';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { plural, TOKENS } from '@mochi/domain/lib/format';
import { formatElapsed } from '../progress';
import {
  SubagentAvatar,
  SubagentLine,
  SubagentMeta,
  SubagentModel,
  subagentPersona,
  TaskIcon,
  useElapsed,
} from '../agents/parts';
import { splitPath } from '../chat/imageSrc';
import { outputLines } from '../chat/output';
import type { RunResult } from '../fixtures';
import { useThreadFiles } from '../files/viewer';
import { reportOf } from '../runtime/subagents';
import {
  isActive,
  stopTask,
  taskResult,
  threadTasks,
  type TaskRow,
} from '../runtime/tasks';
import {
  VIZ_COMPONENTS,
  VIZ_PLUGINS,
  VIZ_REHYPE_PLUGINS,
} from '../viz/FenceVisual';
import { useGitDiff } from '../git/useGit';
import { useWorktreePath } from '../git/worktrees';
import { host } from '../host';
import { threadCwd } from '../host/cwd';
import type { DiffFile } from '../host/types/git';
import type { Subagent, Thread } from '../model';
import { useDispatch } from '../store';
import { TooltipIconButton } from '../ui';
import { VizThreadProvider } from '../viz/WidgetVisual';
import {
  CallList,
  CallRow,
  DiffStat,
  DiffView,
  Expand,
  RunOutput,
} from '../WorkLog';
import { PaneActions, PaneTitle } from './PaneHeader';
import type { PaneTabProps } from './tabs';
import { queryKeys } from '../queryKeys';

/** Everything this thread's agent started beside its turn as cards, running first; a card opens that task's page (an agent's transcript, a command's output) in place of the list. */
export function AgentsTab({ thread, tab }: PaneTabProps) {
  const tasks = threadTasks(thread);
  const shown = tasks.find((t) => t.id === tab.agentId);
  if (!tasks.length) return <NoTasks />;
  return (
    // The log's file rows open in the thread's file viewer.
    <VizThreadProvider value={thread.id}>
      {shown ? (
        <TaskPage key={shown.id} thread={thread} task={shown} />
      ) : (
        <TaskList thread={thread} tasks={tasks} />
      )}
    </VizThreadProvider>
  );
}

function TaskPage({ thread, task }: { thread: Thread; task: TaskRow }) {
  if (task.subagent)
    return (
      <AgentTranscript thread={thread} task={task} subagent={task.subagent} />
    );
  return <CommandOutput thread={thread} task={task} />;
}

/** Newest first within Running and Finished. */
function TaskList({ thread, tasks }: { thread: Thread; tasks: TaskRow[] }) {
  const running = tasks.filter(isActive).toReversed();
  const finished = tasks.filter((t) => !isActive(t)).toReversed();
  const [isFinishedOpen, setFinishedOpen] = useState(!running.length);
  return (
    <ScrollArea type="scroll" className="h-full min-h-0">
      <div className="flex flex-col gap-3 px-2 pb-3">
        {running.length > 0 && (
          <section aria-label="Running" className="flex flex-col gap-1.5">
            <h3 className="flex h-6 items-center px-1 type-meta text-subtle-foreground">
              Running
            </h3>
            <TaskCards thread={thread} tasks={running} />
          </section>
        )}
        {finished.length > 0 && (
          <section aria-label="Finished" className="flex flex-col gap-1.5">
            <button
              type="button"
              aria-expanded={isFinishedOpen}
              onClick={() => setFinishedOpen((o) => !o)}
              className="flex h-6 w-fit cursor-default items-center gap-1 rounded-md px-1 type-meta text-subtle-foreground hover:text-muted-foreground"
            >
              Finished <span className="tabular">{finished.length}</span>
              <ChevronRight
                aria-hidden
                className={cn(
                  'size-3 transition-transform duration-150',
                  isFinishedOpen && 'rotate-90',
                )}
              />
            </button>
            <Expand isOpen={isFinishedOpen}>
              <TaskCards thread={thread} tasks={finished} />
            </Expand>
          </section>
        )}
      </div>
    </ScrollArea>
  );
}

function TaskCards({ thread, tasks }: { thread: Thread; tasks: TaskRow[] }) {
  return (
    <ol className="flex flex-col gap-1.5">
      {tasks.map((task) =>
        task.subagent ? (
          <AgentCard
            key={task.id}
            thread={thread}
            task={task}
            subagent={task.subagent}
          />
        ) : (
          <CommandCard key={task.id} thread={thread} task={task} />
        ),
      )}
    </ol>
  );
}

/** The whole card opens the task's page (a stretched button); Stop sits above it. */
function TaskCard({
  thread,
  task,
  label,
  stopName,
  children,
}: {
  thread: Thread;
  task: TaskRow;
  label: string;
  stopName: string;
  children: ReactNode;
}) {
  const dispatch = useDispatch();
  return (
    <li className="relative isolate flex flex-col gap-1 rounded-lg bg-foreground/5 px-3 py-2.5 transition-colors has-[>button:first-child:hover]:bg-foreground/10">
      <button
        type="button"
        onClick={() =>
          dispatch({
            type: 'pane-show-agent',
            threadId: thread.id,
            subagentId: task.id,
          })
        }
        aria-label={label}
        className="absolute inset-0 cursor-default rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex min-w-0 items-start gap-2">
        <span className="min-w-0 flex-1 truncate type-body text-foreground">
          {task.title}
        </span>
        {isActive(task) && (
          <StopButton
            thread={thread}
            task={task}
            name={stopName}
            className="relative z-10 -my-1 -mr-1.5"
          />
        )}
      </div>
      {children}
    </li>
  );
}

function AgentCard({
  thread,
  task,
  subagent,
}: {
  thread: Thread;
  task: TaskRow;
  subagent: Subagent;
}) {
  const { flavor, name } = subagentPersona(thread, subagent);
  const elapsed = useElapsed(subagent.startedAt, subagent.endedAt);
  return (
    <TaskCard
      thread={thread}
      task={task}
      label={`${name}, ${subagent.name}: open transcript`}
      stopName={name}
    >
      <div className="flex min-w-0 items-center gap-2 type-meta">
        <SubagentAvatar
          flavor={flavor}
          subagent={subagent}
          className="size-5"
        />
        <span className="text-muted-foreground">{name}</span>
        <span className="text-subtle-foreground">{kindOf(subagent)}</span>
        <span className="tabular text-subtle-foreground">
          {formatElapsed(elapsed)}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-2.5 type-meta text-subtle-foreground">
        {!!subagent.model && (
          <SubagentModel provider={subagent.provider} model={subagent.model} />
        )}
        {subagent.tokens > 0 && (
          <Count value={TOKENS.format(subagent.tokens)} unit="tokens" />
        )}
        {subagent.steps.length > 0 && (
          <Count
            value={String(subagent.steps.length)}
            unit={plural(subagent.steps.length, 'tool use', 'tool uses')}
          />
        )}
        <SubagentLine subagent={subagent} />
      </div>
    </TaskCard>
  );
}

/** A background command, workflow or monitor: its kind, age and outcome, and the command when the title doesn't already say it. */
function CommandCard({ thread, task }: { thread: Thread; task: TaskRow }) {
  const elapsed = useElapsed(task.startedAt, task.endedAt);
  return (
    <TaskCard
      thread={thread}
      task={task}
      label={`${task.title}: open output`}
      stopName={`“${task.title}”`}
    >
      <div className="flex min-w-0 items-center gap-2 type-meta">
        <span className="flex size-5 shrink-0 items-center justify-center">
          <TaskIcon thread={thread} task={task} />
        </span>
        <span className="text-muted-foreground">{TASK_KINDS[task.kind]}</span>
        <span className="tabular text-subtle-foreground">
          {formatElapsed(elapsed)}
        </span>
        {!isActive(task) && (
          <span
            className={
              task.status === 'failed'
                ? 'text-destructive'
                : 'text-subtle-foreground'
            }
          >
            {taskResult(task)}
          </span>
        )}
      </div>
      {!!task.command && task.command !== task.title && (
        <p className="truncate font-mono text-xs leading-5 text-subtle-foreground">
          {task.command}
        </p>
      )}
    </TaskCard>
  );
}

const TASK_KINDS = {
  agent: 'Agent',
  shell: 'Command',
  workflow: 'Workflow',
  monitor: 'Monitor',
} satisfies Record<TaskRow['kind'], string>;

function Count({ value, unit }: { value: string; unit: string }) {
  return (
    <span className="shrink-0">
      <span className="tabular text-muted-foreground">{value}</span> {unit}
    </span>
  );
}

function StopButton({
  thread,
  task,
  name,
  className,
}: {
  thread: Thread;
  task: TaskRow;
  name: string;
  className?: string;
}) {
  const dispatch = useDispatch();
  const isAgent = !!task.subagent;
  return (
    <TooltipIconButton
      label={isAgent ? 'Stop agent' : 'Stop task'}
      hint={`Stops ${name}; its ${isAgent ? 'work' : 'output'} so far stays`}
      size="icon-sm"
      variant="ghost"
      className={className}
      onClick={() => dispatch(stopTask(thread.id, task))}
    >
      <Stop filled className="size-3.5" />
    </TooltipIconButton>
  );
}

function kindOf(s: Subagent) {
  if (s.origin === 'mochi')
    return s.hasOwnWorktree ? 'Own worktree' : 'Shared worktree';
  return s.isBackground ? 'Background' : 'Agent';
}

function BackToTasks({ thread }: { thread: Thread }) {
  const dispatch = useDispatch();
  return (
    <TooltipIconButton
      label="All tasks"
      hint="Back to this thread's background tasks"
      size="icon-sm"
      variant="ghost"
      className="-ml-1.5 shrink-0"
      onClick={() => dispatch({ type: 'pane-show-agent', threadId: thread.id })}
    >
      <ArrowLeft />
    </TooltipIconButton>
  );
}

/** One agent's page: its prompt, log, report and changes, flat in the pane; back returns to the list. */
function AgentTranscript({
  thread,
  task,
  subagent,
}: {
  thread: Thread;
  task: TaskRow;
  subagent: Subagent;
}) {
  const dispatch = useDispatch();
  const { flavor, name } = subagentPersona(thread, subagent);
  const isRunning = subagent.status === 'running';
  const report = subagent.result ?? subagent.error;
  return (
    <div data-file-scope className="flex h-full min-h-0 flex-col">
      <PaneTitle>
        <BackToTasks thread={thread} />
        <SubagentAvatar
          flavor={flavor}
          subagent={subagent}
          className="size-5"
        />
        <span className="shrink-0 type-meta text-foreground">{name}</span>
        <span className="min-w-0 truncate type-meta text-subtle-foreground">
          {subagent.name}
        </span>
      </PaneTitle>
      {isRunning && (
        <PaneActions>
          <StopButton thread={thread} task={task} name={name} />
        </PaneActions>
      )}
      <ScrollArea type="scroll" className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 px-3 pt-1 pb-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 type-meta text-subtle-foreground">
              {!!subagent.model && (
                <SubagentModel
                  provider={subagent.provider}
                  model={subagent.model}
                />
              )}
              <SubagentMeta subagent={subagent} className="ml-auto" />
            </div>
            {!!subagent.prompt && <AgentPrompt prompt={subagent.prompt} />}
          </div>
          <SubagentSteps subagent={subagent} />
          {!isRunning && !!report && (
            <div className="flex flex-col gap-3">
              <MessageResponse
                plugins={VIZ_PLUGINS}
                components={VIZ_COMPONENTS}
                rehypePlugins={VIZ_REHYPE_PLUGINS}
                className={cn(
                  'type-prose',
                  subagent.error && 'text-destructive',
                )}
              >
                {report}
              </MessageResponse>
              <Button
                size="sm"
                variant="secondary"
                className="w-fit rounded-full"
                onClick={() =>
                  dispatch({
                    type: 'send',
                    threadId: thread.id,
                    text: reportOf(subagent),
                    reason: 'A subagent report you sent on',
                  })
                }
              >
                <ArrowUp data-icon="inline-start" />
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

/** A command's page: its output as the chat's run block, live while it runs, then with its exit code. */
function CommandOutput({ thread, task }: { thread: Thread; task: TaskRow }) {
  const run = useTaskRun(task);
  const elapsed = useElapsed(task.startedAt, task.endedAt);
  const isRunning = isActive(task);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneTitle>
        <BackToTasks thread={thread} />
        <TaskIcon thread={thread} task={task} />
        <span className="min-w-0 truncate type-meta text-foreground">
          {task.title}
        </span>
        <span className="shrink-0 tabular type-meta text-subtle-foreground">
          {isRunning ? formatElapsed(elapsed) : taskResult(task)}
        </span>
      </PaneTitle>
      {isRunning && (
        <PaneActions>
          <StopButton thread={thread} task={task} name={`“${task.title}”`} />
        </PaneActions>
      )}
      <ScrollArea type="scroll" className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 px-3 pt-1 pb-4">
          <RunOutput command={task.command ?? task.title} run={run} isFull />
          {!task.outputFile && (
            <p className="px-1 type-meta text-subtle-foreground">
              {isRunning ? 'Waiting for output…' : 'No output was captured'}
            </p>
          )}
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
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `prompt` is the trigger: new text is measured again once it has laid out
  }, [prompt, isOpen]);
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-muted/60 px-3 py-2.5">
      <p
        ref={ref}
        className={cn(
          'type-meta whitespace-pre-wrap text-muted-foreground',
          !isOpen && 'line-clamp-6',
        )}
      >
        {prompt}
      </p>
      {(isClamped || isOpen) && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-fit cursor-default type-meta text-foreground hover:underline"
        >
          {isOpen ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

/** Its own tool calls, as the same call list an open work group shows. */
function SubagentSteps({ subagent }: { subagent: Subagent }) {
  const files = useThreadFiles();
  if (!subagent.steps.length)
    return (
      <p className="px-2 py-1 type-meta text-subtle-foreground">
        {subagent.status === 'running' ? 'No tool calls yet' : 'No tool calls'}
      </p>
    );
  return (
    <CallList>
      {subagent.steps.map((step) => (
        <CallRow
          key={step.id}
          entry={step}
          isRunning={!step.isDone && subagent.status === 'running'}
          files={files}
        />
      ))}
    </CallList>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-0.5">
      <h3 className="flex h-6 items-center px-2 type-caption font-medium text-subtle-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** What it changed: its own worktree's whole branch diff, or the files it edited in the worktree it shares with the thread. */
function AgentChanges({
  thread,
  subagent,
}: {
  thread: Thread;
  subagent: Subagent;
}) {
  const shared = useWorktreePath(thread.id) ?? threadCwd(thread);
  const cwd = subagent.hasOwnWorktree ? subagent.cwd : shared;
  const edited = [...new Set(subagent.steps.flatMap((s) => s.files ?? []))];
  if (!cwd || (!subagent.hasOwnWorktree && !edited.length)) return null;
  return (
    <ChangedFiles
      cwd={cwd}
      only={subagent.hasOwnWorktree ? undefined : edited}
    />
  );
}

function ChangedFiles({ cwd, only }: { cwd: string; only?: string[] }) {
  const diffQuery = useGitDiff(cwd, 'branch');
  const files = (diffQuery.data?.files ?? []).filter(
    (f) => !only || only.includes(f.path),
  );
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
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 min-w-0 cursor-default items-center gap-2 rounded-lg px-2 text-left type-meta hover:bg-accent/60"
      >
        <FileIcon
          fileName={file.path.slice(slash + 1)}
          autoAssign
          aria-hidden
          className="size-4 shrink-0"
        />
        <span
          className="flex min-w-0 flex-1 font-mono text-xs"
          title={file.path}
        >
          <span className="truncate text-subtle-foreground">
            {file.path.slice(0, slash + 1)}
          </span>
          <span className="shrink-0 text-foreground">
            {file.path.slice(slash + 1)}
          </span>
        </span>
        <DiffStat added={file.added} removed={file.removed} withBar />
      </button>
      <Expand isOpen={isOpen}>
        <div className="pt-1 pb-2">
          {file.binary ? (
            <p className="px-2 type-meta text-subtle-foreground">Binary file</p>
          ) : (
            <DiffView patch={file.patch} />
          )}
        </div>
      </Expand>
    </li>
  );
}

function NoTasks() {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BackgroundTask />
        </EmptyMedia>
        <EmptyTitle>No background tasks yet</EmptyTitle>
        <EmptyDescription>
          Subagents, delegated tasks and background commands this thread's agent
          starts show here, with their logs, output and changes.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** The command's output, read from the file its harness writes it to: re-read every second while it runs, once more when it ends. */
function useTaskRun(
  task: TaskRow,
): RunResult | Pick<RunResult, 'lines'> | undefined {
  const { outputFile, status } = task;
  const isRunning = status === 'running';
  const outputQuery = useQuery({
    queryKey: queryKeys.agent.taskOutput(outputFile, isRunning),
    queryFn: () => {
      const { dir, name } = splitPath(outputFile!);
      return host.fs.read(dir, name);
    },
    enabled: !!outputFile,
    refetchInterval: isRunning ? OUTPUT_POLL_MS : false,
    staleTime: 0,
  });
  const text = outputQuery.data?.kind === 'text' ? outputQuery.data.text : '';
  const lines = outputLines(text);
  if (task.exitCode !== undefined) return { exitCode: task.exitCode, lines };
  return status === 'done' ? { exitCode: 0, lines } : { lines };
}

const OUTPUT_POLL_MS = 1000;
