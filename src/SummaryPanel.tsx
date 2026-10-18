import { isValidElement, useRef, useState, type KeyboardEvent, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { FileIcon } from '@react-symbols/icons/utils';
import { Reorder, useDragControls } from 'motion/react';
import { limitStatus } from './chat/LimitCard';
import {
  Plus,
  Code,
  Chart,
  Cpu,
  File,
  Folder,
  Grip,
  Hourglass,
  Image,
  Link,
  Pin,
  PinOff,
  Route,
  ShieldAlert,
  ShieldCheck,
  Warning,
  type IconComponent,
} from '@/icons';
import { GitPullRequestIcon } from '@/icons/github';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from '@/components/ui/item';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/toast/store';
import { threadCwd } from '@/host/cwd';
import { useGitDiff } from './git/useGit';
import { DiffIcon } from './icons/panes';
import { cn } from '@/lib/utils';
import { copyText } from './clipboard';
import { EDITOR_NAMES, openInEditor, useInstalledEditors } from './files/editors';
import { openFiles } from './files/viewer';
import { RefHoverCard, RefIcon } from './chat/RefHoverCard';
import { useThreadPrs, type ThreadPr } from './git/useThreadPrs';
import { BranchIcon, BranchName } from './git/BranchLabel';
import type { McpServer, Provider, Source, Thread } from './model';
import { isFolderSource, sourceFrom, sourceUrl } from './sources';
import type { Action } from './store';
import { openProfileConfig } from './settings/open';
import { GoalDetails } from './goals/GoalDetails';
import { openGoalEditor } from './goals/GoalEditor';
import { useNextMove } from './goals/NextMove';
import { useIdleVerdict } from './goals/VerdictChip';
import { showsVerdictCard } from './goals/report';
import { SummaryCriteria, SummaryGoal, SummaryGoalHeader, SummaryGoalStatus, SummaryGoalText, SummaryNextMove } from './goals/SummaryGoal';
import { clock } from './progress';
import { useHarness } from './store';
import { summarize, type ThreadSummary } from './summary';
import { hasGoal } from './drift';
import { currentAction, PHASE_LABELS } from './agentPhase';
import { OverflowIcon } from './ui';
import { toneFor, untilLabel } from './usage/limits';
import { useAccountLimits } from './usage/useAccountLimits';
import { connectorStatus, fileCount, orderCards, savedOrder, summaryCards, type SummaryCardId } from './summarySections';
import { SkillIcon } from './icons/ObjectIcons';
import { McpServerMark, SkillMark } from './chat/McpIcon';
import { useLibraryNames } from './library/names';
import { DeviceIcon, THIS_DEVICE } from './remote/DeviceIcon';
import { usePorts } from './terminal/ports';
import { usePaneOpeners } from './terminal/usePaneOpeners';
import { PortIcon } from './pane/PortIcon';
import { queuedMessage } from './chat/outbox';
import { useArtifacts, type FileArtifact, type VisualArtifact } from './pane/artifacts';
import { splitPath } from './chat/imageSrc';
import type { VizLanguage } from './viz/fence';
import type { ListeningPort } from './host/types/ports';

const LIST_LIMIT = 3;
const OPEN_BY_DEFAULT = ['environment', 'sources', 'servers', 'outputs', 'changes'] satisfies SummaryCardId[];

/** `onPaneOpened`: a row opened something in the side pane, so a summary covering it (the narrow sheet) can step aside. `isFloating`: cards float over the chat. */
export function SummaryPanel({
  thread,
  className,
  isFloating,
  onPaneOpened,
}: {
  thread: Thread;
  className?: string;
  isFloating?: boolean;
  onPaneOpened?: () => void;
}) {
  return (
    <aside aria-label="Thread summary" data-floating={isFloating || undefined} className={cn('group/summary flex min-h-0 flex-col', className)}>
      <ScrollArea type="scroll" className="min-h-0 flex-1">
        <SummaryBody thread={thread} onPaneOpened={onPaneOpened} />
      </ScrollArea>
    </aside>
  );
}

const CARD = 'rounded-xl border bg-card group-data-floating/summary:bg-popover group-data-floating/summary:shadow-float';

/** What needs you first, then a card per thing the right side holds, each only once it has something: like Claude's. */
function SummaryBody({ thread, onPaneOpened }: { thread: Thread; onPaneOpened?: () => void }) {
  const { summary, cards, ports, outputs, open } = useSummary(thread, onPaneOpened);
  const [order, reorder] = useCardOrder(cards);
  const props = { thread, summary, open };
  const BODIES = {
    goal: <GoalSection thread={thread} />,
    environment: <EnvironmentCard {...props} />,
    sources: <SourcesCard {...props} />,
    connectors: <ConnectorsCard {...props} />,
    servers: <ServersCard ports={ports} onOpen={open.port} />,
    outputs: <OutputsCard {...outputs} open={open} />,
    changes: <ChangesCard {...props} />,
  } satisfies Record<SummaryCardId, ReactNode>;

  return (
    <div className="flex flex-col gap-2">
      {hasGoal(thread) && <WaitingMove thread={thread} />}
      <NeedsYou thread={thread} />
      <RateLimitWarning thread={thread} />
      <Accordion type="multiple" defaultValue={OPEN_BY_DEFAULT} asChild>
        <Reorder.Group axis="y" values={order} onReorder={reorder} className="flex flex-col gap-2">
          {order.map((id) => (
            <DraggableCard key={id} id={id} onMove={(step) => reorder(moveCard(order, id, step))}>
              {id === 'goal' ? (
                BODIES.goal
              ) : (
                <AccordionItem value={id} className={CARD}>
                  {BODIES[id]}
                </AccordionItem>
              )}
            </DraggableCard>
          ))}
        </Reorder.Group>
      </Accordion>
    </div>
  );
}

const ORDER_KEY = 'mochi.summary-order.v1';

/** The shown cards in the order you last dragged them to, remembered on this device for every thread. */
function useCardOrder(cards: SummaryCardId[]) {
  const [saved, setSaved] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(ORDER_KEY) ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  const reorder = (shown: SummaryCardId[]) => {
    const next = savedOrder(shown, saved);
    setSaved(next);
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify(next));
    } catch {
      // Storage can be blocked (private window); the order still holds for this session.
    }
  };
  return [orderCards(cards, saved), reorder] as const;
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
const CARD_MOVE = { layout: { duration: 0.26, ease: [0.32, 0.72, 0, 1] } } as const;

