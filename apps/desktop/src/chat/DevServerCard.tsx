import { ArrowUpRight, Copy, Globe, Play, Stop } from '@/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/toast/store';
import { portUrl } from '@mochi/domain/terminal/devServer';
import { host } from '../host';
import { threadCwd } from '../host/cwd';
import type { DevServer, Thread } from '../model';
import { useDispatch, useGetState } from '../store';
import { refreshPorts, usePorts } from '../terminal/ports';
import { runTarget } from '../terminal/runTarget';
import { paneOpeners } from '../terminal/usePaneOpeners';
import { OverflowIcon, TooltipIconButton } from '../ui';
import { useImageUrls } from './imageSrc';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../queryKeys';
import { elsewhereReason, useRemoteMachine } from '../remote/origin';
import { useThreadCalls } from '../remote/threadCalls';

/** A dev server `start_dev_server` started: the page as it first loaded, whether it still listens, and Open or Start. */
export function DevServerCard({
  thread,
  server,
}: {
  thread: Thread;
  server: DevServer;
}) {
  const { url, status, listener, open, start, stop, elsewhere } = useDevServer(
    thread,
    server,
  );
  const [preview] = useImageUrls(server.preview ? [server.preview] : []);
  const isStopped = status === 'Stopped';

  return (
    <div className="w-full max-w-md overflow-hidden rounded-xl border bg-card">
      <button
        type="button"
        aria-label={`Open ${server.name}`}
        disabled={!!elsewhere}
        title={elsewhere}
        onClick={isStopped ? start : open}
        className="flex aspect-video w-full items-center justify-center overflow-hidden border-b bg-muted/40 text-muted-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        {preview ? (
          <img
            src={preview}
            alt=""
            className="size-full object-cover object-top"
          />
        ) : (
          <Globe className="size-6" aria-hidden />
        )}
      </button>
      <div className="flex items-center gap-3 py-2.5 ps-4 pe-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{server.name}</div>
          <div className="truncate type-caption text-muted-foreground tabular-nums">
            localhost:{server.port}
            {!!status && ` · ${status}`}
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={!!elsewhere}
          title={elsewhere}
          onClick={isStopped ? start : open}
        >
          {isStopped && <Play aria-hidden />}
          {isStopped ? 'Start' : 'Open'}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <TooltipIconButton label="More actions">
              <OverflowIcon vertical />
            </TooltipIconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={!!elsewhere}
              onSelect={() => window.open(url, '_blank', 'noopener')}
            >
              <ArrowUpRight aria-hidden />
              Open in your browser
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!!elsewhere}
              onSelect={() =>
                void navigator.clipboard
                  .writeText(url)
                  .then(() => toast('Copied URL'))
              }
            >
              <Copy aria-hidden />
              Copy URL
            </DropdownMenuItem>
            {!!listener && (
              <DropdownMenuItem onSelect={() => stop(listener.pid)}>
                <Stop aria-hidden />
                Stop server
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function useDevServer(thread: Thread, server: DevServer) {
  const dispatch = useDispatch();
  const getState = useGetState();
  const machine = useRemoteMachine();
  const cwd = machine ? null : threadCwd(thread);
  const local = usePorts(thread.id, cwd).ports;
  const remote = useRemotePorts(thread, !!machine);
  const ports = machine ? remote.ports : local;
  const listener = ports?.find((p) => p.port === server.port);
  // Unknown until the first scan lands: no status rather than a wrong one.
  const status = ports && (listener ? 'Running' : 'Stopped');
  return {
    url: portUrl(server.port),
    status,
    listener,
    /** Why it can't open or start from here: its localhost is another computer's. */
    elsewhere: machine ? elsewhereReason(machine) : undefined,
    open: () => paneOpeners(dispatch, thread.id).openPort(server.port),
    start: () => {
      if (!cwd) return;
      const pane = getState().panes.find((p) => p.threadId === thread.id);
      void runTarget(server, { threadId: thread.id, cwd, pane, dispatch });
      paneOpeners(dispatch, thread.id).openPort(server.port);
      refreshPorts();
    },
    stop: async (pid: number) => {
      try {
        await (machine ? remote.kill(pid) : host.ports.kill(pid));
      } catch (error) {
        toast.error(`Could not stop ${server.name}`, {
          description: (error as Error).message,
        });
      }
      if (machine) void remote.refresh();
      else refreshPorts();
    },
  };
}

const REMOTE_PORTS_MS = 10_000;

/** What listens in another computer's thread folder, read from it while the card is on screen. */
function useRemotePorts(thread: Thread, isRemote: boolean) {
  const calls = useThreadCalls(thread);
  const portsQuery = useQuery({
    queryKey: queryKeys.ports.listening(thread.id),
    queryFn: () => calls!.ports(),
    enabled: isRemote && !!calls,
    refetchInterval: REMOTE_PORTS_MS,
  });
  const listing = portsQuery.data;
  return {
    ports: listing && 'ports' in listing ? listing.ports : undefined,
    kill: (pid: number) => calls!.killPort(pid),
    refresh: () => portsQuery.refetch(),
  };
}
