import { useIsMobile } from '@/hooks/use-mobile';
import { useReducer, useState, type ReactNode } from 'react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import {
  SidebarInset,
  SidebarProvider,
  SidebarMenu,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { AppSidebar, ThreadItem } from '../Sidebar';
import { Workspace } from '../layout/Workspace';
import { SwitcherPanel, SwitcherRow } from '../ThreadSwitcher';
import { SubThreadRow } from '../goals/SubThreadRow';
import { SettledRow } from '../settled/SettledView';
import { ThreadLink } from '../QueueView';
import { MentionItem } from '../chat/MentionMenu';
import { Command, CommandItem, CommandList } from '@/components/ui/command';
import { SnapshotCard } from '../stage/SnapshotCard';
import { useThreadSnapshots } from '../stage/snapshot';
import { CompareForks } from '../rewind/CompareForks';
import { ThreadName } from '../chat/ThreadMessage';
import { StoreScope, reducer, type Action, type State } from '../store';
import { initialState } from '../store/root';
import { initialPanes } from '../store/panes';
import { initialLayout } from '../store/layout';
import { MachinesProvider } from '../remote/useMachines';
import { CommandPalette } from '../palette/CommandPalette';
import { SubReportsBlock } from './sections/sub-reports';
import { ThreadProposalsBlock } from './sections/thread-proposals';

export function ThreadAgentPrototype() {
  const [state, dispatch] = useReducer(
    prototypeReducer,
    undefined,
    prototypeState,
  );
  return (
    <StoreScope state={state} dispatch={dispatch}>
      <MachinesProvider>
        <PrototypeSurfaces state={state} dispatch={dispatch} />
      </MachinesProvider>
    </StoreScope>
  );
}

