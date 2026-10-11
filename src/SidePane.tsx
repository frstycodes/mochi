import { Add, BranchUp, Check, Code, Document, Edit, Global, MessageAdd, X, type IconComponent } from 'reicon-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { BrowserView } from './Browser';
import type { Pane, PaneTab, PaneTabKind, Thread } from './model';
import { useHarness } from './store';
import { summarize } from './summary';

const TAB_ICONS = { browser: Global, changes: Edit, terminal: Code, new: Add } satisfies Record<PaneTabKind, IconComponent>;

export function SidePane({ thread, pane }: { thread: Thread; pane: Pane }) {
  const docked = pane.tabs.filter((t) => !t.isPopped);
  const active = docked.find((t) => t.id === pane.activeTab) ?? docked[0];

  return (
    <section aria-label="Side pane" className="flex h-full min-w-0 flex-col bg-sidebar">
      <TabStrip thread={thread} tabs={docked} activeId={active?.id} />
      <div className="min-h-0 flex-1">
        {!active && <PoppedOut thread={thread} pane={pane} />}
        {active?.kind === 'browser' && <BrowserView thread={thread} tab={active} isDriving={pane.driver === thread.providers[0] && thread.status === 'running'} />}
        {active?.kind === 'changes' && <ChangesView thread={thread} />}
        {active?.kind === 'terminal' && <TerminalView thread={thread} />}
        {active?.kind === 'new' && <NewTabView thread={thread} />}
      </div>
    </section>
  );
}

