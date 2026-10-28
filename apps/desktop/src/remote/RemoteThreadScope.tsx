import type { ReactNode } from 'react';
import { toast } from '@/toast/store';
import { MachineModelsContext } from '../ModelControls';
import type { FollowedMachine } from '../host/types/remote';
import {
  shallowEqual,
  StoreScope,
  useDispatch,
  useHarnessSelector,
  type Action,
  type State,
} from '../store';
import { commandFor } from './actions';
import { parseRemoteThreadId } from './ids';
import { elsewhereReason, ThreadOriginContext } from './origin';
import {
  hybridState,
  isQuietAction,
  isScreenAction,
  localSlices,
} from './threadScope';
import { useMachineCatalog, useMachines } from './useMachines';

/**
 * Another computer's thread in the app's own thread view: this window's splits, panes and side chats around that computer's
 * threads. What changes the screen stays here; what changes the thread is a command to its computer; the rest says so.
 */
export function RemoteThreadScope({
  machine,
  mirror,
  children,
}: {
  machine: FollowedMachine;
  mirror: State;
  children: ReactNode;
}) {
  const local = useHarnessSelector(localSlices, shallowEqual);
  const localDispatch = useDispatch();
  const { run, ask } = useMachines();
  const { catalog } = useMachineCatalog(machine);
  const dispatch = (action: Action) => {
    if (isScreenAction(action)) return localDispatch(action);
    if (isQuietAction(action)) return;
    const command = commandFor(action);
    if (!command) return void toast(elsewhereReason(machine));
    if (command.type === 'open')
      return localDispatch({
        type: 'go',
        view: { kind: 'thread', id: command.threadId },
      });
    // Read state is no reason to toast: offline, or without operate, it just stays unread there.
    if (command.type === 'seen')
      return void ask(machine.id, command).catch(() => undefined);
    void run(machine.id, command);
  };
  return (
    <ThreadOriginContext.Provider value={{ kind: 'remote', machine }}>
      <MachineModelsContext.Provider value={catalog ?? NO_CATALOG}>
        <StoreScope state={hybridState(local, mirror)} dispatch={dispatch}>
          {children}
        </StoreScope>
      </MachineModelsContext.Provider>
    </ThreadOriginContext.Provider>
  );
}

/** Before the catalog comes (or while that computer is offline) the pickers list nothing rather than this computer's models. */
const NO_CATALOG = { models: {}, defaults: { claude: '', codex: '' } };

/** `children` under the store of the computer that owns `threadId`: as they are for this computer's own; nothing while another's hasn't streamed yet. */
export function OwnerScope({
  threadId,
  children,
}: {
  threadId: string | null | undefined;
  children: ReactNode;
}) {
  const { machines } = useMachines();
  const remote = threadId ? parseRemoteThreadId(threadId) : null;
  if (!remote) return children;
  const followed = machines.find((m) => m.machine.id === remote.machineId);
  if (!followed?.state) return null;
  return (
    <RemoteThreadScope machine={followed.machine} mirror={followed.state}>
      {children}
    </RemoteThreadScope>
  );
}
