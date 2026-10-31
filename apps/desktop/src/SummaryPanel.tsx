import { Card } from '@/components/ui/card';
import { persistedFamily, persistedSlice } from './lib/uiStorage.ts';
import {
  isValidElement,
  useState,
  type KeyboardEvent,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { FileIcon } from '@react-symbols/icons/utils';
import { Reorder, useDragControls } from 'motion/react';
import {
  Plus,
  BackgroundTask,
  Code,
  Chart,
  File,
  Grip,
  Image,
  Link,
  Route,
  Stop,
  ShieldAlert,
  DiagramTree,
  Undo,
  XCircle,
  type IconComponent,
  Diff,
} from '@/icons';
import { GitPullRequestIcon } from '@/icons/github';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/toast/store';
import { threadCwd } from '@/host/cwd';
import { useRemoteMachine } from './remote/origin';
import { useGitDiff } from './git/useGit';
import { cn } from '@/lib/utils';
import {
  EDITOR_NAMES,
  openInEditor,
  useInstalledEditors,
} from './files/editors';
import { openFiles } from './files/viewer';
import { RefIcon, ThreadPrHoverCard } from './chat/RefHoverCard';
import { ThreadName } from './chat/ThreadMessage';
import { refDescription, type ChecksState } from '@mochi/domain/chat/refs';
import { CHECK } from './git/Checks';
import { useThreadPrs, type ThreadPr } from './git/useThreadPrs';
import { OPEN_PR_PROMPT } from './git/prs';
import type { Source, Thread } from './model';
import { isFolderSource, sourceFrom, sourceUrl } from './sources';
import type { Action } from './store';
import { openProfileConfig } from './routes/nav';
import { SubThreadRow } from './goals/SubThreadRow';
import { useOpenThread } from './goals/SubThreads';
import { clock, shortElapsed } from './progress';
import { parentOf, subThreadsOf } from './reorder';
import { useDispatch, shallowEqual, useHarnessSelector } from './store';
import { summarize, type ThreadSummary } from './summary';
import { currentAction, PHASE_LABELS } from './agentPhase';
import { OverflowIcon, TooltipIconButton } from './ui';
import {
  isActive,
  stopTask,
  taskResult,
  threadTasks,
  type TaskRow,
} from './runtime/tasks';
import { TaskIcon, useElapsed } from './agents/parts';
import {
  brokenConnectors,
  connectorUsage,
  fileCount,
  orderCards,
  savedOrder,
  summaryCards,
  type SummaryCardId,
} from './summarySections';
import { SkillIcon } from './icons/ObjectIcons';
import { McpServerMark, SkillMark } from './chat/McpIcon';
import { useLibraryNames } from './library/names';
import { DeviceIcon } from './remote/DeviceIcon';
import { useThisBackend } from './remote/useThisBackend';
import { useLaunchNames, usePorts } from './terminal/ports';
import { portUrl } from '@mochi/domain/terminal/devServer';
import { usePaneOpeners } from './terminal/usePaneOpeners';
import { PortIcon } from './pane/PortIcon';
import { queuedMessage } from './chat/outbox';
import {
  artifactsOf,
  type FileArtifact,
  type VisualArtifact,
} from './pane/artifacts';
import { splitPath } from './chat/imageSrc';
import type { VizLanguage } from '@mochi/domain/viz/fence';
import type { ListeningPort } from '@mochi/domain/host/types/ports';

const LIST_LIMIT = 3;
// Sources starts folded: it's reference, not something you check mid-run.
const OPEN_BY_DEFAULT: string[] = ['threads'] satisfies SummaryCardId[];

/**
 * `onPaneOpened`: a row opened something in the side pane, so a summary covering it (the narrow drawer) can step aside.
 * `variant`: `floating` cards float over the chat; `flat` sections share the one surface they sit in (the narrow drawer).
 */
export function SummaryPanel({
  thread,
  className,
  variant,
  onPaneOpened,
}: {
  thread: Thread;
  className?: string;
  variant?: 'floating' | 'flat';
  onPaneOpened?: () => void;
}) {
  return (
    <aside
      aria-label="Thread summary"
      data-variant={variant}
      className={cn('group/summary flex min-h-0 flex-col', className)}
    >
      <ScrollArea type="scroll" className="min-h-0 flex-1">
        <SummaryBody thread={thread} onPaneOpened={onPaneOpened} />
      </ScrollArea>
    </aside>
  );
}

// Docked, cards sit on the chat's own surface, a hairline the only edge; floating over the chat they need the popover's fill; flat, they drop their chrome.
// 22px squircle corners need a 44px-tall box: any shorter and the browser shrinks both corners to fit, so a folded card would round tighter than an open one.
const CARD =
  'min-h-11 gap-0 rounded-lg py-0 bg-background group-data-[variant=floating]/summary:bg-popover group-data-[variant=floating]/summary:shadow-float group-data-[variant=flat]/summary:rounded-none group-data-[variant=flat]/summary:border-0 group-data-[variant=flat]/summary:bg-transparent';

/** What needs you first, then what runs, what it made, what it's tied to and what it used, each only once it has something; where it runs closes the column. */
function SummaryBody({
  thread,
  onPaneOpened,
}: {
  thread: Thread;
  onPaneOpened?: () => void;
}) {
  const { summary, cards, links, ports, launchNames, outputs, open } =
    useSummary(thread, onPaneOpened);
  const [order, reorder] = useCardOrder(cards);
  const [openCards, setOpenCards] = useState(OPEN_BY_DEFAULT);
  const [isChangesOpen, setChangesOpen] = useOpenInThread(
    CHANGES_CLOSED_KEY,
    thread.id,
  );
  const [isRunningOpen, setRunningOpen] = useOpenInThread(
    RUNNING_CLOSED_KEY,
    thread.id,
  );
  const onOpenChange = (value: string[]) => {
    setOpenCards(value.filter((id) => id !== 'changes' && id !== 'running'));
    setChangesOpen(value.includes('changes'));
    setRunningOpen(value.includes('running'));
  };
  const props = { thread, summary, open };
  const BODIES = {
    running: <RunningCard {...props} ports={ports} launchNames={launchNames} />,
    changes: <ChangesCard {...props} outputs={outputs} />,
    threads: <ThreadsCard {...links} />,
    sources: <SourcesCard {...props} />,
  } satisfies Record<SummaryCardId, ReactNode>;

  return (
    <div className="flex flex-col gap-2">
      <NeedsYou thread={thread} />
      <Accordion
        type="multiple"
        value={[
          ...openCards,
          ...(isChangesOpen ? ['changes'] : []),
          ...(isRunningOpen ? ['running'] : []),
        ]}
        onValueChange={onOpenChange}
        asChild
      >
        <Reorder.Group
          axis="y"
          values={order}
          onReorder={reorder}
          className="flex flex-col gap-2"
        >
          {order.map((id) => (
            <DraggableCard
              key={id}
              id={id}
              onMove={(step) => reorder(moveCard(order, id, step))}
            >
              <AccordionItem value={id} asChild>
                <Card className={CARD}>{BODIES[id]}</Card>
              </AccordionItem>
            </DraggableCard>
          ))}
        </Reorder.Group>
      </Accordion>
      <EnvironmentLine thread={thread} />
    </div>
  );
}

const orderSlice = persistedSlice<string[]>('mochi.summary-order.v2', []);
const closedSlice = persistedFamily<string[]>('', []);

/** The shown cards in the order you last dragged them to, remembered on this device for every thread. */
function useCardOrder(cards: SummaryCardId[]) {
  const [saved, setSaved] = useState(() => orderSlice.getState().value);
  const reorder = (shown: SummaryCardId[]) => {
    const next = savedOrder(shown, saved);
    setSaved(next);
    orderSlice.setState({ value: next });
  };
  return [orderCards(cards, saved), reorder] as const;
}

const CHANGES_CLOSED_KEY = 'mochi.summary-changes-closed.v1';
// The Running card took over Background tasks' fold, so its key stays.
const RUNNING_CLOSED_KEY = 'mochi.summary-tasks-closed.v1';

/** A card that is open unless you folded it in this thread (Changes, Running); remembered on this device under `key`. */
function useOpenInThread(key: string, threadId: string) {
  const [closed, setClosed] = useState(() => closedSlice(key).getState().value);
  const isOpen = !closed.includes(threadId);
  const setOpen = (open: boolean) => {
    if (open === isOpen) return;
    const next = open
      ? closed.filter((id) => id !== threadId)
      : [...closed, threadId];
    setClosed(next);
    closedSlice(key).setState({ value: next });
  };
  return [isOpen, setOpen] as const;
}

const moveCard = (order: SummaryCardId[], id: SummaryCardId, step: -1 | 1) => {
  const from = order.indexOf(id);
  const to = from + step;
  if (to < 0 || to >= order.length) return order;
  const next = [...order];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
};

// The panes' drawer curve and duration, so cards settle like the column they sit in; no bounce.
const CARD_MOVE = {
  layout: { duration: 0.26, ease: [0.32, 0.72, 0, 1] },
} as const;

/** A card that moves only from its handle, so text in it stays selectable and its rows clickable. Alt+↑/↓ on the handle moves it too. */
function DraggableCard({
  id,
  onMove,
  children,
}: {
  id: SummaryCardId;
  onMove: (step: -1 | 1) => void;
  children: ReactNode;
}) {
  const controls = useDragControls();
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    onMove(e.key === 'ArrowUp' ? -1 : 1);
  };
  return (
    <Reorder.Item
      as="div"
      value={id}
      dragListener={false}
      dragControls={controls}
      // `position`: an expanding card must not size-animate (Motion's default `layout` squashes it on the next render).
      layout="position"
      transition={CARD_MOVE}
      whileDrag={{ scale: 1.01 }}
      className="group/summary-card relative data-[dragging]:z-10"
    >
      {children}
      <button
        type="button"
        data-drag-handle
        aria-label={`Move the ${id} card`}
        aria-keyshortcuts="ArrowUp ArrowDown"
        onPointerDown={(e) => controls.start(e)}
        onKeyDown={onKeyDown}
        className="absolute top-2 right-2 z-20 flex size-6 cursor-grab touch-none items-center justify-center rounded-md text-subtle-foreground opacity-0 transition-opacity duration-150 group-hover/summary-card:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 active:cursor-grabbing pointer-coarse:opacity-100"
      >
        <Grip className="size-3.5" aria-hidden />
      </button>
    </Reorder.Item>
  );
}