/** A card that moves only from its handle, so text in it stays selectable and its rows clickable. Alt+↑/↓ on the handle moves it too. */
function DraggableCard({ id, onMove, children }: { id: SummaryCardId; onMove: (step: -1 | 1) => void; children: ReactNode }) {
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
      className="group/card relative data-[dragging]:z-10"
    >
      {children}
      <button
        type="button"
        data-drag-handle
        aria-label={`Move the ${id} card`}
        aria-keyshortcuts="ArrowUp ArrowDown"
        onPointerDown={(e) => controls.start(e)}
        onKeyDown={onKeyDown}
        className="absolute top-2 right-2 z-20 flex size-6 cursor-grab touch-none items-center justify-center rounded-md text-subtle-foreground opacity-0 transition-opacity duration-150 group-hover/card:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 active:cursor-grabbing pointer-coarse:opacity-100"
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
  const { ports = [] } = usePorts(thread.id, cwd, open.port);
  const outputs = useArtifacts(thread, thread.repo ? null : cwd);
  const outputCount = outputs.files.length + outputs.visuals.length;
  const cards = summaryCards({ thread, summary, portCount: ports.length, outputCount });
  return { summary, cards, ports, outputs, open };
}

interface CardProps {
  thread: Thread;
  summary: ThreadSummary;
  open: ReturnType<typeof useSummaryOpeners>;
}

/** The top-right corner holds only read-outs: the drag handle takes their place while the card is hovered or the handle focused. */
const UNDER_HANDLE = 'transition-opacity duration-150 group-hover/card:opacity-0 group-has-[[data-drag-handle]:focus-visible]/card:opacity-0 pointer-coarse:opacity-0';