function PrototypeSurfaces({
  state,
  dispatch,
}: {
  state: State;
  dispatch: (action: Action) => void;
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const isMobile = useIsMobile();
  const [now] = useState(Date.now);
  const [missingThread] = useState(() => ({
    ...state.threads[0],
    id: 'agent-missing',
    providers: [],
    title: 'Legacy thread without agent information',
  }));
  const [isCompareOpen, setCompareOpen] = useState(false);
  const [isSwitcherOpen, setSwitcherOpen] = useState(false);
  const [isSearchOpen, setSearchOpen] = useState(false);
  const threads = state.threads.filter((t) => t.spaceId === state.spaceId);
  const snapshots = useThreadSnapshots(threads.slice(0, 4).map((t) => t.id));
  const view = state.views[state.spaceId];
  const currentId = view.kind === 'thread' ? view.id : undefined;
  const pick = (id: string) => {
    dispatch({ type: 'go', view: { kind: 'thread', id } });
    setSwitcherOpen(false);
  };
  return (
    <main className="h-full overflow-auto bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-2 border-b p-3">
        <h1 className="mr-auto type-title">Agent icons · real components</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCompareOpen(true)}
        >
          Compare forks
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSwitcherOpen(true)}
        >
          Thread switcher
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => dispatch({ type: 'go', view: { kind: 'queue' } })}
        >
          Queue
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => dispatch({ type: 'go', view: { kind: 'settled' } })}
        >
          Settled
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
        >
          Switch theme
        </Button>
      </header>
      <SidebarProvider
        className="h-[720px] min-h-0"
        style={{ '--sidebar-width': '256px' } as React.CSSProperties}
      >
        {!isMobile && (
          <div className="h-full shrink-0">
            <AppSidebar
              collapsible="none"
              onSearch={() => setSearchOpen(true)}
            />
          </div>
        )}
        <SidebarInset className="isolate min-w-0 overflow-hidden">
          <Workspace />
        </SidebarInset>
        <CommandPalette open={isSearchOpen} onOpenChange={setSearchOpen} />
      </SidebarProvider>
      <div className="grid gap-8 border-t p-4 md:grid-cols-2">
        <Surface title="Sidebar rows · normal and nested">
          <SidebarProvider className="min-h-0">
            <SidebarMenu>
              {threads.slice(0, 5).map((thread, index) => (
                <SidebarMenuItem key={thread.id}>
                  <ThreadItem
                    thread={thread}
                    isSub={index === 1}
                    isActive={thread.id === currentId}
                    onSelect={() => pick(thread.id)}
                  />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarProvider>
        </Surface>
        <Surface title="Missing agent · display-only row fixture">
          <SidebarProvider className="min-h-0">
            <SidebarMenu>
              <SidebarMenuItem>
                <ThreadItem
                  thread={missingThread}
                  isActive={false}
                  onSelect={() => {}}
                />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarProvider>
          <SwitcherRow
            thread={missingThread}
            isPicked={false}
            isCurrent={false}
            onPick={() => {}}
          />
        </Surface>
        <Surface title="Switcher rows">
          {threads.slice(0, 5).map((thread) => (
            <SwitcherRow
              key={thread.id}
              thread={thread}
              isPicked={thread.id === currentId}
              isCurrent={thread.id === currentId}
              onPick={() => pick(thread.id)}
            />
          ))}
        </Surface>
        <Surface title="Subthreads · hover for the real preview">
          {threads.slice(0, 4).map((thread) => (
            <SubThreadRow key={thread.id} sub={thread} />
          ))}
        </Surface>
        <Surface title="Settled rows">
          {threads.slice(0, 4).map((thread) => (
            <SettledRow
              key={thread.id}
              thread={thread}
              now={now}
              isSelected={false}
              onSelect={() => {}}
            />
          ))}
        </Surface>
        <Surface title="Overview cards">
          {snapshots.map((snap) => (
            <SnapshotCard key={snap.id} snap={snap} />
          ))}
        </Surface>
        <Surface title="Composer thread mentions">
          <Command>
            <CommandList>
              {threads.slice(0, 4).map((thread) => (
                <CommandItem key={thread.id} onSelect={() => pick(thread.id)}>
                  <MentionItem item={{ kind: 'thread', thread }} />
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </Surface>
        <Surface title="Queue thread links">
          {threads.slice(0, 4).map((thread) => (
            <ThreadLink
              key={thread.id}
              thread={thread}
              onOpen={() => pick(thread.id)}
            />
          ))}
        </Surface>
        <Surface title="Message and started-proposal thread links">
          {threads.slice(0, 4).map((thread) => (
            <ThreadName
              key={thread.id}
              peer={{ threadId: thread.id, title: thread.title }}
            />
          ))}
        </Surface>
        <div className="min-w-0 md:col-span-2">
          <SubReportsBlock rl={threads[0]} />
        </div>
        <div className="min-w-0 md:col-span-2">
          <ThreadProposalsBlock />
        </div>
      </div>
      <p className="px-4 pb-6 type-caption text-muted-foreground">
        Existing components, isolated demo store. Includes Claude, Codex, long
        titles and missing agent data.
      </p>
      {isCompareOpen && (
        <CompareForks
          thread={threads[0]}
          otherId={threads[2].id}
          onClose={() => setCompareOpen(false)}
        />
      )}
      {isSwitcherOpen && (
        <SwitcherPanel
          threads={threads}
          pickedId={currentId ?? threads[0].id}
          currentId={currentId}
          onPick={pick}
        />
      )}
    </main>
  );
}

function Surface({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <h2 className="mb-3 type-title">{title}</h2>
      <div className="flex min-w-0 flex-col gap-1">{children}</div>
    </section>
  );
}

function prototypeReducer(state: State, action: Action) {
  return reducer(state, action);
}

function prototypeState(): State {
  const state = {
    ...initialState(null, true),
    ...initialPanes([]),
    ...initialLayout({ layouts: {}, watched: [] }),
    paused: true,
  };
  const base = state.threads[0];
  const fixtures = [
    {
      ...base,
      id: 'agent-long-title',
      providers: ['codex'] as const,
      title:
        'A very long thread title that should fade or truncate while the agent icon and existing status stay visible',
    },
  ];
  const threads = [
    ...fixtures.map((thread) => ({
      ...thread,
      providers: [...thread.providers],
      spaceId: state.spaceId,
    })),
    ...state.threads,
  ];
  return reducer(
    { ...state, threads },
    { type: 'go', view: { kind: 'thread', id: base.id } },
  );
}
