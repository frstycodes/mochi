import { useQuery } from '@tanstack/react-query';
import { queryClient } from '../query.ts';
import { queryKeys } from '../queryKeys.ts';
import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from '@/toast/store';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { host } from '../host';
import { useLatest } from '../useLatest';
import type {
  CommandData,
  CommandResult,
  FollowedMachine,
  RemoteCommand,
} from '../host/types/remote';
import { StoreScope, type Action, type State } from '../store';
import { commandFor } from './actions';
import { applyFrame, cachedMirror, type Mirror } from './mirror';
import { openRemoteThread } from '../routes/nav';

/** A computer this one follows, with its store as far as the stream has brought it; no state before its first snapshot. */
export interface FollowedView {
  machine: FollowedMachine;
  state: State | undefined;
}

interface Machines {
  machines: FollowedView[];
  /** Runs a command on that machine and toasts the outcome; push and opening a PR ask here first, as the ship bar does. */
  run: (machineId: string, command: RemoteCommand) => Promise<CommandResult>;
  /** Reads from that machine without a toast, for panes that show their own errors; rejects with the machine's reason. */
  ask: <T extends RemoteCommand['type']>(
    machineId: string,
    command: Extract<RemoteCommand, { type: T }>,
  ) => Promise<DataOf<T>>;
}

type DataOf<T extends RemoteCommand['type']> = T extends keyof CommandData
  ? CommandData[T]
  : undefined;

type Asking = {
  machineName: string;
  command: Extract<RemoteCommand, { type: 'push' | 'open-pr' }>;
  answer: (isSent: boolean) => void;
};

const MachinesContext = createContext<Machines | null>(null);
const NOT_SENT: CommandResult = { isOk: false, error: 'Not sent' };