function CardHeader({ title, meta }: { title: string; meta?: ReactNode }) {
  return (
    // The chevron sits beside the title, like Claude's; `order-last` puts the meta after it, on the right. One down chevron
    // turns instead of the primitive's down/up icon swap.
    <AccordionTrigger className="items-center justify-start gap-1 rounded-xl px-3 py-2.5 hover:no-underline focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 **:data-[slot=accordion-trigger-icon]:ml-0 **:data-[slot=accordion-trigger-icon]:size-3.5 [&>svg:last-child]:hidden! aria-expanded:[&>svg:nth-last-child(2)]:inline! aria-expanded:[&>svg:nth-last-child(2)]:rotate-180 [&>svg]:transition-transform [&>svg]:duration-150 [&>svg]:ease-[cubic-bezier(0.23,1,0.32,1)]">
      <span className="type-meta font-medium">{title}</span>
      {!!meta && <span className={cn('order-last ml-auto flex min-w-0 items-center gap-2 tabular type-caption font-normal text-subtle-foreground', UNDER_HANDLE)}>{meta}</span>}
    </AccordionTrigger>
  );
}

function CardBody({ children }: { children: ReactNode }) {
  return <AccordionContent className="flex flex-col gap-0.5 px-1 pb-1.5">{children}</AccordionContent>;
}

/** Pending approval or question; blocked steps say so in the goal block. */
function NeedsYou({ thread }: { thread: Thread }) {
  // A limit's own line is `RateLimitWarning`'s.
  if (thread.status !== 'needs-you' || thread.live?.limit) return null;
  return (
    <p role="status" className="flex items-center gap-2.5 rounded-xl border border-warning/40 bg-warning/8 px-3 py-2 type-meta text-warning">
      <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
      {currentAction(thread)?.label ?? PHASE_LABELS.wait}
    </p>
  );
}

function EnvironmentCard({ thread }: CardProps) {
  const { repo, agent } = thread;
  const fullAccess = isFullAccess(agent?.permissionMode);
  return (
    <>
      <CardHeader title="Environment" />
      <CardBody>
        <SummaryRow icon={<DeviceIcon kind={THIS_DEVICE} className="size-4" />} label="This computer" />
        <SummaryRow
          icon={Folder}
          label={
            repo ? (
              <>
                {repo.project}
                {!!repo.path && <span className="text-subtle-foreground"> · {homeShort(parentOf(repo.path))}</span>}
              </>
            ) : (
              'No project folder'
            )
          }
        >
          <FolderMenu thread={thread} />
        </SummaryRow>
        {!!repo && (
          <SummaryRow
            icon={<BranchIcon repo={repo} className="size-4 text-muted-foreground" />}
            label={<BranchName repo={repo} title="Copy branch name" />}
            onClick={repo.isDetached ? undefined : () => copyText(repo.branch, 'Branch name copied')}
          />
        )}
        {!!agent?.model && <SummaryRow icon={Cpu} label={agent.model} />}
        {!!agent?.permissionMode && (
          <SummaryRow
            icon={fullAccess ? <ShieldAlert className="size-4 text-warning" /> : ShieldCheck}
            label={<span className={cn(fullAccess && 'text-warning')}>{permissionLabel(agent.permissionMode)}</span>}
          />
        )}
      </CardBody>
    </>
  );
}

const parentOf = (path: string) => path.replace(/\/[^/]+\/?$/, '') || '/';
const homeShort = (path: string) => path.replace(/^\/(Users|home)\/[^/]+/, '~');

/** What the agent was handed or reached for: links, files and MCP items you added, then the skills it used. Context use lives in the composer's ring. */
function SourcesCard({ thread, summary, open }: CardProps) {
  const count = thread.sources.length + summary.skills.length;
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
        <AddSourceRow thread={thread} />
      </CardBody>
    </>
  );
}

