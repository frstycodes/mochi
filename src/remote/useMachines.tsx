import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { host } from '../host';
import type { CommandResult, FollowedMachine, RemoteCommand } from '../host/types/remote';
import { HarnessContext, type Action, type State } from '../store';
import { toSaved } from '../store/persist';
import { commandFor } from './actions';
import { applyFrame, type Mirror } from './mirror';
import { openRemoteThread } from './open';

/** A computer this one follows, with its store as far as the stream has brought it; no state before its first snapshot. */
export interface FollowedView {
  machine: FollowedMachine;
  state: State | undefined;
}

interface Machines {
  machines: FollowedView[];
  /** Runs a command on that machine and toasts the outcome; push and opening a PR ask here first, as the ship bar does. */
  run: (machineId: string, command: RemoteCommand) => Promise<CommandResult>;
}

type Asking = { machineName: string; command: Extract<RemoteCommand, { type: 'push' | 'open-pr' }>; answer: (isSent: boolean) => void };

const MachinesContext = createContext<Machines | null>(null);
const NOT_SENT: CommandResult = { isOk: false, error: 'Not sent' };

/** Follows every computer this one paired with: their streams mirrored here, their commands sent from here. */
export function MachinesProvider({ children }: { children: ReactNode }) {
  const [followed, setFollowed] = useState<FollowedMachine[]>([]);
  const [mirrors, setMirrors] = useState<Record<string, Mirror | undefined>>({});
  const [asking, setAsking] = useState<Asking | null>(null);

  useEffect(() => {
    void host.remote.machines().then(setFollowed, (error: unknown) => console.error('Reading your other computers failed', error));
    const offMachines = host.remote.onMachines(setFollowed);
    // What each machine last sent, until it sends a fresh snapshot: its epoch is none, so no live action applies to it.
    void host.remote.cachedMachines().then(
      (cached) =>
        setMirrors((all) =>
          cached.reduce((next, { machineId, saved }) => (next[machineId] ? next : { ...next, [machineId]: applyFrame(undefined, { type: 'snapshot', epoch: '', seq: 0, saved: JSON.parse(saved) }) }), all),
        ),
      (error: unknown) => console.error('Reading your other computers’ saved threads failed', error),
    );
    const offFrames = host.remote.onMachineFrame(({ machineId, frame }) =>
      setMirrors((all) => {
        const next = applyFrame(all[machineId], frame);
        return next === all[machineId] ? all : { ...all, [machineId]: next };
      }),
    );
    // Before this, frames went nowhere: every machine starts over with a snapshot.
    void host.remote.follow();
    return () => {
      offMachines();
      offFrames();
    };
  }, []);

  useMirrorCache(mirrors);
  const machines = useMemo(() => followed.map((machine) => ({ machine, state: mirrors[machine.id]?.state })), [followed, mirrors]);
  const latest = useRef(machines);
  latest.current = machines;

  const run = useCallback(async (machineId: string, command: RemoteCommand) => {
    const machineName = latest.current.find((m) => m.machine.id === machineId)?.machine.name ?? 'That computer';
    if (command.type === 'push' || command.type === 'open-pr') {
      const isSent = await new Promise<boolean>((answer) => setAsking({ machineName, command, answer }));
      if (!isSent) return NOT_SENT;
    }
    const result = await host.remote.command(machineId, command).catch((error: unknown): CommandResult => ({ isOk: false, error: error instanceof Error ? error.message : String(error) }));
    if (!result.isOk) toast.error(`Couldn’t ${COMMAND_VERBS[command.type]} on ${machineName}`, { description: result.error });
    else if (result.detail) toast.success(`${SUCCESS[command.type] ?? 'Done'} on ${machineName}`, { description: result.detail });
    return result;
  }, []);

  const answer = (isSent: boolean) => {
    asking?.answer(isSent);
    setAsking(null);
  };

  return (
    <MachinesContext.Provider value={useMemo(() => ({ machines, run }), [machines, run])}>
      {children}
      <AlertDialog open={!!asking} onOpenChange={(open) => !open && answer(false)}>
        {!!asking && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{asking.command.type === 'push' ? `Push from ${asking.machineName}?` : `Open a pull request from ${asking.machineName}?`}</AlertDialogTitle>
              <AlertDialogDescription>
                {asking.command.type === 'push'
                  ? `${asking.machineName} pushes this thread’s branch to GitHub with its own GitHub login.`
                  : `“${asking.command.title}” opens on GitHub with ${asking.machineName}’s GitHub login.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => answer(true)}>{asking.command.type === 'push' ? 'Push' : 'Open pull request'}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </MachinesContext.Provider>
  );
}

const CACHE_EVERY_MS = 5000;

/** Saves each mirror that changed, at most every few seconds; a busy stream still gets saved while it runs. */
function useMirrorCache(mirrors: Record<string, Mirror | undefined>) {
  const latest = useRef(mirrors);
  latest.current = mirrors;
  const saved = useRef(new Map<string, Mirror>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      for (const [machineId, mirror] of Object.entries(latest.current)) {
        // A mirror from the cache itself has no epoch: nothing new to save.
        if (!mirror?.epoch || saved.current.get(machineId) === mirror) continue;
        saved.current.set(machineId, mirror);
        host.remote.cacheMachine(machineId, JSON.stringify(toSaved(mirror.state))).catch((error: unknown) => console.error('Saving another computer’s threads failed', error));
      }
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

export function useMachines() {
  const machines = useContext(MachinesContext);
  if (!machines) throw new Error('useMachines must be used inside MachinesProvider');
  return machines;
}

/**
 * The app's own components on another computer's thread: they read its mirrored store and their actions become commands to
 * it. What a device can't do yet says so instead of changing this computer's store.
 */
export function RemoteScope({ machine, state, children }: { machine: FollowedMachine; state: State; children: ReactNode }) {
  const { run } = useMachines();
  const dispatch = useCallback(
    (action: Action) => {
      const command = commandFor(action);
      if (!command) return void toast(`Do this on ${machine.name} itself for now`);
      if (command.type === 'open') return openRemoteThread({ machineId: machine.id, threadId: command.threadId });
      void run(machine.id, command);
    },
    [machine.id, machine.name, run],
  );
  const value = useMemo(() => ({ state, dispatch }), [state, dispatch]);
  return <HarnessContext.Provider value={value}>{children}</HarnessContext.Provider>;
}

const COMMAND_VERBS = {
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
} satisfies Record<RemoteCommand['type'], string>;

const SUCCESS: Partial<Record<RemoteCommand['type'], string>> = { commit: 'Committed', 'open-pr': 'Opened the pull request' };
