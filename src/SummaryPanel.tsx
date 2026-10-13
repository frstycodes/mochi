import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Add, BranchDown, BranchUp, Code, Coins, Document, DollarCircle, Edit, Global, GlobalSearch, Link, Maximize, Note, Pin, PinOff, PuzzlePiece, Server, Setting, TriangleWarning, type IconComponent } from 'reicon-react';
import { Context, ContextContent, ContextContentBody, ContextContentHeader, ContextInputUsage, ContextOutputUsage, ContextTrigger } from '@/components/ai-elements/context';
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
import { host } from '@/host';
import { threadCwd } from '@/host/cwd';
import { cn } from '@/lib/utils';
import { copyText } from './clipboard';
import { EDITOR_NAMES, openInEditor, useInstalledEditors } from './files/editors';
import { openFiles } from './files/viewer';
import { withLivePr } from './git/prs';
import { usePr } from './git/useGit';
import type { AgentInfo, McpServer, Provider, PullRequest, Source, Step, Thread } from './model';
import { useProfiles } from './profiles';
import { isFolderSource, sourceFrom, sourceUrl } from './sources';
import type { Action } from './store';
import { HARNESSES } from './settings/harnesses';
import { openProfileConfig } from './settings/open';
import { profileById } from './profiles';
import { GoalTimeline, StepLinkLine, etaLabel } from './GoalTimeline';
import { GoalEditor } from './goals/GoalEditor';
import { outcomeOf } from './goals/outcome';
import { burnSeries, clock, duration, minutesLeft, progressAt } from './progress';
import { useHarness } from './store';
import { hasGoal } from './drift';
import { summarize, type CountedVerb, type ThreadSummary } from './summary';
import { lineColor, OverflowIcon, ProviderMark, StepStatusIcon, TooltipIconButton } from './ui';
import { isKnownPlan, planUsage, spaceUsage, threadUsage, type PlanUsage } from './usage/model';

const LIST_LIMIT = 3;

const TOOL_ICONS = { Read: Document, Edit: Edit, Write: Edit, Run: Code, Browser: Global, Search: GlobalSearch, Fetch: Global } satisfies Record<CountedVerb, IconComponent>;
const TOOL_LABELS = { Read: 'Read files', Edit: 'Edited files', Write: 'Wrote files', Run: 'Ran commands', Browser: 'Used the browser', Search: 'Searched the web', Fetch: 'Read web pages' } satisfies Record<CountedVerb, string>;
const SOURCE_ICONS = { link: Link, mcp: Setting, file: Document } satisfies Record<Source['kind'], IconComponent>;