function SkillRows({ thread, skills }: { thread: Thread; skills: ThreadSummary['skills'] }) {
  const names = useLibraryNames();
  return (
    <LimitedList items={skills}>
      {(skill) => (
        <SummaryRow
          key={skill.name}
          icon={<SkillMark skill={skill.name} fallback={<SkillIcon />} />}
          label={<span title={skill.name}>{names.skill(skill.name).title}</span>}
          onClick={() => openProfileConfig(thread.spaceId, 'skills', thread.session?.provider ?? thread.providers[0])}
        >
          <span className="tabular type-caption text-subtle-foreground">
            ×{skill.uses} · {clock(skill.lastAt)}
          </span>
        </SummaryRow>
      )}
    </LimitedList>
  );
}

const MCP_STATUS_LABELS = { connected: '', pending: 'Connecting', 'needs-auth': 'Needs sign-in', failed: 'Failed', disabled: 'Disabled' } satisfies Record<
  McpServer['status'],
  string
>;
const MCP_STATUS_CLASSES = {
  connected: '',
  pending: 'text-subtle-foreground',
  'needs-auth': 'text-warning',
  failed: 'text-destructive',
  disabled: 'text-subtle-foreground',
} satisfies Record<McpServer['status'], string>;

function ConnectorsCard({ thread }: CardProps) {
  const names = useLibraryNames();
  const servers = thread.agent?.mcpServers ?? [];
  const status = connectorStatus(servers);
  const manage = () => openProfileConfig(thread.spaceId, 'mcp', thread.session?.provider ?? thread.providers[0]);
  return (
    <>
      <CardHeader title="Connectors" meta={<span className={cn(status.needsYou && 'text-warning')}>{status.text}</span>} />
      <CardBody>
        <LimitedList items={servers}>
          {(server) => (
            <SummaryRow
              key={server.name}
              icon={<McpServerMark server={server.name} url={server.url} />}
              label={<span title={server.name}>{names.server(server.name).title}</span>}
              onClick={manage}
            >
              <span className={cn('tabular type-caption', MCP_STATUS_CLASSES[server.status] || 'text-subtle-foreground')}>
                {MCP_STATUS_LABELS[server.status] || (server.toolCount === undefined ? 'Connected' : `${server.toolCount} tools`)}
              </span>
            </SummaryRow>
          )}
        </LimitedList>
      </CardBody>
    </>
  );
}

function ServersCard({ ports, onOpen }: { ports: ListeningPort[]; onOpen: (port: number) => void }) {
  return (
    <>
      <CardHeader title="Servers" meta={ports.length} />
      <CardBody>
        {ports.map((p) => (
          <SummaryRow
            key={`${p.pid}:${p.port}`}
            icon={<PortIcon />}
            label={
              <span title={`${p.command} · pid ${p.pid}`}>
                <span className="text-muted-foreground">localhost:</span>
                <span className="tabular">{p.port}</span>
                <span className="text-subtle-foreground"> · {p.command}</span>
              </span>
            }
            onClick={() => onOpen(p.port)}
          />
        ))}
      </CardBody>
    </>
  );
}

const VISUAL_ICONS = { chart: Chart, svg: Image, html: Code, 'harness-metro': Route, 'harness-diff': DiffIcon } satisfies Record<VizLanguage, IconComponent>;

function OutputsCard({ files, visuals, open }: { files: FileArtifact[]; visuals: VisualArtifact[]; open: CardProps['open'] }) {
  const outputs = [...files.map((file) => ({ file })), ...visuals.map((visual) => ({ visual }))];
  return (
    <>
      <CardHeader title="Outputs" meta={outputs.length} />
      <CardBody>
        <LimitedList items={outputs}>
          {(output, i) => {
            if ('file' in output) {
              const { name } = splitPath(output.file.path);
              return (
                <SummaryRow
                  key={output.file.path}
                  icon={<FileIcon fileName={name} autoAssign aria-hidden className="size-4" />}
                  label={<span title={output.file.path}>{name}</span>}
                  onClick={() => open.output(output.file.path)}
                />
              );
            }
            const { visual } = output;
            return <SummaryRow key={`${visual.at}:${i}`} icon={VISUAL_ICONS[visual.language]} label={visual.title} onClick={() => open.visual(visual)} />;
          }}
        </LimitedList>
      </CardBody>
    </>
  );
}

