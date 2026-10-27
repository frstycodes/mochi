import { useQuery } from '@tanstack/react-query';
import { useConfirm } from '../git/useConfirm';
import { formatDistanceToNowStrict } from 'date-fns';
import {
  ArrowUpRight,
  Copy,
  FileCode,
  Globe,
  Pip,
  Play,
  Plug,
  Terminal,
  Trash,
} from '@/icons';
import { toast } from '@/toast/store';
import { Badge } from '@/components/ui/badge';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { ScrollArea } from '@/components/ui/scroll-area';
import { host } from '../host';
import { threadCwd } from '../host/cwd';
import type { ListeningPort, RunTarget } from '@mochi/domain/host/types/ports';
import type { Pane, Thread } from '../model';
import { useDispatch } from '../store';
import { nextTabId } from '../store/panes';
import { portUrl } from '@mochi/domain/terminal/devServer';
import { refreshPorts, usePorts } from '../terminal/ports';
import { runTarget } from '../terminal/runTarget';
import { usePaneOpeners } from '../terminal/usePaneOpeners';
import { TooltipIconButton } from '../ui';
import { PlannedTab } from './PlannedTab';
import { PortIcon } from './PortIcon';
import {
  PaneList,
  PaneListItem,
  PaneListItemTrail,
  PaneSection,
  PaneSectionHeader,
  PaneSectionTitle,
} from './PaneList';
import type { PaneTabProps } from './tabs';
import { queryKeys } from '../queryKeys';

export function PortsTab({ thread, pane }: PaneTabProps) {
  const cwd = threadCwd(thread);
  if (!cwd)
    return (
      <PlannedTab
        icon={Plug}
        title="No project folder"
        description="This chat has no folder, so it runs no dev servers."
      />
    );
  return <Ports thread={thread} pane={pane} cwd={cwd} />;
}

function Ports({
  thread,
  pane,
  cwd,
}: {
  thread: Thread;
  pane: Pane;
  cwd: string;
}) {
  const { listening, targets, threadPort, run, openInPip, kill } = usePortsTab(
    thread,
    pane,
    cwd,
  );
  const openers = usePaneOpeners(thread.id);
  const { confirm, dialog } = useConfirm();

  return (
    <ScrollArea type="scroll" className="h-full">
      <div className="flex flex-col gap-5 p-3">
        <PaneSection>
          <PaneSectionHeader>
            <PaneSectionTitle count={listening.ports?.length}>
              Listening
            </PaneSectionTitle>
          </PaneSectionHeader>
          {listening.error && (
            <p className="px-1 type-meta text-destructive">
              Could not read ports: {listening.error}
            </p>
          )}
          {listening.ports?.length === 0 && <NoPorts />}
          {!!listening.ports?.length && (
            <PaneList>
              {listening.ports.map((p) => (
                <PaneListItem key={`${p.pid}:${p.port}`}>
                  <ItemMedia className="translate-y-0 self-center">
                    <PortIcon />
                  </ItemMedia>
                  <ItemContent className="min-w-0 gap-0">
                    <ItemTitle className="w-full min-w-0 font-normal">
                      <span className="truncate">
                        <span className="text-muted-foreground">
                          localhost:
                        </span>
                        <span className="font-semibold tabular-nums">
                          {p.port}
                        </span>
                      </span>
                    </ItemTitle>
                    <ItemDescription
                      className="line-clamp-1 type-caption break-all"
                      title={`${p.command} · pid ${p.pid}`}
                    >
                      {p.command} · pid {p.pid}
                    </ItemDescription>
                  </ItemContent>
                  <PaneListItemTrail
                    meta={formatDistanceToNowStrict(p.startedAt)}
                    actions={
                      <>
                        <TooltipIconButton
                          label="Open in pane"
                          hint={`Shows localhost:${p.port} in Preview`}
                          onClick={() => openers.openPort(p.port)}
                        >
                          <Globe />
                        </TooltipIconButton>
                        <TooltipIconButton
                          label="Open in floating window"
                          hint="Keeps it on top while you work"
                          onClick={() => openInPip(p.port)}
                        >
                          <Pip />
                        </TooltipIconButton>
                        <TooltipIconButton
                          label="Open in browser"
                          hint="Opens your system browser"
                          onClick={() =>
                            window.open(portUrl(p.port), '_blank', 'noopener')
                          }
                        >
                          <ArrowUpRight />
                        </TooltipIconButton>
                        <TooltipIconButton
                          label="Copy URL"
                          onClick={() =>
                            void navigator.clipboard
                              .writeText(portUrl(p.port))
                              .then(() => toast('Copied URL'))
                          }
                        >
                          <Copy />
                        </TooltipIconButton>
                        <TooltipIconButton
                          label="Stop process"
                          hint={`Asks before stopping pid ${p.pid}`}
                          onClick={async () => {
                            const isConfirmed = await confirm({
                              title: `Stop localhost:${p.port}?`,
                              description: (
                                <>
                                  Sends SIGTERM to pid {p.pid} (
                                  <span className="font-mono">{p.command}</span>
                                  ). Anything it hasn't saved is lost.
                                </>
                              ),
                              confirm: 'Stop process',
                              cancel: 'Keep running',
                              isDestructive: true,
                            });
                            if (isConfirmed) void kill(p);
                          }}
                        >
                          <Trash />
                        </TooltipIconButton>
                      </>
                    }
                  />
                </PaneListItem>
              ))}
            </PaneList>
          )}
        </PaneSection>
        <PaneSection>
          <PaneSectionHeader>
            <PaneSectionTitle count={targets?.length}>Run</PaneSectionTitle>
            {!!threadPort && (
              <Badge tone="muted" className="font-mono tabular-nums">
                PORT={threadPort}
              </Badge>
            )}
          </PaneSectionHeader>
          {targets?.length === 0 && (
            <p className="rounded-lg bg-muted/40 px-3 py-2.5 type-meta text-muted-foreground">
              No dev scripts in package.json or .claude/launch.json.
            </p>
          )}
          {!!targets?.length && (
            <PaneList>
              {targets.map((t) => (
                <RunTargetItem
                  key={`${t.source}:${t.name}`}
                  target={t}
                  onRun={() => run(t)}
                />
              ))}
            </PaneList>
          )}
        </PaneSection>
      </div>
      {dialog}
    </ScrollArea>
  );
}

