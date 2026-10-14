import { useEffect, useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { ArrowUpRight, Copy, DocumentCode, Global, Pip, Play, Plug, TerminalSquare, Trash3 } from 'reicon-react';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { ScrollArea } from '@/components/ui/scroll-area';
import { host } from '../host';
import { threadCwd } from '../host/cwd';
import type { ListeningPort, RunTarget } from '../host/types/ports';
import type { Pane, Thread } from '../model';
import { useHarness } from '../store';
import { nextTabId } from '../store/panes';
import { refreshPorts, usePorts } from '../terminal/ports';
import { addShell } from '../terminal/sessions';
import { portUrl, usePaneOpeners } from '../terminal/usePaneOpeners';
import { TooltipIconButton } from '../ui';
import { PlannedTab } from './PlannedTab';
import { PortIcon } from './PortIcon';
import { PaneList, PaneListItem, PaneListItemTrail, PaneSection, PaneSectionHeader, PaneSectionTitle } from './PaneList';
import type { PaneTabProps } from './tabs';

export function PortsTab({ thread, pane }: PaneTabProps) {
  const cwd = threadCwd(thread);
  if (!cwd) return <PlannedTab icon={Plug} title="No project folder" description="This chat has no folder, so it runs no dev servers." />;
  return <Ports thread={thread} pane={pane} cwd={cwd} />;
}

function Ports({ thread, pane, cwd }: { thread: Thread; pane: Pane; cwd: string }) {
  const { listening, targets, threadPort, run, openInPip, kill } = usePortsTab(thread, pane, cwd);
  const openers = usePaneOpeners(thread.id);
  const [killing, setKilling] = useState<ListeningPort | null>(null);

  return (
    <ScrollArea type="scroll" className="h-full">
      <div className="flex flex-col gap-5 p-3">
        <PaneSection>
          <PaneSectionHeader>
            <PaneSectionTitle count={listening.ports?.length}>Listening</PaneSectionTitle>
          </PaneSectionHeader>
          {listening.error && <p className="px-1 type-meta text-destructive">Could not read ports: {listening.error}</p>}
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
                        <span className="text-muted-foreground">localhost:</span>
                        <span className="font-semibold tabular-nums">{p.port}</span>
                      </span>
                    </ItemTitle>
                    <ItemDescription className="line-clamp-1 type-caption break-all" title={`${p.command} · pid ${p.pid}`}>
                      {p.command} · pid {p.pid}
                    </ItemDescription>
                  </ItemContent>
                  <PaneListItemTrail
                    meta={formatDistanceToNowStrict(p.startedAt)}
                    actions={
                      <>
                        <TooltipIconButton label="Open in pane" hint={`Shows localhost:${p.port} in Preview`} onClick={() => openers.openPort(p.port)}>
                          <Global />
                        </TooltipIconButton>
                        <TooltipIconButton label="Open in floating window" hint="Keeps it on top while you work" onClick={() => openInPip(p.port)}>
                          <Pip />
                        </TooltipIconButton>
                        <TooltipIconButton label="Open in browser" hint="Opens your system browser" onClick={() => window.open(portUrl(p.port), '_blank', 'noopener')}>
                          <ArrowUpRight />
                        </TooltipIconButton>
                        <TooltipIconButton label="Copy URL" onClick={() => void navigator.clipboard.writeText(portUrl(p.port)).then(() => toast('Copied URL'))}>
                          <Copy />
                        </TooltipIconButton>
                        <TooltipIconButton label="Stop process" hint={`Asks before stopping pid ${p.pid}`} onClick={() => setKilling(p)}>
                          <Trash3 />
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
              <Badge variant="secondary" className="h-4 rounded-sm px-1.5 font-mono type-caption font-normal text-muted-foreground tabular-nums">
                PORT={threadPort}
              </Badge>
            )}
          </PaneSectionHeader>
          {targets?.length === 0 && <p className="rounded-lg bg-muted/40 px-3 py-2.5 type-meta text-muted-foreground">No dev scripts in package.json or .claude/launch.json.</p>}
          {!!targets?.length && (
            <PaneList>
              {targets.map((t) => (
                <RunTargetItem key={`${t.source}:${t.name}`} target={t} onRun={() => run(t)} />
              ))}
            </PaneList>
          )}
        </PaneSection>
      </div>
      <AlertDialog open={!!killing} onOpenChange={(open) => !open && setKilling(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Stop localhost:{killing?.port}?</AlertDialogTitle>
            <AlertDialogDescription>
              Sends SIGTERM to pid {killing?.pid} (<span className="font-mono">{killing?.command}</span>). Anything it hasn't saved is lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep running</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => killing && kill(killing)}>
              Stop process
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ScrollArea>
  );
}

const SOURCE_ICONS = { 'package.json': TerminalSquare, 'launch.json': DocumentCode } satisfies Record<RunTarget['source'], unknown>;

function RunTargetItem({ target, onRun }: { target: RunTarget; onRun: () => void }) {
  const Icon = SOURCE_ICONS[target.source];
  return (
    <PaneListItem>
      <ItemMedia className="translate-y-0 self-center">
        <Icon aria-hidden className="size-4 text-muted-foreground" />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0">
        <ItemTitle className="w-full min-w-0 font-normal">
          <span className="truncate">{target.name}</span>
          <Badge variant="secondary" className="h-4 rounded-sm px-1.5 type-caption font-normal text-muted-foreground">
            {target.source}
          </Badge>
        </ItemTitle>
        <ItemDescription className="line-clamp-1 font-mono type-caption break-all" title={target.command}>
          {target.command}
        </ItemDescription>
      </ItemContent>
      <PaneListItemTrail
        meta={!!target.port && `:${target.port}`}
        actions={
          <TooltipIconButton label={`Run ${target.name}`} hint="Runs in this thread's terminal" onClick={onRun}>
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
        <EmptyDescription>Run a dev server below; it shows up here once it opens a port.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function usePortsTab(thread: Thread, pane: Pane, cwd: string) {
  const { dispatch } = useHarness();
  const openers = usePaneOpeners(thread.id);
  const listening = usePorts(thread.id, cwd, openers.openPort);
  const [targets, setTargets] = useState<RunTarget[]>();
  const [threadPort, setThreadPort] = useState<number>();
  useEffect(() => {
    void host.ports.targets(cwd).then(setTargets, () => setTargets([]));
    void host.ports.allocate(thread.id).then(setThreadPort);
  }, [cwd, thread.id]);

  return {
    listening,
    targets,
    threadPort,
    /** Runs in the thread's terminal tab, opening one if there is none. */
    run(target: RunTarget) {
      const terminal = pane.tabs.find((t) => t.kind === 'terminal' && !t.isPopped);
      const tabId = terminal?.id ?? nextTabId(pane.tabs);
      addShell(`${thread.id}/${tabId}`, { cwd, threadId: thread.id, links: openers }, { title: target.name, command: target.command });
      if (terminal) dispatch({ type: 'pane-select-tab', threadId: thread.id, tabId });
      else dispatch({ type: 'pane-open-tab', threadId: thread.id, kind: 'terminal' });
    },
    openInPip(port: number) {
      const tabId = nextTabId(pane.tabs);
      openers.openPort(port);
      dispatch({ type: 'pane-pop', threadId: thread.id, tabId, isPopped: true });
    },
    async kill(target: ListeningPort) {
      try {
        await host.ports.kill(target.pid);
        toast(`Stopped localhost:${target.port}`);
      } catch (error) {
        toast.error(`Could not stop pid ${target.pid}`, { description: (error as Error).message });
      }
      refreshPorts(thread.id, cwd);
    },
  };
}