function ChangesCard({ thread, summary, open }: CardProps) {
  const prs = useThreadPrs(thread, thread.prs);
  const cwd = threadCwd(thread);
  if (!thread.repo || !cwd) return <ChangesBody thread={thread} prs={prs} files={summary.files} open={open} />;
  return <BranchChanges thread={thread} cwd={cwd} prs={prs} open={open} />;
}

/** The branch against its base, as the Changes pane shows it by default: edits made through shell commands count too. */
function BranchChanges({ thread, cwd, prs, open }: { thread: Thread; cwd: string; prs: ThreadPr[]; open: CardProps['open'] }) {
  const diffQuery = useGitDiff(cwd, 'branch', thread.repo?.base);
  return <ChangesBody thread={thread} prs={prs} files={diffQuery.data?.files} open={open} />;
}

function ChangesBody({
  thread,
  prs,
  files,
  open,
}: {
  thread: Thread;
  prs: ThreadPr[];
  files?: { added: number; removed: number }[];
  open: CardProps['open'];
}) {
  const added = files?.reduce((n, f) => n + f.added, 0) ?? 0;
  const removed = files?.reduce((n, f) => n + f.removed, 0) ?? 0;
  const hasChanges = !!files?.length;
  const canOpenPr = hasChanges && prs.length === 0 && !!thread.repo;
  return (
    <>
      <CardHeader
        title="Changes"
        meta={
          hasChanges && (
            <span>
              <span className="text-success">+{added}</span> <span className="text-destructive">−{removed}</span>
            </span>
          )
        }
      />
      <CardBody>
        {!!files && (
          <SummaryRow
            icon={DiffIcon}
            label={hasChanges ? fileCount(files.length) : thread.status === 'settled' ? 'No changes' : 'No changes yet'}
            onClick={open.changes}
          />
        )}
        {prs.map((item) => (
          <PullRequestRow key={item.pr.number} item={item} onOpen={open.url} />
        ))}
        {canOpenPr && <CreatePrRow thread={thread} />}
      </CardBody>
    </>
  );
}

const OPEN_PR_PROMPT =
  'Open a pull request for this branch: commit what is left, then use the open_pr tool with a title and a short why. If a check or gap blocks it, tell me what is missing instead.';

/**
 * Hands the PR to the agent, always through the queue so it never steers a running turn: it goes out once the agent is idle.
 * The PR the agent opens lands in the thread's PRs, so this row turns into it.
 */
