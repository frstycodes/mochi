import { useRef, useSyncExternalStore } from 'react';
import { mirrorOf, type MirroredThread } from '../remote/mirror.ts';
import { useMachines, type FollowedView } from '../remote/useMachines.tsx';
import { createReplica, type ReplicaLog } from '../store/replica.ts';
import { transportLog } from '../store/replicaLog.ts';
import { mirrorState } from '../store/root.ts';
import type { Saved } from '../store/saved.ts';
import type { State } from '../store/types.ts';
import { CHANNEL_MESSAGE, portTransport } from './channel.ts';
import { backends, useBackends, type Backends } from './registry.ts';

const EMPTY: Saved = {
  version: 1,
  now: 0,
  seq: 0,
  threads: [],
  queue: [],
  checkpoints: {},
  checkpointSeq: 0,
  forks: {},
};

/** Another computer's store takes commands through `device.command` until PR 14 routes them to its RPCs. */
const readOnly = (log: ReplicaLog): ReplicaLog => ({
  ...log,
  append: () =>
    Promise.reject(
      new Error('Another computer’s store is read here, not written'),
    ),
});

/**
 * Adds the computer behind `port` once its `replica` stream's first snapshot is in, folded through the same `createReplica`
 * this computer's store uses, with the mirror's initial state so nothing runs here. It leaves when main closes the port.
 */
export function connectRemote(
  registry: Backends,
  machineId: string,
  port: MessagePort,
) {
  let isClosed = false;
  const transport = portTransport(port, () => {
    isClosed = true;
    views.delete(machineId);
    if (registry.get(machineId)?.transport === transport)
      registry.remove(machineId);
  });
  void createReplica(readOnly(transportLog(transport)), (saved) =>
    mirrorState(saved ?? EMPTY),
  ).then((replica) => {
    if (isClosed) return replica.stop();
    registry.add({ id: machineId, isLocal: false, transport, replica });
  });
}

/** Takes each channel main hands this window (`electron/remote/channels.ts`), from the first render on. */
export function listenForChannels(registry: Backends = backends) {
  window.addEventListener(
    'message',
    (event: MessageEvent<{ channel?: string; machineId?: string }>) => {
      const port = event.ports[0];
      if (
        event.source !== window ||
        event.data?.channel !== CHANNEL_MESSAGE ||
        typeof event.data.machineId !== 'string' ||
        !port
      )
        return;
      connectRemote(registry, event.data.machineId, port);
    },
  );
}

/** Each thread's file as the machine would save it, reusing last time's object for a thread nothing changed in. */
function filesOf(
  state: State,
  previous: Record<string, MirroredThread>,
): Record<string, MirroredThread> {
  const queues: Record<string, State['queue']> = {};
  for (const q of state.queue) (queues[q.threadId] ??= []).push(q);
  return Object.fromEntries(
    state.threads
      .filter((t) => t.live)
      .map((thread) => {
        const file: MirroredThread = {
          thread,
          ...(state.checkpoints[thread.id] && {
            checkpoints: state.checkpoints[thread.id],
          }),
          ...(state.forks[thread.id] && { fork: state.forks[thread.id] }),
          ...(queues[thread.id] && { queue: queues[thread.id] }),
          ...(state.remoteSideChats[thread.id] && {
            sideChat: state.remoteSideChats[thread.id],
          }),
        };
        const last = previous[thread.id];
        return [thread.id, last && isSameFile(last, file) ? last : file];
      }),
  );
}

const isSameFile = (a: MirroredThread, b: MirroredThread) =>
  a.thread === b.thread &&
  a.checkpoints === b.checkpoints &&
  a.fork === b.fork &&
  a.sideChat === b.sideChat &&
  (a.queue ?? []).length === (b.queue ?? []).length &&
  (a.queue ?? []).every((q, i) => q === b.queue![i]);

const views = new Map<
  string,
  { state: State; files: Record<string, MirroredThread>; view: State }
>();

/**
 * Another computer's replica the way the merged views read its mirror: every thread id machine-aware (`remoteThreadId`), built
 * by the mirror's own `mirrorOf` from the same thread files, so the two agree (`remote.test.ts`). Only changed threads re-prefix.
 */
export function remoteView(machineId: string, state: State): State {
  const last = views.get(machineId);
  if (last?.state === state) return last.view;
  const files = filesOf(state, last?.files ?? {});
  const view = mirrorOf(machineId, files).state;
  views.set(machineId, { state, files, view });
  return view;
}

/** Each connected computer's view (`remoteView`) by machine id, re-rendering as their replicas change. */
export function useRemoteViews(): ReadonlyMap<string, State> {
  const remotes = useBackends().filter((b) => !b.isLocal);
  const cache = useRef<{ key: unknown[]; value: ReadonlyMap<string, State> }>({
    key: [],
    value: new Map(),
  });
  const subscribe = (listener: () => void) => {
    const stops = remotes.map((b) => b.replica.store.subscribe(listener));
    return () => stops.forEach((stop) => stop());
  };
  const snapshot = () => {
    const key = remotes.flatMap((b) => [b.id, b.replica.store.getState()]);
    const known = cache.current;
    if (
      key.length === known.key.length &&
      key.every((k, i) => k === known.key[i])
    )
      return known.value;
    const value = new Map(
      remotes.map((b) => [b.id, remoteView(b.id, b.replica.store.getState())]),
    );
    cache.current = { key, value };
    return value;
  };
  return useSyncExternalStore(subscribe, snapshot);
}

/**
 * Each followed computer with the store the merged views read: its registry replica while it's connected, else its mirror
 * (the cache, while it's offline). PR 14 drops the mirror.
 */
export function useMachineViews(): FollowedView[] {
  const { machines } = useMachines();
  const views = useRemoteViews();
  return machines.map((m) => {
    const view = views.get(m.machine.id);
    return view ? { ...m, state: view } : m;
  });
}