/** `onPaneOpened`: a row opened something in the side pane, so a summary covering it (the narrow sheet) can step aside. */
export function SummaryPanel({ thread, className, onPaneOpened }: { thread: Thread; className?: string; onPaneOpened?: () => void }) {
  const summary = summarize(thread.activity);
  const open = useSummaryOpeners(thread, onPaneOpened);

  return (
    <aside aria-label="Thread summary" className={cn('flex min-h-0 flex-col', className)}>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 px-2 pt-2 pb-3">
          <PanelHeader thread={thread} />
          {thread.status === 'settled' && <OutcomeSection thread={thread} />}
          <GoalSection thread={thread} />
          <Separator className="mx-2 my-2 w-auto!" />
          <RateLimitWarning thread={thread} />
          <SummaryRow icon={Edit} label="Changes" onClick={thread.repo ? open.changes : undefined}>
            <span className="tabular type-caption">
              <span className="text-success">+{summary.added}</span> <span className="text-destructive">−{summary.removed}</span>
            </span>
          </SummaryRow>
          <ContextRow thread={thread} />

          <PullRequestsSection thread={thread} onOpen={open.url} />

          <Section label="Sources" action={<AddSource thread={thread} />} empty={thread.sources.length === 0 ? 'No sources yet' : undefined}>
            <LimitedList items={thread.sources}>
              {(source) => <SummaryRow key={source.label} icon={SOURCE_ICONS[source.kind]} label={source.label} onClick={open.source(source) ?? undefined} />}
            </LimitedList>
          </Section>

          <Section label="Skills used" empty={summary.skills.length === 0 ? 'No skills used yet' : undefined}>
            <LimitedList items={summary.skills}>
              {(skill) => (
                <SummaryRow key={skill.name} icon={Note} label={skill.name} onClick={() => openProfileConfig(thread.spaceId, 'skills', thread.session?.provider ?? thread.providers[0])}>
                  <span className="tabular type-caption text-subtle-foreground">
                    ×{skill.uses} · {clock(skill.lastAt)}
                  </span>
                </SummaryRow>
              )}
            </LimitedList>
          </Section>

          <Section label={`Tools called · ${summary.toolTotal}`} empty={summary.toolTotal === 0 ? 'No tool calls yet' : undefined}>
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
          </Section>

          {!!thread.agent && !!thread.session && <AgentSections agent={thread.agent} provider={thread.session.provider} spaceId={thread.spaceId} />}

          <ThreadUsageSection thread={thread} />
          <SpaceUsageSection thread={thread} />
        </div>
      </ScrollArea>
    </aside>
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label="Summary options">
            <OverflowIcon vertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            {repo && <DropdownMenuItem onSelect={() => navigator.clipboard?.writeText(repo.branch).catch(() => undefined)}>Copy branch name</DropdownMenuItem>}
            <OpenInEditorItems thread={thread} />
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
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

/** A live thread on the desktop also lists its branch's PR from `gh`; the web build's mock would give every thread the same one. */
function PullRequestsSection({ thread, onOpen }: { thread: Thread; onOpen: (url: string) => void }) {
  const cwd = host.isDesktop && thread.live ? threadCwd(thread) : null;
  if (cwd) return <LivePullRequests thread={thread} cwd={cwd} onOpen={onOpen} />;
  return <PullRequestList prs={thread.prs} onOpen={onOpen} />;
}

function LivePullRequests({ thread, cwd, onOpen }: { thread: Thread; cwd: string; onOpen: (url: string) => void }) {
  const githubUser = useProfiles().find((p) => p.id === thread.spaceId)?.github || undefined;
  const prQuery = usePr(cwd, githubUser);
  return <PullRequestList prs={withLivePr(thread.prs, prQuery.data)} onOpen={onOpen} />;
}

function PullRequestList({ prs, onOpen }: { prs: PullRequest[]; onOpen: (url: string) => void }) {
  return (
    <Section label="Pull requests" empty={prs.length === 0 ? 'No PRs linked yet' : undefined}>
      {prs.map((pr) => (
        <PullRequestRow key={pr.number} pr={pr} onOpen={onOpen} />
      ))}
    </Section>
  );
}

function PullRequestRow({ pr, onOpen }: { pr: PullRequest; onOpen: (url: string) => void }) {
  const { url } = pr;
  const row = (
    <SummaryRow icon={pr.state === 'merged' ? BranchDown : BranchUp} label={pr.title} onClick={url ? () => onOpen(url) : undefined}>
      <span className="tabular type-caption text-subtle-foreground">#{pr.number}</span>
    </SummaryRow>
  );
  if (!url) return row;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
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
function AddSource({ thread }: { thread: Thread }) {
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
      <PopoverTrigger asChild>
        <TooltipIconButton label="Add a source" hint={thread.live ? 'A link or file the agent should use; it gets a message' : 'A link or file this thread draws on'} className="size-6">
          <Add className="size-3.5" />
        </TooltipIconButton>
      </PopoverTrigger>
      <PopoverContent align="end" side="left" className="w-72">
        <form onSubmit={submit} className="flex flex-col gap-2">
          <label htmlFor={`add-source-${thread.id}`} className="type-meta font-medium">
            Add a source
          </label>
          <Input id={`add-source-${thread.id}`} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={thread.repo ? 'https://… or docs/api.md' : 'https://…'} />
          <p className="type-caption text-subtle-foreground">{source ? (source.kind === 'link' ? 'Adds a link' : "Adds a file from this thread's folder") : 'Paste a URL or type a file path'}</p>
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

function SummaryRow({ icon: Icon, label, onClick, children }: { icon: IconComponent; label: ReactNode; onClick?: () => void; children?: ReactNode }) {
  const content = (
    <>
      <ItemMedia>
        <Icon className="size-4 text-muted-foreground" />
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
          {isOpen ? 'Show less' : `View all ${items.length}`}
        </Button>
      )}
    </>
  );
}

function ContextRow({ thread }: { thread: Thread }) {
  const { used, max } = thread.context;
  return (
    <Context usedTokens={used} maxTokens={max} openDelay={200}>
      <ContextTrigger>
        <Item asChild size="xs" className="gap-2.5 px-2 py-1 hover:bg-accent/60">
          <button type="button">
            <ItemMedia>
              <Global className="size-4 text-muted-foreground" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle className="font-normal">Context</ItemTitle>
            </ItemContent>
            <ItemActions className="tabular type-caption text-subtle-foreground">{max ? `${Math.round((used / max) * 100)}%` : TOKENS.format(used)}</ItemActions>
          </button>
        </Item>
      </ContextTrigger>
      <ContextContent align="end" side="left">
        <ContextContentHeader />
        <ContextContentBody>
          <ContextInputUsage />
          <ContextOutputUsage />
        </ContextContentBody>
      </ContextContent>
    </Context>
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
function AgentSections({ agent, provider, spaceId }: { agent: AgentInfo; provider: Provider; spaceId: string }) {
  const plugins = agent.plugins ?? [];
  const manage = (part: 'mcp' | 'skills') => (
    <TooltipIconButton label={part === 'mcp' ? 'Manage MCP servers' : 'Manage skills'} hint="Opens this profile's settings" className="size-6" onClick={() => openProfileConfig(spaceId, part, provider)}>
      <Setting className="size-3.5" />
    </TooltipIconButton>
  );
  return (
    <>
      <Section label="Session">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-2 py-1 type-meta">
          <SessionField label="Model" value={agent.model} />
          <SessionField label="Permissions" value={agent.permissionMode && permissionLabel(agent.permissionMode)} className={cn(isFullAccess(agent.permissionMode) && 'text-warning')} />
          <SessionField label={HARNESSES[provider].name} value={agent.version} />
          <SessionField label="Folder" value={agent.cwd} />
        </dl>
      </Section>

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

const TOKENS = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const USD = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' });
const PROVIDER_NAMES = { claude: 'Claude', codex: 'Codex' } satisfies Record<PlanUsage['provider'], string>;

function ThreadUsageSection({ thread }: { thread: Thread }) {
  const usage = threadUsage(thread);
  return (
    <Section label="Thread usage">
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
    </Section>
  );
}

function RateLimitWarning({ thread }: { thread: Thread }) {
  const { state } = useHarness();
  const space = profileById(thread.spaceId);
  const provider = thread.providers[0];
  const plan = planUsage(state.threads.filter((t) => t.spaceId === space.id), provider, space.plans[provider], state.now);
  if (thread.status !== 'running' || !isKnownPlan(space.plans[provider]) || !plan.isWarning) return null;

  const name = `${PROVIDER_NAMES[plan.provider]} ${plan.plan}`;
  return (
    <p role="status" className="flex items-start gap-2.5 px-2 py-1 type-caption text-warning">
      <TriangleWarning className="size-4 shrink-0" aria-hidden />
      {plan.remaining === 0 ? `${name} limit reached; this agent stalls until the window resets.` : `${name} limit in about ${duration(Math.max(1, Math.round(plan.minutesLeft ?? 0)))} at this pace.`}
    </p>
  );
}

function SpaceUsageSection({ thread }: { thread: Thread }) {
  const { state } = useHarness();
  const space = profileById(thread.spaceId);
  const usage = spaceUsage(state.threads, space, state.now);
  return (
    <Section label={`${space.name} usage`} action={<span className="tabular type-caption text-subtle-foreground">{usage.costUsd === null ? `${TOKENS.format(usage.input + usage.output)} tokens` : USD.format(usage.costUsd)}</span>}>
      {usage.plans.map((p) => (
        <PlanRow key={p.provider} plan={p} />
      ))}
    </Section>
  );
}

function PlanRow({ plan }: { plan: PlanUsage }) {
  const share = Math.min(1, plan.used / plan.limit);
  return (
    <div className="flex flex-col gap-1.5 px-2 py-1">
      <div className="flex items-center gap-2.5 type-body">
        <ProviderMark provider={plan.provider} size={16} />
        <span className="min-w-0 flex-1 truncate">
          {PROVIDER_NAMES[plan.provider]} <span className="text-subtle-foreground">· {plan.plan}</span>
        </span>
        <span className={cn('tabular type-caption', plan.isWarning ? 'text-warning' : 'text-subtle-foreground')}>{TOKENS.format(plan.remaining)} left</span>
      </div>
      <Progress value={share * 100} style={{ '--progress-color': plan.isWarning ? 'var(--warning)' : 'var(--muted-foreground)' } as CSSProperties} aria-label={`${PROVIDER_NAMES[plan.provider]} ${plan.plan} plan used`} />
    </div>
  );
}

function GoalSection({ thread }: { thread: Thread }) {
  const { state } = useHarness();
  const [isOpen, setOpen] = useState(false);
  const [isPinned, setPinned] = useState(false);
  const [isEditing, setEditing] = useState(false);
  const live = progressAt(thread, state.now, true);
  const eta = minutesLeft(thread, state.now);
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
            <Button variant="ghost" size="icon-xs" className="relative z-10" aria-label="Edit goal" onClick={() => setEditing(true)}>
              <Edit />
            </Button>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-xs" className="after:absolute after:inset-0 after:rounded-lg" aria-label={isOpen ? 'Close the full timeline' : 'Open the full timeline'}>
                <Maximize />
              </Button>
            </PopoverTrigger>
          </div>
          {hasGoal(thread) ? <p className="line-clamp-2 type-meta text-muted-foreground">{thread.goal}</p> : <p className="type-meta text-subtle-foreground">No goal yet. Your first real request sets it.</p>}
          <div className="flex items-end justify-between gap-2">
            <span className="tabular type-display">{Math.round(live.pct * 100)}%</span>
            <span className="tabular pb-1 type-caption text-subtle-foreground">
              {Math.round(live.done + live.partial)} of {live.scope} pts · {etaLabel(eta).toLowerCase()}
            </span>
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
      {isEditing && <GoalEditor thread={thread} onClose={() => setEditing(false)} />}
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

function OutcomeSection({ thread }: { thread: Thread }) {
  const outcome = outcomeOf(thread);
  return (
    <section aria-label="Outcome" className="flex flex-col gap-1.5 rounded-lg px-2 py-2">
      <h2 className="type-title">Outcome</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 type-meta">
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
        <dd className="tabular">{outcome.usage.costUsd === null ? `${TOKENS.format(outcome.usage.input + outcome.usage.output)} tokens, no cost reported` : USD.format(outcome.usage.costUsd)}</dd>
        <dt className="text-subtle-foreground">PRs</dt>
        <dd className="tabular">
          {outcome.merged.length + outcome.unmerged.length === 0
            ? 'None'
            : [...outcome.merged.map((p) => `#${p.number} merged`), ...outcome.unmerged.map((p) => `#${p.number} ${p.state}`)].join(', ')}
        </dd>
      </dl>
    </section>
  );
}
