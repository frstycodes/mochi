import type { Project } from '@mochi/domain/host/types/projects';
import { PIN_SLOTS, type Repo, type Thread } from '../model.ts';
import { pinAt, pinOrderOf, reorderThreads } from '../reorder.ts';
import type { Action } from '../store/index.tsx';
import type { State } from '../store/types.ts';
import { parseRemoteThreadId } from './ids.ts';

/**
 * One thread list for every computer (the sidebar): this computer's threads and each mirror's, every one in a profile and
 * project of this computer's, and each screen's own pins. Pure, so `node --test` covers it; `MergedScope` serves it.
 */

/** This screen's pin on another computer's thread, by its machine-aware id; `order` sorts among this computer's own pins' `pinOrder`. */
export interface RemotePin {
  id: string;
  order: number;
}

export interface MergeSource {
  state: State;
  /** That computer's folder → the same project here (`projectMap`). */
  projects?: ReadonlyMap<string, Pick<Repo, 'path' | 'project'>>;
}

/** Another computer's project folders → this computer's clone of the same repo, matched by `origin`. */
export function projectMap(
  remote: readonly Project[],
  local: readonly Project[],
): Map<string, Pick<Repo, 'path' | 'project'>> {
  const byOrigin = new Map(
    local.flatMap((p) => (p.origin ? [[p.origin, p] as const] : [])),
  );
  return new Map(
    remote.flatMap((p) => {
      const here = p.origin ? byOrigin.get(p.origin) : undefined;
      return here
        ? [[p.path, { path: here.path, project: here.name }] as const]
        : [];
    }),
  );
}

/**
 * Every computer's threads as this one lists them. Another computer's go in the profile with its profile's id, else `fallbackSpaceId`;
 * in this computer's clone of their project when there is one; pinned only by this screen's `pins`. Pins then take Orbit slots per
 * profile in key order (`pinOrderOf`), this computer's first among equal keys; past the last slot one isn't pinned here.
 */
export function mergeThreads(
  local: readonly Thread[],
  sources: readonly MergeSource[],
  pins: readonly RemotePin[],
  spaceIds: readonly string[],
  fallbackSpaceId: string,
): Thread[] {
  const orderOf = new Map(pins.map((p) => [p.id, p.order]));
  const remote = sources.flatMap(({ state, projects }) =>
    state.threads.map((t): Thread => {
      const order = orderOf.get(t.id);
      const here = t.repo?.path ? projects?.get(t.repo.path) : undefined;
      return {
        ...t,
        spaceId: spaceIds.includes(t.spaceId) ? t.spaceId : fallbackSpaceId,
        repo: t.repo && here ? { ...t.repo, ...here } : t.repo,
        // Its own computer's pin stays there; the slot is set below.
        orbitSlot: order === undefined ? undefined : 0,
        pinOrder: order,
      };
    }),
  );
  if (remote.length === 0) return [...local];
  const threads = [...local, ...remote];
  const slots = new Map<string, number | undefined>();
  for (const spaceId of new Set(threads.map((t) => t.spaceId)))
    threads
      .filter(
        (t) =>
          t.spaceId === spaceId &&
          t.orbitSlot !== undefined &&
          t.status !== 'settled',
      )
      .sort((a, b) => pinOrderOf(a) - pinOrderOf(b))
      .forEach((t, i) => slots.set(t.id, PIN_SLOTS[i]));
  return threads.map((t) => {
    if (!slots.has(t.id)) return t;
    const slot = slots.get(t.id);
    return slot === undefined
      ? { ...t, orbitSlot: undefined, pinOrder: undefined }
      : { ...t, orbitSlot: slot };
  });
}

const isRemote = (id: string) => !!parseRemoteThreadId(id);

/**
 * A `reorder` over the merged list, as each side applies it: this computer's `reorder` of its own threads, then its pins' keys as
 * the merged order gave them (`pin-at`), and this screen's pins on other computers' threads.
 */
export function reorderAcross(
  merged: Thread[],
  action: Extract<Action, { type: 'reorder' }>,
  pins: readonly RemotePin[],
): { local: Action[]; pins: RemotePin[] } | null {
  const { pinned, unpinned, at } = action;
  if (pinned.length > PIN_SLOTS.length) return null;
  const after = reorderThreads(merged, pinned, unpinned, at);
  const keyOf = (id: string) => after.find((t) => t.id === id)?.pinOrder;
  const local: Action[] = [
    {
      type: 'reorder',
      pinned: pinned.filter((id) => !isRemote(id)),
      unpinned: unpinned.filter((id) => !isRemote(id)),
      at,
    },
    ...pinned
      .filter((id) => !isRemote(id))
      .flatMap((threadId): Action[] => {
        const order = keyOf(threadId);
        return order === undefined ? [] : [{ type: 'pin-at', threadId, order }];
      }),
  ];
  const listed = new Set([...pinned, ...unpinned]);
  const next = [
    ...pins.filter((p) => !listed.has(p.id)),
    ...pinned.filter(isRemote).flatMap((id) => {
      const order = keyOf(id);
      return order === undefined ? [] : [{ id, order }];
    }),
  ];
  return { local, pins: next };
}

/** A `pin-at` on another computer's thread: this screen's pins with it at `order`; null when Pinned is full. */
export function pinAcross(
  merged: Thread[],
  threadId: string,
  order: number,
  pins: readonly RemotePin[],
): RemotePin[] | null {
  const thread = merged.find((t) => t.id === threadId);
  if (!thread) return [...pins];
  if (!pinAt(merged, thread.spaceId, threadId, order)) return null;
  return [...pins.filter((p) => p.id !== threadId), { id: threadId, order }];
}

/** The thread ids an action names: its thread, its threads, or the thread it opens. */
function threadIdsOf(action: Action): string[] {
  if ('threadIds' in action && Array.isArray(action.threadIds))
    return action.threadIds;
  if ('threadId' in action && typeof action.threadId === 'string')
    return [action.threadId];
  if (
    'view' in action &&
    action.view?.kind === 'thread' &&
    typeof action.view.id === 'string'
  )
    return [action.view.id];
  return [];
}

/**
 * Where an action over the merged list goes: `machineId` null for this computer. One naming threads on several computers
 * (a bulk delete) splits into one action per computer; everything else goes whole.
 */
export function splitByMachine(
  action: Action,
): { machineId: string | null; action: Action }[] {
  const ids = threadIdsOf(action);
  const machineOf = (id: string) => parseRemoteThreadId(id)?.machineId ?? null;
  const machines = [...new Set(ids.map(machineOf))];
  if (machines.length === 0) return [{ machineId: null, action }];
  if (machines.length === 1) return [{ machineId: machines[0], action }];
  if (!('threadIds' in action)) return [{ machineId: machines[0], action }];
  return machines.map((machineId) => ({
    machineId,
    action: {
      ...action,
      threadIds: ids.filter((id) => machineOf(id) === machineId),
    } as Action,
  }));
}
