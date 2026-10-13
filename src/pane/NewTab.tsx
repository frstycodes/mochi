import { FileIcon } from '@react-symbols/icons/utils';
import { BranchUp, Global } from 'reicon-react';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { ScrollArea } from '@/components/ui/scroll-area';
import { threadCwd } from '@/host/cwd';
import { PANE_TAB_KINDS, type Thread } from '../model';
import { useHarness } from '../store';
import { usePorts } from '../terminal/ports';
import { usePaneOpeners } from '../terminal/usePaneOpeners';
import { useRecentFiles } from './recentFiles';
import { PANE_TABS, type PaneTabProps } from './tabs';
import { ThreadPrHoverCard } from '../chat/RefHoverCard';

// A visual tab opens from its chat visual, never empty from here.
const OPENABLE = PANE_TAB_KINDS.filter((k) => k !== 'new' && k !== 'visual');

export function NewTab({ thread }: PaneTabProps) {
  const { dispatch } = useHarness();
  const cwd = threadCwd(thread);
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-6 p-4">
        <section className="flex flex-col gap-2">
          <h3 className="type-caption text-subtle-foreground">Open</h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
            {OPENABLE.map((kind) => {
              const { title, icon: Icon } = PANE_TABS[kind];
              return (
                <Item key={kind} asChild variant="muted" size="sm" className="rounded-xl">
                  <button type="button" onClick={() => dispatch({ type: 'pane-open-tab', threadId: thread.id, kind })}>
                    <ItemMedia>
                      <Icon className="size-4" />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle className="font-normal">{title}</ItemTitle>
                    </ItemContent>
                  </button>
                </Item>
              );
            })}
          </div>
        </section>
        {!!cwd && <DetectedPorts thread={thread} cwd={cwd} />}
        {!!cwd && <RecentFiles thread={thread} cwd={cwd} />}
        {thread.prs.length > 0 && (
          <section className="flex flex-col gap-1">
            <h3 className="type-caption text-subtle-foreground">Pull requests</h3>
            {thread.prs.map((pr) => (
              <ThreadPrHoverCard key={pr.number} thread={thread} pr={pr} side="left" align="start">
                <Item size="sm" tabIndex={0} className="px-2">
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
              </ThreadPrHoverCard>
            ))}
          </section>
        )}
      </div>
    </ScrollArea>
  );
}

/** Dev servers listening under the thread's folder; one click opens it in a Preview tab in place of this one. */
function DetectedPorts({ thread, cwd }: { thread: Thread; cwd: string }) {
  const { openPort } = usePaneOpeners(thread.id);
  const { ports } = usePorts(thread.id, cwd, openPort);
  if (!ports?.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="type-caption text-subtle-foreground">Running</h3>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2">
        {ports.map((p) => (
          <Item key={`${p.pid}:${p.port}`} asChild variant="muted" size="sm" className="rounded-xl">
            <button type="button" aria-label={`Preview localhost:${p.port}`} onClick={() => openPort(p.port)}>
              <ItemMedia>
                <Global className="size-4" />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="font-normal tabular-nums">localhost:{p.port}</ItemTitle>
                <ItemDescription className="truncate font-mono">{p.command}</ItemDescription>
              </ItemContent>
            </button>
          </Item>
        ))}
      </div>
    </section>
  );
}

/** Files the agent read or edited and files opened in a Files tab; opens one in a Files tab in place of this one. */
function RecentFiles({ thread, cwd }: { thread: Thread; cwd: string }) {
  const { dispatch } = useHarness();
  const files = useRecentFiles(thread, cwd);
  if (!files.length) return null;
  return (
    <section className="flex flex-col gap-1">
      <h3 className="type-caption text-subtle-foreground">Recent files</h3>
      {files.map(({ path }) => {
        const slash = path.lastIndexOf('/');
        return (
          <Item key={path} asChild size="sm" className="px-2 hover:bg-accent/60">
            <button type="button" onClick={() => dispatch({ type: 'pane-open-tab', threadId: thread.id, kind: 'files', file: { path } })}>
              <ItemMedia>
                <FileIcon fileName={path.slice(slash + 1)} autoAssign aria-hidden className="size-4" />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="w-full min-w-0 font-normal">
                  <span className="truncate">
                    <span className="text-subtle-foreground">{path.slice(0, slash + 1)}</span>
                    {path.slice(slash + 1)}
                  </span>
                </ItemTitle>
              </ItemContent>
            </button>
          </Item>
        );
      })}
    </section>
  );
}
