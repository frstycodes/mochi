import { useEffect, useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { ArrowUpRight, Copy, Global, Pip, Play, Plug, Trash } from 'reicon-react';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { ScrollArea } from '@/components/ui/scroll-area';
import { host } from '../host';
import { threadCwd } from '../host/cwd';
import type { ListeningPort, RunTarget } from '../host/types/ports';
import type { Pane, Thread } from '../model';
import { useHarness } from '../store';
import { nextTabId } from '../store/panes';
import { IconAction } from '../terminal/IconAction';
import { refreshPorts, usePorts } from '../terminal/ports';
import { addShell } from '../terminal/sessions';
import { portUrl, usePaneOpeners } from '../terminal/usePaneOpeners';
import { PlannedTab } from './PlannedTab';
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
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-6 p-4">
        <section className="flex flex-col gap-1">
          <h3 className="type-caption text-subtle-foreground">Listening</h3>
          {listening.error && <p className="type-meta text-destructive">Could not read ports: {listening.error}</p>}
          {listening.ports?.length === 0 && <NoPorts />}
          {listening.ports?.map((p) => (
            <Item key={`${p.pid}:${p.port}`} size="sm" className="px-2">
              <ItemContent className="min-w-0">
                <ItemTitle className="font-mono font-normal">localhost:{p.port}</ItemTitle>
                <ItemDescription className="truncate">
                  <span className="font-mono">{p.command}</span> · pid {p.pid} · up {formatDistanceToNowStrict(p.startedAt)}
                </ItemDescription>
              </ItemContent>
              <ItemActions className="gap-0.5">
                <IconAction aria-label="Open in pane" onClick={() => openers.openPort(p.port)}>
                  <Global />
                </IconAction>
                <IconAction aria-label="Open in floating window" onClick={() => openInPip(p.port)}>
                  <Pip />
                </IconAction>
                <IconAction aria-label="Open in system browser" onClick={() => window.open(portUrl(p.port), '_blank', 'noopener')}>
                  <ArrowUpRight />
                </IconAction>
                <IconAction aria-label="Copy URL" onClick={() => void navigator.clipboard.writeText(portUrl(p.port)).then(() => toast('Copied URL'))}>
                  <Copy />
                </IconAction>
                <IconAction aria-label={`Stop process ${p.pid}`} onClick={() => setKilling(p)}>
                  <Trash />
                </IconAction>
              </ItemActions>
            </Item>
          ))}
        </section>
        <section className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="type-caption text-subtle-foreground">Run</h3>
            {!!threadPort && <span className="font-mono type-caption text-subtle-foreground tabular-nums">PORT={threadPort}</span>}
          </div>
          {targets?.length === 0 && <p className="px-2 type-meta text-muted-foreground">No dev scripts in package.json or .claude/launch.json.</p>}
          {targets?.map((t) => (
            <Item key={`${t.source}:${t.name}`} size="sm" className="px-2">
              <ItemContent className="min-w-0">
                <ItemTitle className="font-normal">
                  {t.name}
                  <Badge variant="secondary">{t.source}</Badge>
                </ItemTitle>
                <ItemDescription className="truncate font-mono">{t.command}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button variant="secondary" size="sm" onClick={() => run(t)}>
                  <Play aria-hidden />
                  Run
                </Button>
              </ItemActions>
            </Item>
          ))}
        </section>
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

function NoPorts() {
  return (
    <Empty className="p-6">
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
