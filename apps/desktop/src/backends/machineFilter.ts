import { useStore } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';
import type { DeviceKind, FollowedMachine } from '../host/types/remote.ts';
import { parseRemoteThreadId } from '../remote/ids.ts';
import { useMachines } from '../remote/useMachines.tsx';
import { useThisBackend } from '../remote/useThisBackend.ts';
import type { State } from '../store/types.ts';
import { LOCAL_BACKEND } from './registry.ts';

/** The backends this window shows, by registry id; empty shows every one. */
export type MachineFilter = readonly string[];

export interface MachineOption {
  id: string;
  name: string;
  kind: DeviceKind | undefined;
  status?: FollowedMachine['status'];
}

const PARAM = 'machines';

/**
 * This window's filter. sessionStorage is each window's own and survives a reload; a new window starts from the `?machines=`
 * its route was opened with (`filteredWindowRoute`).
 */
export const machineFilter = createStore(
  persist<{ ids: MachineFilter }>(
    () => ({ ids: idsFromHash(globalThis.location?.hash ?? '') }),
    {
      name: 'mochi.machine-filter',
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);

/** The machines this window can be narrowed to, this computer first, and what it shows of them. */
export function useMachineFilter() {
  const { machines } = useMachines();
  const local = useThisBackend();
  const saved = useStore(machineFilter, (s) => s.ids);
  const options: MachineOption[] = [
    { id: LOCAL_BACKEND, name: local.name, kind: local.kind },
    ...machines.map(({ machine }) => ({
      id: machine.id,
      name: machine.name,
      kind: machine.kind,
      status: machine.status,
    })),
  ];
  const allIds = options.map((o) => o.id);
  const selected = resolveMachineFilter(saved, allIds);
  return {
    options,
    selected,
    toggle: (id: string) =>
      machineFilter.setState({ ids: toggleMachine(selected, id, allIds) }),
    clear: () => machineFilter.setState({ ids: [] }),
  };
}

export const backendOfThread = (threadId: string) =>
  parseRemoteThreadId(threadId)?.machineId ?? LOCAL_BACKEND;

export const isShown = (filter: MachineFilter, backendId: string) =>
  filter.length === 0 || filter.includes(backendId);

/** The saved filter without machines that are no longer paired; one that names none of them, or all of them, shows every one. */
export function resolveMachineFilter(
  saved: MachineFilter,
  allIds: readonly string[],
): MachineFilter {
  const known = saved.filter((id) => allIds.includes(id));
  return known.length === allIds.length ? [] : known;
}

/** Shows or hides one machine; the last one shown stays shown. */
export function toggleMachine(
  selected: MachineFilter,
  id: string,
  allIds: readonly string[],
): MachineFilter {
  const shown = selected.length === 0 ? allIds : selected;
  if (!shown.includes(id)) return resolveMachineFilter([...shown, id], allIds);
  if (shown.length === 1) return selected;
  return shown.filter((s) => s !== id);
}

/** The merged threads and Queue narrowed to the filter's machines. */
export function narrowToMachines<S extends Pick<State, 'threads' | 'queue'>>(
  state: S,
  filter: MachineFilter,
): S {
  if (filter.length === 0) return state;
  const shows = (threadId: string) =>
    filter.includes(backendOfThread(threadId));
  return {
    ...state,
    threads: state.threads.filter((t) => shows(t.id)),
    queue: state.queue.filter((q) => shows(q.threadId)),
  };
}

/** The route `host.windows.open` takes for a window that starts filtered to `filter`. */
export const filteredWindowRoute = (filter: MachineFilter) =>
  `?${new URLSearchParams({ [PARAM]: filter.join(',') })}`;

export function idsFromHash(hash: string): MachineFilter {
  const at = hash.indexOf('?');
  if (at < 0) return [];
  const ids = new URLSearchParams(hash.slice(at + 1)).get(PARAM);
  return ids?.split(',').filter(Boolean) ?? [];
}