function useSummary(thread: Thread, onPaneOpened?: () => void) {
  const summary = summarize(thread.activity);
  const open = useSummaryOpeners(thread, onPaneOpened);
  const cwd = threadCwd(thread) ?? null;
  const { ports = [] } = usePorts(thread.id, cwd);
  const launchNames = useLaunchNames(cwd);
  const outputs = artifactsOf(thread, thread.repo ? null : cwd);
  const outputCount = outputs.files.length + outputs.visuals.length;
  const links = useThreadLinks(thread);
  const cards = summaryCards({
    thread,
    summary,
    linkedThreadCount:
      +!!links.parent + links.subs.length + links.replyTo.length,
    portCount: ports.length,
    outputCount,
  });
  return { summary, cards, links, ports, launchNames, outputs, open };
}

/** The threads this one is tied to: its parent, its open sub-threads, and the ones its next turn end answers. */
function useThreadLinks(thread: Thread) {
  const parent = useHarnessSelector((s) => parentOf(s.threads, thread));
  const subs = useHarnessSelector(
    (s) =>
      subThreadsOf(s.threads, thread.id).filter((t) => t.status !== 'settled'),
    shallowEqual,
  );
  return { parent, subs, replyTo: thread.replyTo ?? [] };
}

interface CardProps {
  thread: Thread;
  summary: ThreadSummary;
  open: ReturnType<typeof useSummaryOpeners>;
}

