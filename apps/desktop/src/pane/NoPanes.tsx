import { FileIcon } from '@react-symbols/icons/utils';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { ScrollArea } from '@/components/ui/scroll-area';
import { threadCwd } from '@/host/cwd';
import type { Thread } from '../model';
import { useDispatch } from '../store';
import { usePorts } from '../terminal/ports';
import { usePaneOpeners } from '../terminal/usePaneOpeners';
import { PINNABLE_KINDS } from './headerPins';
import { PortIcon } from './PortIcon';
import { useRecentFiles } from './recentFiles';
import { PANE_TABS } from './tabs';
import { SectionLabel } from '../ui';

/** The panes are shown but every one is closed: what can open, running dev servers and recent files. */
export function NoPanes({ thread }: { thread: Thread }) {
  const dispatch = useDispatch();
  const cwd = threadCwd(thread);
  return (
    <ScrollArea type="scroll" className="h-full">
      <Empty className="justify-start gap-6 p-4">
        <EmptyHeader>
          <EmptyTitle>Every pane is closed</EmptyTitle>
          <EmptyDescription>
            Open one again, or preview what this thread is running.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="max-w-none flex-row flex-wrap justify-center gap-1.5">
          {PINNABLE_KINDS.map((kind) => {
            const { title, icon: Icon } = PANE_TABS[kind];
            return (
              <Button
                key={kind}
                variant="outline"
                size="sm"
                onClick={() =>
                  dispatch({
                    type: 'pane-show-tab',
                    threadId: thread.id,
                    kind,
                  })
                }
              >
                <Icon />
                {title}
              </Button>
            );
          })}
        </EmptyContent>
        {!!cwd && <DetectedPorts thread={thread} cwd={cwd} />}
        {!!cwd && <RecentFiles thread={thread} cwd={cwd} />}
      </Empty>
    </ScrollArea>
  );
}

/** Dev servers listening under the thread's folder; one click opens it in Preview. */
function DetectedPorts({ thread, cwd }: { thread: Thread; cwd: string }) {
  const { openPort } = usePaneOpeners(thread.id);
  const { ports } = usePorts(thread.id, cwd);
  if (!ports?.length) return null;
  return (
    <section className="flex flex-col gap-2 self-stretch text-left">
      <SectionLabel as="h2">Running</SectionLabel>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2">
        {ports.map((p) => (
          <Item
            key={`${p.pid}:${p.port}`}
            asChild
            variant="muted"
            size="sm"
            className="rounded-xl"
          >
            <button
              type="button"
              aria-label={`Preview localhost:${p.port}`}
              onClick={() => openPort(p.port)}
            >
              <ItemMedia>
                <PortIcon />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="font-normal tabular-nums">
                  localhost:{p.port}
                </ItemTitle>
                <ItemDescription className="truncate font-mono">
                  {p.command}
                </ItemDescription>
              </ItemContent>
            </button>
          </Item>
        ))}
      </div>
    </section>
  );
}

/** Files the agent read or edited and files opened in Files; opens one there. */
function RecentFiles({ thread, cwd }: { thread: Thread; cwd: string }) {
  const dispatch = useDispatch();
  const files = useRecentFiles(thread, cwd);
  if (!files.length) return null;
  return (
    <section className="flex flex-col gap-1 self-stretch text-left">
      <SectionLabel as="h2">Recent files</SectionLabel>
      {files.map(({ path }) => {
        const slash = path.lastIndexOf('/');
        return (
          <Item
            key={path}
            asChild
            size="sm"
            className="px-2 hover:bg-accent/60"
          >
            <button
              type="button"
              onClick={() =>
                dispatch({
                  type: 'pane-open-tab',
                  threadId: thread.id,
                  kind: 'files',
                  file: { path },
                })
              }
            >
              <ItemMedia>
                <FileIcon
                  fileName={path.slice(slash + 1)}
                  autoAssign
                  aria-hidden
                  className="size-4"
                />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="w-full min-w-0 font-normal">
                  <span className="truncate">
                    <span className="text-subtle-foreground">
                      {path.slice(0, slash + 1)}
                    </span>
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
