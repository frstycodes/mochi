import { useEffect, type Dispatch } from 'react';
import { host } from '../host/index.ts';
import { useRemoteStatus } from './useRemoteStatus';
import { getPrefs } from '../settings/prefs.ts';
import type { Action, State } from '../store/index.tsx';
import { runRemoteCommand } from './commands.ts';
import { setMachineName } from './answers.ts';
import { closeIdleShells, SWEEP_MS } from './terminals.ts';

/** Runs devices' commands, which reach this window from Core through main, while the store lives here. */
export function useRemoteBridge(getState: () => State, dispatch: Dispatch<Action>) {
  const { status } = useRemoteStatus();
  useEffect(() => {
    if (status) setMachineName(status.settings.machineName || status.hostName);
  }, [status]);

  useEffect(() => {
    const timer = setInterval(() => closeIdleShells(Date.now()), SWEEP_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(
    () =>
      host.remote.onCommand(({ id, deviceName, command }) => {
        void runRemoteCommand(command, { state: getState(), dispatch, deviceName, whileWorking: getPrefs().whileWorking })
          // A host call that throws (git refused a push, gh couldn't open the PR) is the device's answer, verbatim.
          .catch((error: unknown) => ({ isOk: false as const, error: error instanceof Error ? error.message : String(error) }))
          .then((result) => host.remote.commandResult(id, result))
          .catch((error: unknown) => console.error('Answering the device failed', error));
      }),
    [getState, dispatch],
  );
}