/** The top-right corner holds only read-outs: the drag handle takes their place while the card is hovered or the handle focused. */
const UNDER_HANDLE =
  'transition-opacity duration-150 group-hover/summary-card:opacity-0 group-has-[[data-drag-handle]:focus-visible]/summary-card:opacity-0 pointer-coarse:opacity-0';

function CardHeader({ title, meta }: { title: string; meta?: ReactNode }) {
  return (
    // The chevron sits beside the title, like Claude's; `order-last` puts the meta after it, on the right. One down chevron
    // turns instead of the primitive's down/up icon swap.
    <AccordionTrigger className="items-center justify-start gap-1 rounded-xl px-3 py-2.5 hover:no-underline focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 **:data-[slot=accordion-trigger-icon]:ml-0 **:data-[slot=accordion-trigger-icon]:size-3.5 [&>svg:last-child]:hidden! aria-expanded:[&>svg:nth-last-child(2)]:inline! aria-expanded:[&>svg:nth-last-child(2)]:rotate-180 [&>svg]:transition-transform [&>svg]:duration-150 [&>svg]:ease-[cubic-bezier(0.23,1,0.32,1)]">
      <span className="type-meta font-medium">{title}</span>
      {!!meta && (
        <span
          className={cn(
            'order-last ml-auto flex min-w-0 items-center gap-2 tabular type-caption font-normal text-subtle-foreground',
            UNDER_HANDLE,
          )}
        >
          {meta}
        </span>
      )}
    </AccordionTrigger>
  );
}

function CardBody({ children }: { children: ReactNode }) {
  return (
    <AccordionContent className="flex flex-col gap-0.5 px-1 pb-1.5">
      {children}
    </AccordionContent>
  );
}