const SOURCE_ICONS = {
  'package.json': Terminal,
  'launch.json': FileCode,
} satisfies Record<RunTarget['source'], unknown>;

function RunTargetItem({
  target,
  onRun,
}: {
  target: RunTarget;
  onRun: () => void;
}) {
  const Icon = SOURCE_ICONS[target.source];
  return (
    <PaneListItem>
      <ItemMedia className="translate-y-0 self-center">
        <Icon aria-hidden className="size-4 text-muted-foreground" />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0">
        <ItemTitle className="w-full min-w-0 font-normal">
          <span className="truncate">{target.name}</span>
          <Badge tone="muted">{target.source}</Badge>
        </ItemTitle>
        <ItemDescription
          className="line-clamp-1 font-mono type-caption break-all"
          title={target.command}
        >
          {target.command}
        </ItemDescription>
      </ItemContent>
      <PaneListItemTrail
        meta={!!target.port && `:${target.port}`}
        actions={
          <TooltipIconButton
            label={`Run ${target.name}`}
            hint="Runs in this thread's terminal"
            onClick={onRun}
          >
            <Play />
          </TooltipIconButton>
        }
      />
    </PaneListItem>
  );
}

function NoPorts() {
  return (
    <Empty className="rounded-lg bg-muted/40 p-5">
      <EmptyHeader>
        <EmptyTitle>Nothing listening</EmptyTitle>
        <EmptyDescription>
          Run a dev server below; it shows up here once it opens a port.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function usePortsTab(thread: Thread, pane: Pane, cwd: string) {
  const dispatch = useDispatch();
  const openers = usePaneOpeners(thread.id);
  const listening = usePorts(thread.id, cwd);
  const targetsQuery = useQuery({
    queryKey: queryKeys.ports.launchTargets(cwd),
    queryFn: () => host.ports.targets(cwd),
  });
  const portQuery = useQuery({
    queryKey: queryKeys.ports.threadPort(thread.id),
    queryFn: () => host.ports.allocate(thread.id),
    staleTime: Infinity,
  });
  const targets = targetsQuery.data ?? (targetsQuery.isError ? [] : undefined);
  const threadPort = portQuery.data;

  return {
    listening,
    targets,
    threadPort,
    run: (target: RunTarget) =>
      runTarget(target, { threadId: thread.id, cwd, pane, dispatch }),
    openInPip(port: number) {
      const tabId = nextTabId(pane.tabs);
      openers.openPort(port);
      dispatch({
        type: 'pane-pop',
        threadId: thread.id,
        tabId,
        isPopped: true,
      });
    },
    async kill(target: ListeningPort) {
      try {
        await host.ports.kill(target.pid);
      } catch (error) {
        toast.error(`Could not stop pid ${target.pid}`, {
          description: (error as Error).message,
        });
      }
      refreshPorts();
    },
  };
}
