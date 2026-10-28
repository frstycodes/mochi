import type { ReactNode } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { toast } from '@/toast/store';
import { host } from '../host';
import type { Thread } from '../model';
import { useProfiles } from '../profiles';
import { queryKeys } from '../queryKeys';
import { StoreScope, useHarness, type Action, type State } from '../store';
import { parseRemoteThreadId } from './ids';
import {
  mergeThreads,
  pinAcross,
  projectMap,
  reorderAcross,
  splitByMachine,
} from './merged';
import { getRemotePins, setRemotePins, useRemotePins } from './pins';
import { isQuietAction, isScreenAction } from './threadScope';
import { useMachines, useRemoteDispatch } from './useMachines';

/** Another computer's projects change rarely; the merged list reads them once a while it's online. */
const PROJECTS_STALE_MS = 5 * 60_000;

/**
 * This computer's store with every followed computer's threads in it (`mergeThreads`): the sidebar lists, pins, selects and opens
 * them as its own. An action goes to the computer whose threads it names; pins on another computer's threads stay on this screen.
 */
export function MergedScope({ children }: { children: ReactNode }) {
  const { state, dispatch } = useHarness();
  const merged = useMergedState(state);
  const dispatchOn = useRemoteDispatch();
  const { machines } = useMachines();
  const pins = useRemotePins();

  const toMachines = (action: Action) => {
    for (const part of splitByMachine(action)) {
      if (part.machineId === null) {
        dispatch(part.action);
        continue;
      }
      const followed = machines.find((m) => m.machine.id === part.machineId);
      if (!followed) {
        toast('That computer isn’t paired any more');
        continue;
      }
      // The command deletes one thread at a time.
      const actions: Action[] =
        part.action.type === 'delete'
          ? part.action.threadIds.map((id) => ({
              type: 'delete',
              threadIds: [id],
            }))
          : [part.action];
      for (const one of actions) dispatchOn(followed.machine, one);
    }
  };
  const route = (action: Action) => {
    // Splits, panes and what's watched are this screen's, whoever's thread they show: another computer's opens natively here.
    if (isScreenAction(action)) return dispatch(action);
    if (isQuietAction(action)) return;
    if (action.type === 'reorder' && (pins.length > 0 || namesRemote(action)))
      return reorderHere(merged.threads, action, dispatch);
    if (action.type === 'pin-at' && parseRemoteThreadId(action.threadId))
      return pinHere(merged.threads, action);
    toMachines(action);
  };

  return (
    <StoreScope state={merged} dispatch={route}>
      {children}
    </StoreScope>
  );
}

function reorderHere(
  threads: Thread[],
  action: Extract<Action, { type: 'reorder' }>,
  dispatch: (action: Action) => void,
) {
  const out = reorderAcross(threads, action, getRemotePins());
  if (!out) return;
  out.local.forEach(dispatch);
  setRemotePins(out.pins);
}

function pinHere(
  threads: Thread[],
  { threadId, order }: Extract<Action, { type: 'pin-at' }>,
) {
  const next = pinAcross(threads, threadId, order, getRemotePins());
  if (!next)
    return void toast('Pinned is full', {
      description: 'Orbit has five pin slots. Unpin a thread first.',
    });
  setRemotePins(next);
}

const namesRemote = (action: Extract<Action, { type: 'reorder' }>) =>
  [...action.pinned, ...action.unpinned].some((id) => parseRemoteThreadId(id));

/** `state` with every followed computer's threads and Queue in it, in this computer's profiles and projects. */
function useMergedState(state: State): State {
  const { machines, ask } = useMachines();
  const pins = useRemotePins();
  const spaceIds = useProfiles().map((p) => p.id);
  // What the Projects page already read; the merged list starts no read of this computer's own.
  const localProjects = useQuery({
    queryKey: queryKeys.projects.list(state.spaceId),
    queryFn: () => host.projects.list(state.spaceId),
    enabled: false,
  }).data;
  const remoteProjects = useQueries({
    queries: machines.map(({ machine }) => ({
      queryKey: queryKeys.projects.machine(machine.id),
      queryFn: () => ask(machine.id, { type: 'projects' }),
      enabled: machine.status === 'online' && !!localProjects,
      staleTime: PROJECTS_STALE_MS,
    })),
    combine: dataOf,
  });
  const sources = machines.flatMap(({ state: mirrored }, i) => {
    const theirs = remoteProjects[i];
    return mirrored
      ? [
          {
            state: mirrored,
            projects:
              theirs && localProjects
                ? projectMap(theirs, localProjects)
                : undefined,
          },
        ]
      : [];
  });
  return mergedState(state, sources, pins, spaceIds);
}

const dataOf = <T,>(results: { data?: T }[]) => results.map((r) => r.data);

function mergedState(
  state: State,
  sources: Parameters<typeof mergeThreads>[1],
  pins: Parameters<typeof mergeThreads>[2],
  spaceIds: string[],
): State {
  if (sources.length === 0) return state;
  const threads: Thread[] = mergeThreads(
    state.threads,
    sources,
    pins,
    spaceIds,
    state.spaceId,
  );
  return {
    ...state,
    threads,
    queue: [...state.queue, ...sources.flatMap((s) => s.state.queue)],
  };
}