/** What waits on you: a pending approval or question, then each connector that needs you to sign in again. */
function NeedsYou({ thread }: { thread: Thread }) {
  const names = useLibraryNames();
  // A held limit says so in the chat; the summary doesn't repeat it.
  const isWaiting = thread.status === 'needs-you' && !thread.live?.limit;
  const broken = brokenConnectors(thread.agent?.mcpServers ?? []);
  if (!isWaiting && broken.length === 0) return null;
  return (
    <div
      role="status"
      className="flex min-h-11 flex-col justify-center gap-1.5 rounded-lg border border-warning/40 bg-warning/8 px-3 py-2 type-meta text-warning"
    >
      {isWaiting && (
        <p className="flex items-center gap-2.5">
          <span
            className="size-1.5 shrink-0 rounded-full bg-warning"
            aria-hidden
          />
          {currentAction(thread)?.label ?? PHASE_LABELS.wait}
        </p>
      )}
      {broken.map((server) => (
        <button
          key={server.name}
          type="button"
          onClick={() => openProfileConfig(thread.spaceId, 'mcp')}
          className="flex min-w-0 cursor-default items-center gap-2 text-left hover:underline focus-visible:outline-2"
        >
          <McpServerMark server={server.name} url={server.url} />
          <span className="truncate">
            {names.server(server.name).title}{' '}
            {server.status === 'failed' ? 'failed to connect' : 'needs sign-in'}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Where it runs, closing the column: device and project folder, its editor menu, and full access in warning. Branch and model live under the composer. */
function EnvironmentLine({ thread }: { thread: Thread }) {
  const { repo, agent } = thread;
  const fullAccess = isFullAccess(agent?.permissionMode);
  const machine = useRemoteMachine();
  const here = useThisBackend();
  return (
    // Floating over the chat it needs the cards' fill, or it reads as chat text.
    <div className="flex min-h-7 min-w-0 items-center gap-1.5 pr-1 pl-3 type-caption text-subtle-foreground group-data-[variant=floating]/summary:min-h-11 group-data-[variant=floating]/summary:rounded-lg group-data-[variant=floating]/summary:bg-popover group-data-[variant=floating]/summary:shadow-float">
      {fullAccess && (
        <span className="flex shrink-0 items-center gap-1.5 text-warning">
          <ShieldAlert className="size-3.5" aria-hidden />
          {permissionLabel(agent!.permissionMode!)} ·
        </span>
      )}
      <DeviceIcon
        kind={machine ? machine.kind : here.kind}
        className="size-3.5 shrink-0"
      />
      <span className="min-w-0 truncate" title={repo?.path}>
        {machine?.name ?? here.name}
        {' · '}
        {repo ? repo.project : 'No project folder'}
      </span>
      <span className="ml-auto">
        <FolderMenu thread={thread} />
      </span>
    </div>
  );
}

/** What the agent was handed or reached for: links, files and MCP items you added, the skills it used, then the connectors it called. */
function SourcesCard({ thread, summary, open }: CardProps) {
  const connectors = connectorUsage(
    thread.agent?.mcpServers ?? [],
    summary.servers,
  );
  const count =
    thread.sources.length + summary.skills.length + connectors.length;
  return (
    <>
      <CardHeader title="Sources" meta={count > 0 && count} />
      <CardBody>
        <LimitedList items={thread.sources}>
          {(source) => (
            <SummaryRow
              key={source.label}
              icon={<SourceIcon thread={thread} source={source} />}
              label={source.label}
              onClick={open.source(source) ?? undefined}
            />
          )}
        </LimitedList>
        <SkillRows thread={thread} skills={summary.skills} />
        <ConnectorRows thread={thread} rows={connectors} />
        <AddSourceRow thread={thread} />
      </CardBody>
    </>
  );
}

function SkillRows({
  thread,
  skills,
}: {
  thread: Thread;
  skills: ThreadSummary['skills'];
}) {
  const names = useLibraryNames();
  return (
    <LimitedList items={skills}>
      {(skill) => (
        <SummaryRow
          key={skill.name}
          icon={<SkillMark skill={skill.name} fallback={<SkillIcon />} />}
          label={
            <span title={skill.name}>{names.skill(skill.name).title}</span>
          }
          onClick={() => openProfileConfig(thread.spaceId, 'skills')}
        >
          <span className="tabular type-caption text-subtle-foreground">
            ×{skill.uses} · {clock(skill.lastAt)}
          </span>
        </SummaryRow>
      )}
    </LimitedList>
  );
}

function ConnectorRows({
  thread,
  rows,
}: {
  thread: Thread;
  rows: ReturnType<typeof connectorUsage>;
}) {
  const names = useLibraryNames();
  return (
    <LimitedList items={rows}>
      {({ server, calls }) => (
        <SummaryRow
          key={server.name}
          icon={<McpServerMark server={server.name} url={server.url} />}
          label={
            <span title={server.name}>{names.server(server.name).title}</span>
          }
          onClick={() => openProfileConfig(thread.spaceId, 'mcp')}
        >
          <span className="tabular type-caption text-subtle-foreground">
            ×{calls}
          </span>
        </SummaryRow>
      )}
    </LimitedList>
  );
}

function ThreadsCard({
  parent,
  subs,
  replyTo,
}: ReturnType<typeof useThreadLinks>) {
  const openThread = useOpenThread();
  return (
    <>
      <CardHeader title="Threads" />
      <CardBody>
        {!!parent && (
          <SummaryRow
            icon={DiagramTree}
            label={
              <>
                <span className="text-muted-foreground">Sub-thread of </span>
                {parent.title}
              </>
            }
            onClick={() => openThread(parent)}
          />
        )}
        {subs.map((sub) => (
          <SubThreadRow key={sub.id} sub={sub} peekSide="left" />
        ))}
        {replyTo.map((ref) => (
          <ReplyRow key={ref.threadId} to={ref} />
        ))}
      </CardBody>
    </>
  );
}

/** A thread that messaged this one and waits: this thread's next turn end goes back to it. */
function ReplyRow({ to }: { to: NonNullable<Thread['replyTo']>[number] }) {
  const openThread = useOpenThread();
  const target = useHarnessSelector((s) =>
    s.threads.find((t) => t.id === to.threadId),
  );
  return (
    <SummaryRow
      icon={Undo}
      label={
        <>
          <span className="text-muted-foreground">Replies to </span>
          {target?.title ?? to.title}
        </>
      }
      onClick={target ? () => openThread(target) : undefined}
    />
  );
}

/** What is live right now: dev servers listening, then background tasks, each with its age and a stop button; finished tasks fold into one row. */
function RunningCard({
  thread,
  open,
  ports,
  launchNames,
}: CardProps & {
  ports: ListeningPort[];
  launchNames: Map<number, string>;
}) {
  const tasks = threadTasks(thread);
  const running = tasks.filter(isActive);
  const finished = tasks.filter((t) => !isActive(t));
  // Every task has its page in the Background tasks tab: an agent's transcript, a command's live output and exit code.
  const openTask = (task: TaskRow) => () => open.agent(task.id);
  return (
    <>
      <CardHeader title="Running" meta={ports.length + running.length} />
      <CardBody>
        {ports.map((p) => (
          <SummaryRow
            key={`${p.pid}:${p.port}`}
            icon={<PortIcon />}
            label={
              <span title={portUrl(p.port)}>
                {launchNames.get(p.port) ?? <PortLabel port={p.port} />}
              </span>
            }
            onClick={() => open.port(p.port)}
          />
        ))}
        {running.map((task) => (
          <SummaryRow
            key={task.id}
            icon={<TaskIcon thread={thread} task={task} />}
            label={task.title}
            onClick={openTask(task)}
          >
            <TaskAge task={task} />
            <StopTask thread={thread} task={task} />
          </SummaryRow>
        ))}
        {finished.length > 0 && (
          <FinishedTasks thread={thread} tasks={finished} openTask={openTask} />
        )}
      </CardBody>
    </>
  );
}

function PortLabel({ port }: { port: number }) {
  return (
    <>
      <span className="text-muted-foreground">localhost:</span>
      <span className="tabular">{port}</span>
    </>
  );
}

const VISUAL_ICONS = {
  chart: Chart,
  svg: Image,
  html: Code,
  'harness-metro': Route,
  'harness-diff': Diff,
} satisfies Record<VizLanguage, IconComponent>;

/** Files and visuals the agent made, under the diff: everything it produced in one card. */
function OutputRows({
  files,
  visuals,
  open,
}: Outputs & { open: CardProps['open'] }) {
  const outputs = [
    ...files.map((file) => ({ file })),
    ...visuals.map((visual) => ({ visual })),
  ];
  return (
    <LimitedList items={outputs}>
      {(output, i) => {
        if ('file' in output) {
          const { name } = splitPath(output.file.path);
          return (
            <SummaryRow
              key={output.file.path}
              icon={
                <FileIcon
                  fileName={name}
                  autoAssign
                  aria-hidden
                  className="size-4"
                />
              }
              label={<span title={output.file.path}>{name}</span>}
              onClick={() => open.output(output.file.path)}
            />
          );
        }
        const { visual } = output;
        return (
          <SummaryRow
            key={`${visual.at}:${i}`}
            icon={VISUAL_ICONS[visual.language]}
            label={visual.title}
            onClick={() => open.visual(visual)}
          />
        );
      }}
    </LimitedList>
  );
}

interface Outputs {
  files: FileArtifact[];
  visuals: VisualArtifact[];
}

function ChangesCard({
  thread,
  summary,
  open,
  outputs,
}: CardProps & { outputs: Outputs }) {
  const prs = useThreadPrs(thread, thread.prs);
  const cwd = threadCwd(thread);
  if (!thread.repo || !cwd)
    return (
      <ChangesBody
        thread={thread}
        prs={prs}
        files={summary.files}
        outputs={outputs}
        open={open}
      />
    );
  return (
    <BranchChanges
      thread={thread}
      cwd={cwd}
      prs={prs}
      outputs={outputs}
      open={open}
    />
  );
}

/** The branch against its base, as the Changes pane shows it by default: edits made through shell commands count too. */
function BranchChanges({
  thread,
  cwd,
  prs,
  outputs,
  open,
}: {
  thread: Thread;
  cwd: string;
  prs: ThreadPr[];
  outputs: Outputs;
  open: CardProps['open'];
}) {
  const diffQuery = useGitDiff(cwd, 'branch', thread.repo?.base);
  return (
    <ChangesBody
      thread={thread}
      prs={prs}
      files={diffQuery.data?.files}
      error={diffQuery.error}
      onRetry={diffQuery.refresh}
      outputs={outputs}
      open={open}
    />
  );
}

function ChangesBody({
  thread,
  prs,
  files,
  error,
  onRetry,
  outputs,
  open,
}: {
  thread: Thread;
  prs: ThreadPr[];
  files?: { added: number; removed: number }[];
  error?: string;
  onRetry?: () => void;
  outputs: Outputs;
  open: CardProps['open'];
}) {
  const added = files?.reduce((n, f) => n + f.added, 0) ?? 0;
  const removed = files?.reduce((n, f) => n + f.removed, 0) ?? 0;
  const hasChanges = !!files?.length;
  // Without a repo, a chat that only made files has no diff worth a "No changes" row.
  const isOutputsOnly =
    !thread.repo &&
    !hasChanges &&
    outputs.files.length + outputs.visuals.length > 0;
  const canOpenPr = hasChanges && prs.length === 0 && !!thread.repo;
  return (
    <>
      <CardHeader title="Changes" />
      <CardBody>
        {prs.map((item) => (
          <PullRequestRow key={item.pr.number} thread={thread} item={item} />
        ))}
        {!!files && prs.length === 0 && !isOutputsOnly && (
          <SummaryRow
            icon={Diff}
            label={
              hasChanges
                ? fileCount(files.length)
                : thread.status === 'settled'
                  ? 'No changes'
                  : 'No changes yet'
            }
            onClick={open.changes}
          >
            {hasChanges && <DiffCount added={added} removed={removed} />}
          </SummaryRow>
        )}
        {!files && prs.length === 0 && (
          <DiffPendingRow error={error} onRetry={onRetry} />
        )}
        {canOpenPr && <CreatePrRow thread={thread} />}
        <SubThreadPrs parent={thread} />
        <OutputRows {...outputs} open={open} />
      </CardBody>
    </>
  );
}

/** The branch diff not read yet, or its read failed: the card says which instead of showing a bare header. */
function DiffPendingRow({
  error,
  onRetry,
}: {
  error?: string;
  onRetry?: () => void;
}) {
  if (!error) return <SummaryRow icon={Diff} label="Reading changes…" />;
  return (
    <SummaryRow
      icon={<XCircle className="size-4 text-destructive" />}
      label={<span title={error}>Couldn't read changes</span>}
      onClick={onRetry}
    />
  );
}

/** The PRs of the thread's sub-threads, after its own: each sub-thread runs its PR (and its Auto-fix); here they read live, named for it. */
function SubThreadPrs({ parent }: { parent: Thread }) {
  return useHarnessSelector(
    (s) => subThreadsOf(s.threads, parent.id),
    shallowEqual,
  )
    .filter((sub) => sub.prs.length > 0)
    .map((sub) => <SubThreadPrRows key={sub.id} sub={sub} />);
}

function SubThreadPrRows({ sub }: { sub: Thread }) {
  const prs = useThreadPrs(sub);
  return prs.map((item) => (
    <PullRequestRow key={item.pr.number} thread={sub} item={item} isSubThread />
  ));
}

function DiffCount({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="tabular shrink-0 type-caption whitespace-nowrap">
      <span className="text-success">+{added}</span>{' '}
      <span className="text-destructive">−{removed}</span>
    </span>
  );
}

/**
 * Hands the PR to the agent, always through the queue so it never steers a running turn: it goes out once the agent is idle.
 * The PR the agent opens lands in the thread's PRs, so this row turns into it.
 */
function CreatePrRow({ thread }: { thread: Thread }) {
  const dispatch = useDispatch();
  const isQueued = !!thread.queued?.some((m) => m.draft === OPEN_PR_PROMPT);
  const queue = () => {
    dispatch({
      type: 'queued-add',
      threadId: thread.id,
      message: queuedMessage(OPEN_PR_PROMPT, {
        mentions: [],
        isCommand: false,
        typedSkills: [],
      }),
    });
    toast('Pull request queued', {
      description: 'The agent opens it when this turn ends.',
    });
  };
  if (isQueued)
    return (
      <SummaryRow
        icon={<GitPullRequestIcon className="size-4 text-subtle-foreground" />}
        label={
          <span className="text-muted-foreground">Pull request queued</span>
        }
      />
    );
  return (
    <SummaryRow
      icon={<GitPullRequestIcon className="size-4 text-muted-foreground" />}
      label="Create pull request"
      onClick={queue}
    >
      <Plus className="size-3.5 text-subtle-foreground" aria-hidden />
    </SummaryRow>
  );
}

/** The finished tasks stay out of the card: their row opens them in a popover beside it, each with its outcome and how long it ran. */
function FinishedTasks({
  thread,
  tasks,
  openTask,
}: {
  thread: Thread;
  tasks: TaskRow[];
  openTask: (task: TaskRow) => () => void;
}) {
  const [isOpen, setOpen] = useState(false);
  const pick = (task: TaskRow) => () => {
    setOpen(false);
    openTask(task)();
  };
  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div>
          <SummaryRow
            icon={BackgroundTask}
            label={`${tasks.length} finished`}
            onClick={() => setOpen((o) => !o)}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        side="left"
        align="end"
        sideOffset={12}
        collisionPadding={16}
        className="max-h-[min(420px,calc(100vh-32px))] w-72 gap-0 overflow-y-auto p-1"
      >
        {tasks.toReversed().map((task) => (
          <SummaryRow
            key={task.id}
            icon={<TaskIcon thread={thread} task={task} />}
            label={task.title}
            onClick={pick(task)}
          >
            <span
              className={cn(
                'type-caption',
                task.status === 'failed'
                  ? 'text-destructive'
                  : 'text-subtle-foreground',
              )}
            >
              {taskResult(task)}
            </span>
            <TaskAge task={task} />
          </SummaryRow>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** How long it has run, ticking while it runs; how long it took once it ended. */
function TaskAge({ task }: { task: TaskRow }) {
  return (
    <span className="tabular type-caption text-subtle-foreground">
      {shortElapsed(useElapsed(task.startedAt, task.endedAt))}
    </span>
  );
}

function StopTask({ thread, task }: { thread: Thread; task: TaskRow }) {
  const dispatch = useDispatch();
  return (
    <TooltipIconButton
      label="Stop task"
      hint={`Stops “${task.title}”; its output so far stays`}
      size="icon-xs"
      className="text-subtle-foreground hover:text-foreground"
      onClick={() => dispatch(stopTask(thread.id, task))}
    >
      <Stop filled className="size-3" />
    </TooltipIconButton>
  );
}

function SourceIcon({ thread, source }: { thread: Thread; source: Source }) {
  if (source.kind === 'link') return <Link className="size-4 text-chart-1" />;
  if (source.kind === 'file') return <File className="size-4 text-chart-4" />;
  // An MCP source's label leads with its server ("Linear · LAT-198 Rate limits"); the model doesn't carry the server itself.
  const server = source.label.split(' · ')[0].toLowerCase();
  return <McpServerMark server={server} url={serverUrl(thread, server)} />;
}

function serverUrl(thread: Thread, server: string) {
  return thread.agent?.mcpServers?.find(
    (s) => s.name.toLowerCase() === server.toLowerCase(),
  )?.url;
}

function FolderMenu({ thread }: { thread: Thread }) {
  const editors = useInstalledEditors();
  const root = threadCwd(thread);
  if (!root || editors.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="Folder options">
          <OverflowIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          {editors.map((editor) => (
            <DropdownMenuItem
              key={editor}
              onSelect={() => openInEditor(editor, root, '')}
            >
              Open in {EDITOR_NAMES[editor]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Where each summary row leads: the side pane for changes, links, servers, folders and visuals, the file viewer for files, Settings for MCP. */
function useSummaryOpeners(thread: Thread, onPaneOpened?: () => void) {
  const dispatch = useDispatch();
  const openers = usePaneOpeners(thread.id);
  const toPane = (action: Action) => {
    dispatch(action);
    onPaneOpened?.();
  };
  const url = (address: string) =>
    toPane({
      type: 'pane-open-tab',
      threadId: thread.id,
      kind: 'browser',
      url: address,
    });
  const root = threadCwd(thread);

  const source = (s: Source): (() => void) | null => {
    if (s.kind === 'link') return () => url(sourceUrl(s.label));
    if (s.kind === 'mcp') return () => openProfileConfig(thread.spaceId, 'mcp');
    if (!root) return null;
    if (isFolderSource(s))
      return () =>
        toPane({ type: 'pane-show-tab', threadId: thread.id, kind: 'files' });
    return () =>
      openFiles({
        files: [
          { source: 'workspace', threadId: thread.id, root, path: s.label },
        ],
        index: 0,
      });
  };

  const output = (path: string) => {
    const { dir, name } = splitPath(path);
    openFiles({
      files: [
        { source: 'workspace', threadId: thread.id, root: dir, path: name },
      ],
      index: 0,
    });
  };
  const visual = (v: VisualArtifact) =>
    toPane({
      type: 'pane-open-tab',
      threadId: thread.id,
      kind: 'visual',
      title: v.title,
      visual: { language: v.language, code: v.code },
    });
  const port = (p: number) => {
    openers.openPort(p);
    onPaneOpened?.();
  };

  const agent = (subagentId: string) =>
    toPane({ type: 'pane-show-agent', threadId: thread.id, subagentId });

  return {
    changes: () =>
      toPane({ type: 'pane-show-tab', threadId: thread.id, kind: 'changes' }),
    source,
    output,
    visual,
    port,
    agent,
  };
}

/** Like Claude's: state icon and title on top; number, diff and checks under the title. A click opens its preview, which stays until an outside click or Esc; hovering or focusing doesn't. */
function PullRequestRow({
  thread,
  item,
  isSubThread = false,
}: {
  thread: Thread;
  item: ThreadPr;
  isSubThread?: boolean;
}) {
  const { state, label } = item;
  const [isOpen, setOpen] = useState(false);
  return (
    <ThreadPrHoverCard
      thread={thread}
      pr={item.pr}
      side="left"
      align="start"
      open={isOpen}
      // A popover: the row's click toggles it; an outside click or Esc closes it.
      onOpenChange={setOpen}
    >
      <div className="relative isolate flex flex-col gap-0.5 rounded-lg px-2 py-1.5 hover:bg-accent/60">
        <div className="flex min-w-0 items-center gap-2.5">
          <RefIcon item={item} className="size-4" />
          {state.url ? (
            // The stretched button makes the whole row the target.
            <button
              type="button"
              aria-expanded={isOpen}
              aria-label={`${label}: ${state.title}, ${refDescription('pr', state)}`}
              className="min-w-0 flex-1 cursor-default truncate text-left type-meta after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2"
            >
              {state.title}
            </button>
          ) : (
            <span className="min-w-0 flex-1 truncate type-meta">
              {state.title}
            </span>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-2 pl-6.5 tabular type-caption text-subtle-foreground">
          <span className="shrink-0">{label}</span>
          {isSubThread && (
            <ThreadName
              peer={{ threadId: thread.id, title: thread.title }}
              className="max-w-none min-w-0 shrink text-muted-foreground hover:text-foreground"
            />
          )}
          {!!state.diff && (
            <DiffCount added={state.diff.added} removed={state.diff.removed} />
          )}
          {!!state.checkCounts && (
            <CheckCount checks={state.checks} counts={state.checkCounts} />
          )}
        </div>
      </div>
    </ThreadPrHoverCard>
  );
}

function CheckCount({
  checks,
  counts,
}: {
  checks: ChecksState | null;
  counts: { passed: number; total: number };
}) {
  return (
    <span
      className="ml-auto flex shrink-0 items-center gap-1.5"
      aria-label={`${counts.passed} of ${counts.total} checks passed`}
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full bg-current',
          CHECK[checks ?? 'pending'].tone,
        )}
      />
      {counts.passed}/{counts.total}
    </span>
  );
}

/** A URL or a path in the thread's folder; a live agent is told in a message of yours. */
function AddSourceRow({ thread }: { thread: Thread }) {
  const dispatch = useDispatch();
  const [isOpen, setOpen] = useState(false);
  const [text, setText] = useState('');
  const source = sourceFrom(text);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!source) return;
    dispatch({ type: 'source-add', threadId: thread.id, source });
    setText('');
    setOpen(false);
  };
  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div>
          <SummaryRow
            icon={Plus}
            label={<span className="text-muted-foreground">Add a source</span>}
            onClick={() => setOpen(true)}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent align="end" side="left" className="w-72">
        <form onSubmit={submit} className="flex flex-col gap-2">
          <label
            htmlFor={`add-source-${thread.id}`}
            className="type-meta font-medium"
          >
            Add a source
          </label>
          <Input
            id={`add-source-${thread.id}`}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={thread.repo ? 'https://… or docs/api.md' : 'https://…'}
          />
          <p className="type-caption text-subtle-foreground">
            {source
              ? source.kind === 'link'
                ? 'Adds a link'
                : "Adds a file from this thread's folder"
              : thread.live
                ? 'A link or file the agent should use; it gets a message'
                : 'Paste a URL or type a file path'}
          </p>
          <Button type="submit" size="sm" className="self-end">
            Add source
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** `icon`: an icon drawn muted, or an element that brings its own colour (a PR's state icon). `children`: trailing meta or actions. */
function SummaryRow({
  icon: Icon,
  label,
  onClick,
  children,
}: {
  icon: IconComponent | ReactElement;
  label: ReactNode;
  onClick?: () => void;
  children?: ReactNode;
}) {
  const media = (
    <ItemMedia>
      {isValidElement(Icon) ? (
        Icon
      ) : (
        <Icon className="size-4 text-muted-foreground" />
      )}
    </ItemMedia>
  );
  const title = (
    <ItemTitle className="w-full min-w-0 truncate font-normal">
      {label}
    </ItemTitle>
  );
  if (!onClick)
    return (
      <Item size="xs" className="min-h-8 gap-2.5 px-2 py-1">
        {media}
        <ItemContent className="min-w-0">{title}</ItemContent>
        {!!children && <ItemActions>{children}</ItemActions>}
      </Item>
    );
  // The stretched button keeps trailing actions (a menu) clickable without nesting buttons.
  return (
    <Item
      size="xs"
      className="relative isolate min-h-8 gap-2.5 rounded-lg px-2 py-1 hover:bg-accent/60"
    >
      {media}
      <ItemContent className="min-w-0">
        <button
          type="button"
          onClick={onClick}
          className="cursor-default text-left after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2"
        >
          {title}
        </button>
      </ItemContent>
      {!!children && (
        <ItemActions className="relative z-10">{children}</ItemActions>
      )}
    </Item>
  );
}

function LimitedList<T>({
  items,
  children,
}: {
  items: T[];
  children: (item: T, index: number) => ReactNode;
}) {
  const [isOpen, setOpen] = useState(false);
  const shown = isOpen ? items : items.slice(0, LIST_LIMIT);
  return (
    <>
      {shown.map(children)}
      {items.length > LIST_LIMIT && (
        <Button
          variant="ghost"
          size="xs"
          className="ml-1 self-start text-subtle-foreground"
          onClick={() => setOpen((o) => !o)}
        >
          {isOpen ? 'Show less' : `Show ${items.length - LIST_LIMIT} more`}
        </Button>
      )}
    </>
  );
}

// Claude permission modes, then Codex approval policies and sandboxes, which arrive joined as `<policy> · <sandbox>`.
const PERMISSION_LABELS: Record<string, string> = {
  default: 'Ask before edits',
  acceptEdits: 'Accept edits',
  plan: 'Plan only',
  bypassPermissions: 'Bypass permissions',
  dontAsk: "Don't ask",
  auto: 'Auto',
  untrusted: 'Ask for untrusted',
  'on-request': 'Ask on request',
  never: 'Never ask',
  granular: 'Custom approvals',
  workspaceWrite: 'workspace write',
  readOnly: 'read only',
  dangerFullAccess: 'full access',
  externalSandbox: 'external sandbox',
};
const isFullAccess = (mode?: string) =>
  !!mode && /bypassPermissions|dangerFullAccess/.test(mode);
const permissionLabel = (mode: string) =>
  mode
    .split(' · ')
    .map((part) => PERMISSION_LABELS[part] ?? part)
    .join(', ');