function TabStrip({ thread, tabs, activeId }: { thread: Thread; tabs: PaneTab[]; activeId?: string }) {
  const { dispatch } = useHarness();
  return (
    <div role="tablist" aria-label="Side pane tabs" className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto px-2">
      {tabs.map((tab) => {
        const Icon = TAB_ICONS[tab.kind];
        const isActive = tab.id === activeId;
        return (
          <div key={tab.id} className={cn('group/tab flex h-7 max-w-44 shrink-0 items-center rounded-lg', isActive ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:bg-accent/60')}>
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => dispatch({ type: 'pane-select-tab', threadId: thread.id, tabId: tab.id })}
              className="flex h-full min-w-0 cursor-default items-center gap-1.5 pr-1 pl-2.5 type-meta"
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate">{tab.title}</span>
            </button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Close ${tab.title}`}
              onClick={() => dispatch({ type: 'pane-close-tab', threadId: thread.id, tabId: tab.id })}
              className={cn('mr-1 opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100', isActive && 'opacity-100')}
            >
              <X />
            </Button>
          </div>
        );
      })}
      <Button variant="ghost" size="icon-sm" aria-label="New tab" onClick={() => dispatch({ type: 'pane-open-tab', threadId: thread.id, kind: 'new' })}>
        <Add />
      </Button>
    </div>
  );
}

function PoppedOut({ thread, pane }: { thread: Thread; pane: Pane }) {
  const { dispatch } = useHarness();
  const popped = pane.tabs.find((t) => t.isPopped);
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Global />
        </EmptyMedia>
        <EmptyTitle>{popped ? 'The preview is floating' : 'No tabs open'}</EmptyTitle>
        <EmptyDescription>{popped ? 'It follows this thread around. Put it back here any time.' : 'Open a preview, the changes or a terminal.'}</EmptyDescription>
      </EmptyHeader>
      {popped ? (
        <Button size="sm" onClick={() => dispatch({ type: 'pane-pop', threadId: thread.id, tabId: popped.id, isPopped: false })}>
          Put back in the pane
        </Button>
      ) : (
        <Button size="sm" onClick={() => dispatch({ type: 'pane-open-tab', threadId: thread.id, kind: 'new' })}>
          Open a tab
        </Button>
      )}
    </Empty>
  );
}

function ChangesView({ thread }: { thread: Thread }) {
  const { files, added, removed } = summarize(thread.activity);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        <Select defaultValue="branch">
          <SelectTrigger size="sm" aria-label="Compare">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="branch">Branch</SelectItem>
              <SelectItem value="turn">Last turn</SelectItem>
              <SelectItem value="uncommitted">Uncommitted</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        {!!thread.repo && (
          <Badge variant="secondary" className="min-w-0 font-mono">
            <span className="truncate">
              {thread.repo.branch} → origin/main
            </span>
          </Badge>
        )}
        <span className="flex-1" />
        <span className="tabular type-caption">
          <span className="text-success">+{added}</span> <span className="text-destructive">−{removed}</span>
        </span>
      </div>
      {files.length === 0 ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Document />
            </EmptyMedia>
            <EmptyTitle>No file changes yet</EmptyTitle>
            <EmptyDescription>Changes in this thread will appear here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-0.5 px-2 pb-2">
          {files.map((f) => (
            <Item key={f.path} asChild size="xs" className="gap-2.5 px-2 py-1.5 hover:bg-accent/60">
              <button type="button" onClick={() => toast('Diff view is not in the prototype yet')}>
                <ItemMedia>
                  <Document className="size-4 text-muted-foreground" />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="w-full truncate font-mono text-xs font-normal">{f.path}</ItemTitle>
                </ItemContent>
                <ItemActions className="tabular type-caption">
                  <span className="text-success">+{f.added}</span> <span className="text-destructive">−{f.removed}</span>
                </ItemActions>
              </button>
            </Item>
          ))}
        </div>
        </ScrollArea>
      )}
    </div>
  );
}

function TerminalView({ thread }: { thread: Thread }) {
  const runs = thread.activity.filter((a) => a.kind === 'tool' && a.text.startsWith('Run '));
  return (
    <div className="m-2 h-[calc(100%-1rem)] overflow-y-auto rounded-xl bg-card p-3 font-mono text-xs leading-relaxed ring-1 ring-border">
      {runs.length === 0 && <span className="text-subtle-foreground">No commands yet.</span>}
      {runs.map((r, i) => (
        <div key={i}>
          <span className="text-subtle-foreground">$ </span>
          {r.text.slice(4)}
          <div className="flex items-center gap-1 text-success">
            <Check className="size-3" />
            done
          </div>
        </div>
      ))}
    </div>
  );
}

const TOOLS = [
  { kind: 'browser', label: 'Preview', icon: Global, keys: ['Cmd', 'B'] },
  { kind: 'changes', label: 'Changes', icon: Edit, keys: ['Cmd', 'D'] },
  { kind: 'terminal', label: 'Terminal', icon: Code, keys: ['Ctrl', '`'] },
] satisfies { kind: PaneTabKind; label: string; icon: IconComponent; keys: string[] }[];

function NewTabView({ thread }: { thread: Thread }) {
  const { dispatch } = useHarness();
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-6 p-4">
      <section className="flex flex-col gap-2">
        <h3 className="type-caption text-subtle-foreground">Tools</h3>
        {TOOLS.map((t) => (
          <Item key={t.kind} asChild variant="muted" size="sm" className="rounded-xl">
            <button type="button" onClick={() => dispatch({ type: 'pane-open-tab', threadId: thread.id, kind: t.kind })}>
              <ItemMedia>
                <t.icon className="size-4" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle className="font-normal">{t.label}</ItemTitle>
              </ItemContent>
              <KbdGroup>
                {t.keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </KbdGroup>
            </button>
          </Item>
        ))}
        <Item asChild variant="muted" size="sm" className="rounded-xl">
          <button type="button" onClick={() => toast('Side chat is not in the prototype yet')}>
            <ItemMedia>
              <MessageAdd className="size-4" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle className="font-normal">Side chat</ItemTitle>
              <ItemDescription>Ask something without derailing this thread</ItemDescription>
            </ItemContent>
          </button>
        </Item>
      </section>
      {thread.prs.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="type-caption text-subtle-foreground">Recents</h3>
          {thread.prs.map((pr) => (
            <Item key={pr.number} size="sm" className="px-2">
              <ItemMedia>
                <BranchUp className="size-4 text-muted-foreground" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle className="font-normal">{pr.title}</ItemTitle>
                <ItemDescription>
                  #{pr.number} · {pr.state}
                </ItemDescription>
              </ItemContent>
            </Item>
          ))}
        </section>
      )}
    </div>
    </ScrollArea>
  );
}