function CreatePrRow({ thread }: { thread: Thread }) {
  const { dispatch } = useHarness();
  const isQueued = !!thread.queued?.some((m) => m.draft === OPEN_PR_PROMPT);
  const queue = () => {
    dispatch({ type: 'queued-add', threadId: thread.id, message: queuedMessage(OPEN_PR_PROMPT, { mentions: [], isCommand: false, typedSkills: [] }) });
    toast('Pull request queued', { description: 'The agent opens it when this turn ends.' });
  };
  if (isQueued) return <SummaryRow icon={<GitPullRequestIcon className="size-4 text-subtle-foreground" />} label={<span className="text-muted-foreground">Pull request queued</span>} />;
  return (
    <SummaryRow icon={<GitPullRequestIcon className="size-4 text-muted-foreground" />} label="Create pull request" onClick={queue}>
      <Plus className="size-3.5 text-subtle-foreground" aria-hidden />
    </SummaryRow>
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
  return thread.agent?.mcpServers?.find((s) => s.name.toLowerCase() === server.toLowerCase())?.url;
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
            <DropdownMenuItem key={editor} onSelect={() => openInEditor(editor, root, '')}>
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
  const { dispatch } = useHarness();
  const openers = usePaneOpeners(thread.id);
  const toPane = (action: Action) => {
    dispatch(action);
    onPaneOpened?.();
  };
  const url = (address: string) => toPane({ type: 'pane-open-tab', threadId: thread.id, kind: 'browser', url: address });
  const root = threadCwd(thread);

  const source = (s: Source): (() => void) | null => {
    if (s.kind === 'link') return () => url(sourceUrl(s.label));
    if (s.kind === 'mcp') return () => openProfileConfig(thread.spaceId, 'mcp', thread.providers[0]);
    if (!root) return null;
    if (isFolderSource(s)) return () => toPane({ type: 'pane-show-tab', threadId: thread.id, kind: 'files' });
    return () => openFiles({ files: [{ source: 'workspace', threadId: thread.id, root, path: s.label }], index: 0 });
  };

  const output = (path: string) => {
    const { dir, name } = splitPath(path);
    openFiles({ files: [{ source: 'workspace', threadId: thread.id, root: dir, path: name }], index: 0 });
  };
  const visual = (v: VisualArtifact) =>
    toPane({ type: 'pane-open-tab', threadId: thread.id, kind: 'visual', title: v.title, visual: { language: v.language, code: v.code } });
  const port = (p: number) => {
    openers.openPort(p);
    onPaneOpened?.();
  };

  return { changes: () => toPane({ type: 'pane-show-tab', threadId: thread.id, kind: 'changes' }), url, source, output, visual, port };
}

// SummaryRow doesn't forward props, so the hover card and context menu triggers sit on a wrapper.
function PullRequestRow({ item, onOpen }: { item: ThreadPr; onOpen: (url: string) => void }) {
  const url = item.state.url;
  const row = (
    <div>
      <SummaryRow icon={<RefIcon item={item} className="size-4" />} label={item.state.title} onClick={url ? () => onOpen(url) : undefined}>
        <span className="tabular type-caption text-subtle-foreground">{item.label}</span>
      </SummaryRow>
    </div>
  );
  if (!url)
    return (
      <RefHoverCard item={item} side="left" align="start">
        {row}
      </RefHoverCard>
    );
  return (
    <ContextMenu>
      <RefHoverCard item={item} side="left" align="start">
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      </RefHoverCard>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onOpen(url)}>Open in the side pane</ContextMenuItem>
        {/* The main process sends a new window's http(s) URL to the system browser (electron/window.ts). */}
        <ContextMenuItem onSelect={() => window.open(url, '_blank', 'noreferrer')}>Open in your browser</ContextMenuItem>
        <ContextMenuItem onSelect={() => copyText(url, 'Link copied')}>Copy link</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** A URL or a path in the thread's folder; a live agent is told in a message of yours. */
function AddSourceRow({ thread }: { thread: Thread }) {
  const { dispatch } = useHarness();
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
          <SummaryRow icon={Plus} label={<span className="text-muted-foreground">Add a source</span>} onClick={() => setOpen(true)} />
        </div>
      </PopoverAnchor>
      <PopoverContent align="end" side="left" className="w-72">
        <form onSubmit={submit} className="flex flex-col gap-2">
          <label htmlFor={`add-source-${thread.id}`} className="type-meta font-medium">
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
  const media = <ItemMedia>{isValidElement(Icon) ? Icon : <Icon className="size-4 text-muted-foreground" />}</ItemMedia>;
  const title = <ItemTitle className="w-full min-w-0 truncate font-normal">{label}</ItemTitle>;
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
    <Item size="xs" className="relative isolate min-h-8 gap-2.5 rounded-lg px-2 py-1 hover:bg-accent/60">
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
      {!!children && <ItemActions className="relative z-10">{children}</ItemActions>}
    </Item>
  );
}

function LimitedList<T>({ items, children }: { items: T[]; children: (item: T, index: number) => ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const shown = isOpen ? items : items.slice(0, LIST_LIMIT);
  return (
    <>
      {shown.map(children)}
      {items.length > LIST_LIMIT && (
        <Button variant="ghost" size="xs" className="ml-1 self-start text-subtle-foreground" onClick={() => setOpen((o) => !o)}>
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
const isFullAccess = (mode?: string) => !!mode && /bypassPermissions|dangerFullAccess/.test(mode);
const permissionLabel = (mode: string) =>
  mode
    .split(' · ')
    .map((part) => PERMISSION_LABELS[part] ?? part)
    .join(', ');

const PROVIDER_NAMES = { claude: 'Claude', codex: 'Codex' } satisfies Record<Provider, string>;

function RateLimitWarning({ thread }: { thread: Thread }) {
  const provider = thread.providers[0];
  const { limits } = useAccountLimits(provider, thread.spaceId);
  const tight = limits?.windows.find((w) => toneFor(w.usedPct / 100) === 'destructive');
  const limit = limitStatus(thread);
  if (limit) return <WarningLine icon={Hourglass}>{limit}</WarningLine>;
  if (thread.status !== 'running' || !tight) return null;

  const name = `${PROVIDER_NAMES[provider]} ${tight.label.toLowerCase()} limit`;
  const resets = tight.resetsAt ? `, resets in ${untilLabel(Date.parse(tight.resetsAt) - Date.now())}` : '';
  return (
    <WarningLine icon={Warning}>
      {tight.usedPct >= 100 ? `${name} reached; this agent stalls until it resets${resets}.` : `${name} at ${Math.round(tight.usedPct)}%${resets}.`}
    </WarningLine>
  );
}

function WarningLine({ icon: Icon, children }: { icon: IconComponent; children: ReactNode }) {
  return (
    <p role="status" className="flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/8 px-3 py-2 type-caption text-warning">
      <Icon className="size-4 shrink-0" aria-hidden />
      {children}
    </p>
  );
}

/** The goal card; Open shows its history in a popover beside the panel. */
function GoalSection({ thread }: { thread: Thread }) {
  const [isOpen, setOpen] = useState(false);
  const [isPinned, setPinned] = useState(false);
  const block = useRef<HTMLElement>(null);
  const verdict = useIdleVerdict(thread);
  const step = thread.steps.find((s) => s.status === 'running')?.title;
  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <SummaryGoal ref={block} className={cn(CARD, 'px-3 py-2.5')}>
          <SummaryGoalHeader thread={thread} onEdit={() => openGoalEditor(thread.id)} onOpen={() => setOpen((o) => !o)} countClassName={UNDER_HANDLE} />
          <SummaryGoalStatus thread={thread} verdict={verdict} step={step} />
          <SummaryGoalText>{thread.goal}</SummaryGoalText>
          <SummaryCriteria thread={thread} />
        </SummaryGoal>
      </PopoverAnchor>
      <PopoverContent
        side="left"
        align="start"
        sideOffset={12}
        collisionPadding={16}
        onEscapeKeyDown={() => setPinned(false)}
        // The block's own Open button toggles; a click elsewhere in the block (Run check) leaves it open.
        onInteractOutside={(e) => (isPinned || block.current?.contains(e.target as Node)) && e.preventDefault()}
        className="surface-float w-[min(440px,calc(100vw-420px))] max-h-[calc(100vh-32px)] gap-0 overflow-y-auto rounded-xl bg-float p-5 shadow-float"
      >
        <div className="mb-3 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setPinned((p) => !p)} aria-pressed={isPinned}>
            {isPinned ? <PinOff data-icon="inline-start" /> : <Pin data-icon="inline-start" />}
            {isPinned ? 'Unpin' : 'Keep open'}
          </Button>
        </div>
        <GoalDetails thread={thread} />
      </PopoverContent>
    </Popover>
  );
}

/** The end-of-turn question while it waits in the chat; it scrolls there rather than answering here. */
function WaitingMove({ thread }: { thread: Thread }) {
  const next = useNextMove(thread);
  if (!next?.question || !showsVerdictCard(thread)) return null;
  return <SummaryNextMove question={next.question} onShow={() => showNextMove(thread.id)} />;
}

function showNextMove(threadId: string) {
  const card = document.querySelector<HTMLElement>(`[data-next-move="${CSS.escape(threadId)}"]`);
  card?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  card?.querySelector<HTMLElement>('button:last-of-type')?.focus({ preventScroll: true });
}
