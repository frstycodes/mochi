import { useEffect, useRef, type Dispatch } from 'react';
import { host } from '../host/index.ts';
import type { RemoteStatus } from '../host/types/remote.ts';
import { getPrefs } from '../settings/prefs.ts';
import type { Action, State } from '../store/index.tsx';
import { toSaved } from '../store/persist.ts';
import { runRemoteCommand } from './commands.ts';
import { setStreaming, streamPosition } from './tap.ts';

/** Streams the store to main while remote is on, answers its snapshot requests and runs devices' commands. */
export function useRemoteBridge(state: State, dispatch: Dispatch<Action>) {
  const latest = useRef(state);
  const waiting = useRef<string[]>([]);

  // A snapshot goes out only once the committed store holds every numbered action, so it matches the seq it carries.
  const answerSnapshots = () => {
    const { epoch, seq } = streamPosition();
    if (!epoch || waiting.current.length === 0 || latest.current.streamed !== seq) return;
    const saved = JSON.stringify(toSaved(latest.current));
    for (const id of waiting.current.splice(0)) host.remote.snapshot(id, epoch, seq, saved).catch((error: unknown) => console.error('Sending the snapshot failed', error));
  };

  useEffect(() => {
    latest.current = state;
    answerSnapshots();
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const apply = (status: RemoteStatus) => {
      setStreaming(status.settings.isEnabled, status.settings.machineName || status.hostName);
      answerSnapshots();
    };
    void host.remote.status().then(apply, (error: unknown) => console.error('Reading Settings › Remote access failed', error));
    const offStatus = host.remote.onStatus(apply);
    const offSnapshot = host.remote.onSnapshotRequest((id) => {
      waiting.current.push(id);
      answerSnapshots();
    });
    return () => {
      offStatus();
      offSnapshot();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () =>
      host.remote.onCommand(({ id, deviceName, command }) => {
        void runRemoteCommand(command, { state: latest.current, dispatch, deviceName, whileWorking: getPrefs().whileWorking })
          // A host call that throws (git refused a push, gh couldn't open the PR) is the device's answer, verbatim.
          .catch((error: unknown) => ({ isOk: false as const, error: error instanceof Error ? error.message : String(error) }))
          .then((result) => host.remote.commandResult(id, result))
          .catch((error: unknown) => console.error('Answering the device failed', error));
      }),
    [dispatch],
  );
}
