import { isValidElement, useState, type CSSProperties, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { limitStatus } from './chat/LimitCard';
import { Add, Code, Coins, Document, DollarCircle, Edit, Global, GlobalSearch, Hourglass, Link, Maximize, Note, Pin, PinOff, PuzzlePiece, Server, Setting, TriangleWarning, type IconComponent } from 'reicon-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { threadCwd } from '@/host/cwd';
import { cn } from '@/lib/utils';
import { copyText } from './clipboard';
import { EDITOR_NAMES, openInEditor, useInstalledEditors } from './files/editors';
import { openFiles } from './files/viewer';
import { RefHoverCard, RefIcon } from './chat/RefHoverCard';
import { useThreadPrs, type ThreadPr } from './git/useThreadPrs';
import type { McpServer, Provider, PullRequest, Source, Step, Thread } from './model';
import { isFolderSource, sourceFrom, sourceUrl } from './sources';
import type { Action } from './store';
import { HARNESSES } from './settings/harnesses';
import { openProfileConfig } from './settings/open';
import { profileById } from './profiles';
import { GoalTimeline, StepLinkLine } from './GoalTimeline';
import { openGoalEditor } from './goals/GoalEditor';
import { CriteriaList } from './goals/CriteriaList';
import { outcomeOf } from './goals/outcome';
import { burnSeries, clock, duration, GOAL_PHASE_LABELS, goalProgress, progressAt, progressLabel } from './progress';
import { useHarness } from './store';
import { hasGoal } from './drift';
import { summarize, type CountedVerb, type ThreadSummary } from './summary';
import { lineColor, OverflowIcon, StepStatusIcon, TooltipIconButton } from './ui';
import { spaceUsage, threadUsage, type Usage } from './usage/model';
import { toneFor, untilLabel } from './usage/limits';
import { useAccountLimits } from './usage/useAccountLimits';
import { currentAction, PHASE_LABELS } from './agentPhase';
import { openSectionIds, rememberOpen, summarySections, TOKENS, USD, useRememberedOpen, type SummarySection, type SummarySectionId } from './summarySections';

const LIST_LIMIT = 3;

const TOOL_ICONS = { Read: Document, Edit: Edit, Write: Edit, Run: Code, Browser: Global, Search: GlobalSearch, Fetch: Global } satisfies Record<CountedVerb, IconComponent>;
const TOOL_LABELS = { Read: 'Read files', Edit: 'Edited files', Write: 'Wrote files', Run: 'Ran commands', Browser: 'Used the browser', Search: 'Searched the web', Fetch: 'Read web pages' } satisfies Record<CountedVerb, string>;
const SOURCE_ICONS = { link: Link, mcp: Setting, file: Document } satisfies Record<Source['kind'], IconComponent>;

/** `onPaneOpened`: a row opened something in the side pane, so a summary covering it (the narrow sheet) can step aside. */
export function SummaryPanel({ thread, className, onPaneOpened }: { thread: Thread; className?: string; onPaneOpened?: () => void }) {
  return (
    <aside aria-label="Thread summary" className={cn('flex min-h-0 flex-col', className)}>
      <ScrollArea className="min-h-0 flex-1">
        <SummaryBody thread={thread} onPaneOpened={onPaneOpened} />
      </ScrollArea>
    </aside>
  );
}

/** The base panel says where the thread stands, what needs you and what shipped; everything else waits in collapsed sections. */
function SummaryBody({ thread, onPaneOpened }: { thread: Thread; onPaneOpened?: () => void }) {
  const summary = summarize(thread.activity);
  const sections = useSummarySections(thread, summary);
  const open = useSummaryOpeners(thread, onPaneOpened);
  const props = { thread, summary, open };

  return (
    <div className="flex flex-col gap-0.5 px-2 pt-2 pb-3">
      <PanelHeader thread={thread} />
      {hasGoal(thread) && (
        <>
          <GoalSection thread={thread} />
          <Separator className="mx-2 my-2 w-auto!" />
        </>
      )}
      <NeedsYou thread={thread} />
      <RateLimitWarning thread={thread} />
      <ChangesRow {...props} />
      <PullRequests thread={thread} prs={thread.prs} onOpen={open.url} />
      {sections.length > 0 && <SummarySections sections={sections} {...props} />}
    </div>
  );
}

function useSummarySections(thread: Thread, summary: ThreadSummary) {
  const { state } = useHarness();
  return summarySections({ thread, summary, threads: state.threads, space: profileById(thread.spaceId) });
}

interface SectionProps {
  thread: Thread;
  summary: ThreadSummary;
  open: ReturnType<typeof useSummaryOpeners>;
}

const SECTION_BODIES = {
  outcome: OutcomeDetails,
  sources: SourceRows,
  skills: SkillRows,
  tools: ToolRows,
  session: SessionDetails,
  usage: ThreadUsageRows,
  space: SpaceUsageRows,
} satisfies Record<SummarySectionId, unknown>;

function SummarySections({ sections, ...props }: SectionProps & { sections: SummarySection[] }) {
  const remembered = useRememberedOpen();
  return (
    <Accordion
      type="multiple"
      value={openSectionIds(sections, remembered, props.thread.status === 'settled')}
      onValueChange={(ids) => rememberOpen(sections, ids)}
      className="gap-0.5 pt-2"
    >
      {sections.map((section) => {
        const Body = SECTION_BODIES[section.id];
        return (
          <AccordionItem key={section.id} value={section.id} className="not-last:border-b-0">
            <AccordionTrigger className="h-7 items-center gap-2 px-2 py-0 font-normal text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground hover:no-underline aria-expanded:text-foreground **:data-[slot=accordion-trigger-icon]:size-3.5">
              <span className="min-w-0 flex-1 truncate">
                {section.title}
                {!!section.detail && <span className="tabular text-subtle-foreground"> · {section.detail}</span>}
              </span>
            </AccordionTrigger>
            <AccordionContent className="flex flex-col gap-0.5 pt-0.5 pb-2">
              <Body {...props} />
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

/** Pending approval or question; blocked steps say so in the goal block. */
function NeedsYou({ thread }: { thread: Thread }) {
  // A limit's own line is `RateLimitWarning`'s.
  if (thread.status !== 'needs-you' || thread.live?.limit) return null;
  return (
    <p role="status" className="flex items-center gap-2.5 px-2 py-1 type-meta text-warning">
      <span className="flex w-4 shrink-0 justify-center" aria-hidden>
        <span className="size-1.5 rounded-full bg-warning" />
      </span>
      {currentAction(thread)?.label ?? PHASE_LABELS.wait}
    </p>
  );
}

function ChangesRow({ thread, summary, open }: SectionProps) {
  if (!thread.repo && summary.files.length === 0) return null;
  return (
    <SummaryRow icon={Edit} label="Changes" onClick={thread.repo ? open.changes : undefined}>
      <span className="tabular type-caption text-subtle-foreground">
        {summary.files.length === 0 ? (
          (thread.status === 'settled' ? 'None' : 'None yet')
        ) : (
          <>
            <span className="text-success">+{summary.added}</span> <span className="text-destructive">−{summary.removed}</span> · {summary.files.length}{' '}
            {PLURAL.select(summary.files.length) === 'one' ? 'file' : 'files'}
          </>
        )}
      </span>
    </SummaryRow>
  );
}

function PullRequests({ thread, prs, onOpen }: { thread: Thread; prs: PullRequest[]; onOpen: (url: string) => void }) {
  const items = useThreadPrs(thread, prs);
  if (items.length === 0) return null;
  return (
    <Section label="Pull requests">
      <LimitedList items={items}>{(item) => <PullRequestRow key={item.pr.number} item={item} onOpen={onOpen} />}</LimitedList>
    </Section>
  );
}

function SourceRows({ thread, open }: SectionProps) {
  return (
    <LimitedList items={thread.sources}>
      {(source) => <SummaryRow key={source.label} icon={SOURCE_ICONS[source.kind]} label={source.label} onClick={open.source(source) ?? undefined} />}
    </LimitedList>
  );
}

function SkillRows({ thread, summary }: SectionProps) {
  return (
    <LimitedList items={summary.skills}>
      {(skill) => (
        <SummaryRow
          key={skill.name}
          icon={Note}
          label={skill.name}
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

function ToolRows({ summary }: SectionProps) {
  return (
    <>
      {summary.tools.map((t) => (
        <SummaryRow key={t.verb} icon={TOOL_ICONS[t.verb]} label={TOOL_LABELS[t.verb]}>
          <span className="tabular type-caption text-subtle-foreground">{t.count}</span>
        </SummaryRow>
      ))}
      {summary.servers.map((s) => (
        <SummaryRow key={s.server} icon={Server} label={<McpServerLabel usage={s} />}>
          <span className="tabular type-caption text-subtle-foreground">{s.calls}</span>
        </SummaryRow>
      ))}
    </>
  );
}

/** An MCP server's calls: its name, then the tools it ran, muted. */
function McpServerLabel({ usage }: { usage: ThreadSummary['servers'][number] }) {
  return (
    <span title={usage.tools.join(', ')}>
      {usage.server}
      <span className="text-subtle-foreground"> · {usage.tools.join(', ')}</span>
    </span>
  );
}

function PanelHeader({ thread }: { thread: Thread }) {
  const { repo } = thread;
  const [isAdding, setAdding] = useState(false);
  return (
    <div className="flex items-center gap-2 px-2 pb-1">
      <span className="min-w-0 flex-1 truncate type-meta text-muted-foreground">
        {thread.repo ? (
          <>
            {thread.repo.project}
            <span className="text-subtle-foreground"> · </span>
            <span className="font-mono type-caption">{thread.repo.branch}</span>
          </>
        ) : (
          'No project'
        )}
      </span>
      <AddSource thread={thread} isOpen={isAdding} onOpenChange={setAdding}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label="Summary options">
              <OverflowIcon vertical />
            </Button>
          </DropdownMenuTrigger>
          {/* Adding a source hands focus to its field; returning it to this trigger would close the popover. */}
          <DropdownMenuContent align="end" onCloseAutoFocus={(e) => isAdding && e.preventDefault()}>
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => setAdding(true)}>
                <Add />
                Add a source…
              </DropdownMenuItem>
              {repo && (
                <DropdownMenuItem onSelect={() => navigator.clipboard?.writeText(repo.branch).catch(() => undefined)}>Copy branch name</DropdownMenuItem>
              )}
              <OpenInEditorItems thread={thread} />
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </AddSource>
    </div>
  );
}

/** Where each summary row leads: the side pane for changes, links and folders, the file viewer for files, Settings for MCP. */
function useSummaryOpeners(thread: Thread, onPaneOpened?: () => void) {
  const { dispatch } = useHarness();
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

  return { changes: () => toPane({ type: 'pane-show-tab', threadId: thread.id, kind: 'changes' }), url, source };
}

function OpenInEditorItems({ thread }: { thread: Thread }) {
  const editors = useInstalledEditors();
  const root = threadCwd(thread);
  if (!root) return null;
  return editors.map((editor) => (
    <DropdownMenuItem key={editor} onSelect={() => openInEditor(editor, root, '')}>
      Open in {EDITOR_NAMES[editor]}
    </DropdownMenuItem>
  ));
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

/** A URL or a path in the thread's folder; a live agent is told in a message of yours. Anchored on `children`, opened from the header menu. */
function AddSource({
  thread,
  isOpen,
  onOpenChange,
  children,
}: {
  thread: Thread;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const { dispatch } = useHarness();
  const [text, setText] = useState('');
  const source = sourceFrom(text);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!source) return;
    dispatch({ type: 'source-add', threadId: thread.id, source });
    setText('');
    onOpenChange(false);
  };
  return (
    <Popover open={isOpen} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <span className="flex">{children}</span>
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

function Section({ label, action, empty, children }: { label: string; action?: ReactNode; empty?: string; children?: ReactNode }) {
  return (
    <section className="flex flex-col gap-0.5 pt-2">
      <div className="flex h-6 items-center px-2">
        <h3 className="flex-1 type-caption text-subtle-foreground">{label}</h3>
        {action}
      </div>
      {empty ? <p className="px-2 py-1 type-caption text-subtle-foreground">{empty}</p> : children}
    </section>
  );
}

/** `icon`: a reicon drawn muted, or an element that brings its own colour (a PR's state icon). */
function SummaryRow({ icon: Icon, label, onClick, children }: { icon: IconComponent | ReactElement; label: ReactNode; onClick?: () => void; children?: ReactNode }) {
  const content = (
    <>
      <ItemMedia>
        {isValidElement(Icon) ? Icon : <Icon className="size-4 text-muted-foreground" />}
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="w-full min-w-0 truncate font-normal">{label}</ItemTitle>
      </ItemContent>
      {!!children && <ItemActions>{children}</ItemActions>}
    </>
  );
  if (!onClick)
    return (
      <Item size="xs" className="gap-2.5 px-2 py-1">
        {content}
      </Item>
    );
  return (
    <Item asChild size="xs" className="gap-2.5 px-2 py-1 hover:bg-accent/60">
      <button type="button" onClick={onClick}>
        {content}
      </button>
    </Item>
  );
}

function LimitedList<T>({ items, children }: { items: T[]; children: (item: T) => ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const shown = isOpen ? items : items.slice(0, LIST_LIMIT);
  return (
    <>
      {shown.map(children)}
      {items.length > LIST_LIMIT && (
        <Button variant="ghost" size="xs" className="self-start text-subtle-foreground" onClick={() => setOpen((o) => !o)}>
          {isOpen ? 'Show less' : `Show ${items.length - LIST_LIMIT} more`}
        </Button>
      )}
    </>
  );
}

const CHIP_LIMIT = 12;
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
const permissionLabel = (mode: string) => mode.split(' · ').map((part) => PERMISSION_LABELS[part] ?? part).join(', ');
const MCP_STATUS_LABELS = { connected: '', pending: 'Connecting', 'needs-auth': 'Needs sign-in', failed: 'Failed', disabled: 'Disabled' } satisfies Record<McpServer['status'], string>;
const MCP_STATUS_CLASSES = { connected: '', pending: 'text-subtle-foreground', 'needs-auth': 'text-warning', failed: 'text-destructive', disabled: 'text-subtle-foreground' } satisfies Record<McpServer['status'], string>;

/** What the live agent reported at session start; a list the agent didn't report is left out rather than shown empty. */
function SessionDetails({ thread }: SectionProps) {
  const { agent, session, spaceId } = thread;
  if (!agent || !session) return null;
  const { provider } = session;
  const plugins = agent.plugins ?? [];
  const manage = (part: 'mcp' | 'skills') => (
    <TooltipIconButton label={part === 'mcp' ? 'Manage MCP servers' : 'Manage skills'} hint="Opens this profile's settings" className="size-6" onClick={() => openProfileConfig(spaceId, part, provider)}>
      <Setting className="size-3.5" />
    </TooltipIconButton>
  );
  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-2 py-1 type-meta">
        <SessionField label="Model" value={agent.model} />
        <SessionField label="Permissions" value={agent.permissionMode && permissionLabel(agent.permissionMode)} className={cn(isFullAccess(agent.permissionMode) && 'text-warning')} />
        <SessionField label={HARNESSES[provider].name} value={agent.version} />
        <SessionField label="Folder" value={agent.cwd} />
      </dl>

      {!!agent.mcpServers && (
        <Section label={`MCP servers · ${agent.mcpServers.length}`} action={manage('mcp')} empty={agent.mcpServers.length === 0 ? 'No MCP servers configured' : undefined}>
          <LimitedList items={agent.mcpServers}>
            {(server) => (
              <SummaryRow key={server.name} icon={Server} label={server.name}>
                <span className={cn('tabular type-caption', MCP_STATUS_CLASSES[server.status] || 'text-subtle-foreground')}>
                  {MCP_STATUS_LABELS[server.status] || (server.toolCount === undefined ? 'Connected' : `${server.toolCount} tools`)}
                </span>
              </SummaryRow>
            )}
          </LimitedList>
        </Section>
      )}

      {!!agent.plugins && (
        <Section label={`Plugins · ${plugins.length}`} empty={plugins.length === 0 ? 'No plugins installed' : undefined}>
          <LimitedList items={plugins}>
            {(plugin) => (
              <SummaryRow key={plugin.name} icon={PuzzlePiece} label={plugin.name}>
                {!!plugin.version && <span className="tabular type-caption text-subtle-foreground">{plugin.version}</span>}
              </SummaryRow>
            )}
          </LimitedList>
        </Section>
      )}

      {!!agent.skills && <ChipSection label="Skills available" items={agent.skills} empty="No skills found" action={manage('skills')} />}
      {!!agent.slashCommands && <ChipSection label="Slash commands" items={agent.slashCommands.map((c) => `/${c}`)} empty="No slash commands" />}
      {!!agent.tools && <ChipSection label="Tools available" items={agent.tools} empty="No tools reported" />}
    </>
  );
}

function SessionField({ label, value, className }: { label: string; value?: string; className?: string }) {
  if (!value) return null;
  return (
    <>
      <dt className="text-subtle-foreground">{label}</dt>
      <dd className={cn('min-w-0 text-right [overflow-wrap:anywhere]', className)}>{value}</dd>
    </>
  );
}

function ChipSection({ label, items, empty, action }: { label: string; items: string[]; empty: string; action?: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const shown = isOpen ? items : items.slice(0, CHIP_LIMIT);
  return (
    <Section label={`${label} · ${items.length}`} action={action} empty={items.length === 0 ? empty : undefined}>
      <ul className="flex flex-wrap gap-1 px-2 py-1">
        {shown.map((item) => (
          <li key={item} className="max-w-full">
            <Badge variant="outline" className="h-auto max-w-full font-normal whitespace-normal text-muted-foreground [overflow-wrap:anywhere]">
              {item}
            </Badge>
          </li>
        ))}
        {items.length > CHIP_LIMIT && (
          <li>
            <Button variant="ghost" size="xs" className="h-5 text-subtle-foreground" onClick={() => setOpen((o) => !o)}>
              {isOpen ? 'Show less' : `+${items.length - CHIP_LIMIT} more`}
            </Button>
          </li>
        )}
      </ul>
    </Section>
  );
}

const PROVIDER_NAMES = { claude: 'Claude', codex: 'Codex' } satisfies Record<Provider, string>;
const PLURAL = new Intl.PluralRules('en');

function ThreadUsageRows({ thread }: SectionProps) {
  return <UsageRows usage={threadUsage(thread)} />;
}

/** Plan limits live in the composer's context ring; this is only what the space's threads spent. */
function SpaceUsageRows({ thread }: SectionProps) {
  const { state } = useHarness();
  return <UsageRows usage={spaceUsage(state.threads, profileById(thread.spaceId))} />;
}

function UsageRows({ usage }: { usage: Usage }) {
  return (
    <>
      <SummaryRow icon={Coins} label="Tokens">
        <span className="tabular type-caption text-subtle-foreground">
          {TOKENS.format(usage.input)} in · {TOKENS.format(usage.output)} out
        </span>
      </SummaryRow>
      {usage.costUsd !== null && (
        <SummaryRow icon={DollarCircle} label="Cost">
          <span className="tabular type-caption text-subtle-foreground">{USD.format(usage.costUsd)}</span>
        </SummaryRow>
      )}
    </>
  );
}

function RateLimitWarning({ thread }: { thread: Thread }) {
  const provider = thread.providers[0];
  const { limits } = useAccountLimits(provider, thread.spaceId);
  const tight = limits?.windows.find((w) => toneFor(w.usedPct / 100) === 'destructive');
  const limit = limitStatus(thread);
  if (limit)
    return (
      <p role="status" className="flex items-start gap-2.5 px-2 py-1 type-caption text-warning">
        <Hourglass className="size-4 shrink-0" aria-hidden />
        {limit}
      </p>
    );
  if (thread.status !== 'running' || !tight) return null;

  const name = `${PROVIDER_NAMES[provider]} ${tight.label.toLowerCase()} limit`;
  const resets = tight.resetsAt ? `, resets in ${untilLabel(Date.parse(tight.resetsAt) - Date.now())}` : '';
  return (
    <p role="status" className="flex items-start gap-2.5 px-2 py-1 type-caption text-warning">
      <TriangleWarning className="size-4 shrink-0" aria-hidden />
      {tight.usedPct >= 100 ? `${name} reached; this agent stalls until it resets${resets}.` : `${name} at ${Math.round(tight.usedPct)}%${resets}.`}
    </p>
  );
}

function GoalSection({ thread }: { thread: Thread }) {
  const { state } = useHarness();
  const [isOpen, setOpen] = useState(false);
  const [isPinned, setPinned] = useState(false);
  const progress = goalProgress(thread, state.now);
  const latest = thread.revisions[thread.revisions.length - 1];
  const now = thread.steps.filter((s) => s.status === 'running' || s.status === 'blocked');
  const waiting = thread.steps.filter((s) => s.status === 'waiting');
  const next = thread.steps.filter((s) => s.status === 'ready').slice(0, 2);

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <section aria-label="Goal" className="relative isolate flex flex-col gap-3 rounded-lg px-2 py-2 hover:bg-accent/40">
          <div className="flex items-center gap-2">
            <h2 className="type-title">Goal</h2>
            <Badge variant="outline" title={latest.label}>
              v{latest.n}
            </Badge>
            <span className="flex-1" />
            {/* z-10 lifts it above the stretched open-timeline button. */}
            <Button variant="ghost" size="icon-xs" className="relative z-10" aria-label="Edit goal" onClick={() => openGoalEditor(thread.id)}>
              <Edit />
            </Button>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-xs" className="after:absolute after:inset-0 after:rounded-lg" aria-label={isOpen ? 'Close the full timeline' : 'Open the full timeline'}>
                <Maximize />
              </Button>
            </PopoverTrigger>
          </div>
          <p className="line-clamp-2 type-meta text-muted-foreground">{thread.goal}</p>
          {!!thread.criteria?.length && <CriteriaList thread={thread} />}
          <div className="flex items-end justify-between gap-2">
            <span className="tabular type-display">{Math.round(progress.pct * 100)}%</span>
            <span className="tabular pb-1 type-caption text-subtle-foreground">{progress.total ? progressLabel(progress) : GOAL_PHASE_LABELS[progress.phase]}</span>
          </div>
          <Sparkline thread={thread} now={state.now} />
          {now.map((s) => (
            <div key={s.id} className="flex flex-col gap-1.5">
              <StepLine step={s} />
              {s.status === 'running' && <Progress value={s.progress * 100} style={{ '--progress-color': lineColor(thread.line) } as CSSProperties} aria-label={`${s.title} progress`} />}
              {s.status === 'blocked' && <span className="type-caption text-warning">{s.note ?? 'Needs you'}</span>}
            </div>
          ))}
          {waiting.map((s) => (
            <div key={s.id} className="flex flex-col gap-0.5">
              <StepLine step={s} />
              <StepLinkLine thread={thread} step={s} />
            </div>
          ))}
          {next.map((s) => (
            <StepLine key={s.id} step={s} />
          ))}
        </section>
      </PopoverAnchor>
      <PopoverContent
        side="left"
        align="start"
        sideOffset={12}
        collisionPadding={16}
        onEscapeKeyDown={() => setPinned(false)}
        onInteractOutside={(e) => isPinned && e.preventDefault()}
        className="surface-float w-[min(780px,calc(100vw-420px))] max-h-[calc(100vh-32px)] gap-0 overflow-y-auto rounded-xl bg-float p-5 shadow-float"
      >
        <div className="mb-4 flex items-start gap-3">
          <p className="min-w-0 flex-1 type-body text-muted-foreground text-pretty">{thread.goal}</p>
          <Button variant="ghost" size="sm" onClick={() => setPinned((p) => !p)} aria-pressed={isPinned}>
            {isPinned ? <PinOff data-icon="inline-start" /> : <Pin data-icon="inline-start" />}
            {isPinned ? 'Unpin' : 'Keep open'}
          </Button>
        </div>
        <GoalTimeline thread={thread} />
      </PopoverContent>
    </Popover>
  );
}

function StepLine({ step }: { step: Step }) {
  return (
    <span className="flex min-w-0 items-center gap-2 type-meta">
      <span className="flex w-4 justify-center">
        <StepStatusIcon status={step.status} />
      </span>
      <span className="truncate">{step.title}</span>
    </span>
  );
}

function Sparkline({ thread, now }: { thread: Thread; now: number }) {
  const series = burnSeries(thread, now);
  const live = progressAt(thread, now, true);
  const span = Math.max(1, now - thread.startedAt);
  const max = Math.max(...series.map((p) => p.scope), live.scope, 1) * 1.1;
  const W = 268;
  const H = 36;
  const x = (t: number) => ((t - thread.startedAt) / span) * W;
  const y = (v: number) => H - (v / max) * H;
  const path = (key: 'scope' | 'done') => series.map((p, i) => (i === 0 ? `M${x(p.t)} ${y(p[key])}` : `H${x(p.t)} V${y(p[key])}`)).join(' ');
  const color = lineColor(thread.line);
  const endY = y(live.done + live.partial);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-9 w-full overflow-visible" preserveAspectRatio="none" role="img" aria-label="Scope and done over time">
      <path d={`${path('done')} H${W} V${endY} V${H} H0 Z`} fill={color} fillOpacity={0.14} />
      <path d={`${path('done')} H${W} V${endY}`} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <path d={`${path('scope')} H${W}`} fill="none" stroke="var(--muted-foreground)" strokeWidth={1.5} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function OutcomeDetails({ thread }: SectionProps) {
  const outcome = outcomeOf(thread);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-2 py-1 type-meta">
      <dt className="text-subtle-foreground">Time</dt>
      <dd className="tabular">{duration(outcome.minutes)} from start to settle</dd>
      <dt className="text-subtle-foreground">Steps</dt>
      <dd className="tabular">
        {outcome.done} done
        {outcome.dropped > 0 && `, ${outcome.dropped} dropped`}
        {outcome.open > 0 && `, ${outcome.open} left open`}
      </dd>
      <dt className="text-subtle-foreground">Goal</dt>
      <dd className="tabular">{outcome.revisions === 0 ? 'Unchanged since it was set' : `Revised to v${outcome.revisions + 1}`}</dd>
      <dt className="text-subtle-foreground">Cost</dt>
      <dd className="tabular">
        {outcome.usage.costUsd === null
          ? `${TOKENS.format(outcome.usage.input + outcome.usage.output)} tokens, no cost reported`
          : USD.format(outcome.usage.costUsd)}
      </dd>
      <dt className="text-subtle-foreground">PRs</dt>
      <dd className="tabular">
        {outcome.merged.length + outcome.unmerged.length === 0
          ? 'None'
          : [...outcome.merged.map((p) => `#${p.number} merged`), ...outcome.unmerged.map((p) => `#${p.number} ${p.state}`)].join(', ')}
      </dd>
    </dl>
  );
}