/** Follows every computer this one paired with: their streams mirrored here, their commands sent from here. */
export function MachinesProvider({ children }: { children: ReactNode }) {
  const machinesQuery = useQuery({
    queryKey: queryKeys.remote.machines(),
    queryFn: () => host.remote.machines(),
  });
  const followed = machinesQuery.data ?? [];
  const cachedQuery = useQuery({
    queryKey: queryKeys.remote.cachedMachines(),
    queryFn: () => host.remote.cachedMachines(),
    staleTime: Infinity,
  });
  const [mirrors, setMirrors] = useState<Record<string, Mirror | undefined>>(
    {},
  );
  const [asking, setAsking] = useState<Asking | null>(null);

  useEffect(() => {
    const offMachines = host.remote.onMachines(() => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.remote.machines(),
      });
    });
    const offFrames = host.remote.onMachineFrame(({ machineId, frame }) =>
      setMirrors((all) => ({
        ...all,
        [machineId]: applyFrame(all[machineId], frame),
      })),
    );
    // Before this, frames went nowhere: every machine starts over, each thread from its snapshot.
    void host.remote.follow();
    return () => {
      offMachines();
      offFrames();
    };
  }, []);

  const [mergedCache, setMergedCache] = useState(cachedQuery.data);
  if (cachedQuery.data && cachedQuery.data !== mergedCache) {
    const list = cachedQuery.data;
    setMergedCache(list);
    // Each cached thread file is decoded again here (`cachedMirror`), as a streamed one is.
    setMirrors((all) =>
      list.reduce(
        (next, { machineId, saved }) =>
          next[machineId]
            ? next
            : { ...next, [machineId]: cached(cachedMirror(JSON.parse(saved))) },
        all,
      ),
    );
  }
  useMirrorCache(mirrors);
  const machines = followed.map((machine) => ({
    machine,
    state: mirrors[machine.id]?.state,
  }));
  const latest = useLatest(machines);

  const run = async (machineId: string, command: RemoteCommand) => {
    const machineName =
      latest.current.find((m) => m.machine.id === machineId)?.machine.name ??
      'That computer';
    if (command.type === 'push' || command.type === 'open-pr') {
      const isSent = await new Promise<boolean>((answer) =>
        setAsking({ machineName, command, answer }),
      );
      if (!isSent) return NOT_SENT;
    }
    const result = await host.remote
      .command(machineId, command)
      .catch((error: unknown): CommandResult => ({
        isOk: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    if (!result.isOk)
      toast.error(`Couldn’t ${COMMAND_VERBS[command.type]} on ${machineName}`, {
        description: result.error,
      });
    else if (result.detail)
      toast.success(`${SUCCESS[command.type] ?? 'Done'} on ${machineName}`, {
        description: result.detail,
      });
    return result;
  };

  const ask = async <T extends RemoteCommand['type']>(
    machineId: string,
    command: Extract<RemoteCommand, { type: T }>,
  ) => {
    const result = await host.remote.command(machineId, command);
    if (!result.isOk) throw new Error(result.error);
    return result.data as DataOf<T>;
  };

  const answer = (isSent: boolean) => {
    asking?.answer(isSent);
    setAsking(null);
  };

  return (
    <MachinesContext.Provider value={{ machines, run, ask }}>
      {children}
      <AlertDialog
        open={!!asking}
        onOpenChange={(open) => !open && answer(false)}
      >
        {!!asking && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {asking.command.type === 'push'
                  ? `Push from ${asking.machineName}?`
                  : `Open a pull request from ${asking.machineName}?`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {asking.command.type === 'push'
                  ? `${asking.machineName} pushes this thread’s branch to GitHub with its own GitHub login.`
                  : `“${asking.command.title}” opens on GitHub with ${asking.machineName}’s GitHub login.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => answer(true)}>
                {asking.command.type === 'push' ? 'Push' : 'Open pull request'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </MachinesContext.Provider>
  );
}

const CACHE_EVERY_MS = 5000;

/** Mirrors read back from the cache: nothing new in them to save. */
const fromCache = new WeakSet<Mirror>();
const cached = (mirror: Mirror) => (fromCache.add(mirror), mirror);

/** Saves each mirror that changed, at most every few seconds; a busy stream still gets saved while it runs. */
function useMirrorCache(mirrors: Record<string, Mirror | undefined>) {
  const saved = useRef(new Map<string, Mirror>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveChanged = useEffectEvent(() => {
    for (const [machineId, mirror] of unsaved(mirrors, saved.current)) {
      saved.current.set(machineId, mirror);
      host.remote
        .cacheMachine(machineId, JSON.stringify(mirror.threads))
        .catch((error: unknown) =>
          console.error('Saving another computer’s threads failed', error),
        );
    }
  });
  useEffect(() => {
    if (timer.current || unsaved(mirrors, saved.current).length === 0) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      saveChanged();
    }, CACHE_EVERY_MS);
  }, [mirrors]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      timer.current = undefined;
    },
    [],
  );
}

function unsaved(
  mirrors: Record<string, Mirror | undefined>,
  saved: Map<string, Mirror>,
) {
  return Object.entries(mirrors).filter(
    (entry): entry is [string, Mirror] =>
      !!entry[1] &&
      !fromCache.has(entry[1]) &&
      saved.get(entry[0]) !== entry[1],
  );
}

export function useMachines() {
  const machines = useContext(MachinesContext);
  if (!machines)
    throw new Error('useMachines must be used inside MachinesProvider');
  return machines;
}

/** What a new thread on that computer can start in and with; null while it's read, offline or when it can't be read. */
/** That machine's catalog, read when it comes online; `reload` reads it again (after adding a project there). */
export function useMachineCatalog(machine: FollowedMachine | undefined) {
  const { ask } = useMachines();
  const machineId = machine?.id;
  const isOnline = machine?.status === 'online';
  const catalogQuery = useQuery({
    queryKey: queryKeys.remote.catalog(machineId, isOnline),
    queryFn: () => ask(machineId!, { type: 'catalog' }),
    enabled: !!machineId && isOnline,
  });
  return {
    catalog: isOnline ? (catalogQuery.data ?? null) : null,
    reload: () => {
      void catalogQuery.refetch();
    },
  };
}

/**
 * The app's own components on another computer's thread: they read its mirrored store and their actions become commands to
 * it. What a device can't do yet says so instead of changing this computer's store.
 */
export function RemoteScope({
  machine,
  state,
  onOpenTab,
  children,
}: {
  machine: FollowedMachine;
  state: State;
  onOpenTab?: (action: Extract<Action, { type: 'pane-open-tab' }>) => void;
  children: ReactNode;
}) {
  const { run, ask } = useMachines();
  const dispatch = (action: Action) => {
    // A link in its transcript: the thread view opens its own pane, reading from that computer.
    if (action.type === 'pane-open-tab' && onOpenTab) return onOpenTab(action);
    const command = commandFor(action);
    if (!command)
      return void toast(`Do this on ${machine.name} itself for now`);
    if (command.type === 'open')
      return openRemoteThread({
        machineId: machine.id,
        threadId: command.threadId,
      });
    // Read state is no reason to toast: offline, or without operate, it just stays unread there.
    if (command.type === 'seen')
      return void ask(machine.id, command).catch(() => undefined);
    void run(machine.id, command);
  };
  return (
    <StoreScope state={state} dispatch={dispatch}>
      {children}
    </StoreScope>
  );
}

const COMMAND_VERBS = {
  catalog: 'read its projects',
  settings: 'read its settings',
  projects: 'read its projects',
  'add-project': 'create the project',
  'clone-project': 'clone the project',
  send: 'send the message',
  resolve: 'answer',
  interrupt: 'stop the agent',
  fork: 'fork the thread',
  handoff: 'hand off the thread',
  create: 'start the thread',
  rename: 'rename the thread',
  'edit-goal': 'edit the goal',
  pin: 'pin the thread',
  settle: 'change the thread',
  schedule: 'change the schedule',
  commit: 'commit',
  push: 'push',
  'open-pr': 'open the pull request',
  rewind: 'rewind the thread',
  'side-chat': 'ask the side chat',
  seen: 'mark it read',
  delete: 'delete the thread',
  setting: 'change the setting',
  diff: 'read the changes',
  'checkpoint-diff': 'read the checkpoint',
  change: 'change the files',
  comment: 'send the note',
  files: 'list the files',
  'read-file': 'read the file',
  'terminal-open': 'open a terminal',
  'terminal-write': 'type in the terminal',
  'terminal-resize': 'resize the terminal',
  'terminal-close': 'close the terminal',
} satisfies Record<RemoteCommand['type'], string>;

const SUCCESS: Partial<Record<RemoteCommand['type'], string>> = {
  commit: 'Committed',
  'open-pr': 'Opened the pull request',
};
