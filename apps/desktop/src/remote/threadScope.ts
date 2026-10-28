import type { Action, State } from '../store';

/** What another computer's thread brings from its mirror; every other slice is this window's own (panes, layouts, side chats). */
const MIRRORED_KEYS = [
  'threads',
  'seq',
  'checkpoints',
  'checkpointSeq',
  'rewindUndo',
  'forks',
  'queue',
] as const satisfies readonly (keyof State)[];

/** This window's state with the owning computer's threads in it: the store `RemoteThreadScope` hands the shared views. */
export function hybridState(local: LocalSlices, mirror: State): State {
  const mirrored = Object.fromEntries(MIRRORED_KEYS.map((k) => [k, mirror[k]]));
  return { ...local, ...(mirrored as Pick<State, MirroredKey>) };
}

type MirroredKey = (typeof MIRRORED_KEYS)[number];
export type LocalSlices = Omit<State, MirroredKey>;

/** This window's slices only, for a selector that ignores this computer's own thread traffic. */
export function localSlices(state: State): LocalSlices {
  const local: Partial<State> = { ...state };
  for (const key of MIRRORED_KEYS) delete local[key];
  return local as LocalSlices;
}

const LOCAL_ACTIONS = new Set<Action['type']>([
  'go',
  'overview-toggle',
  'watch-toggle',
  'sidechat-open',
  'sidechat-draft',
]);

/** Actions of this screen (splits, panes, what's watched) that stay here; none touches Core's projection (`DOMAIN_KEYS`). */
export const isScreenAction = (action: Action) =>
  action.type.startsWith('pane-') ||
  action.type.startsWith('layout-') ||
  LOCAL_ACTIONS.has(action.type);

/** Bookkeeping the shared views dispatch that has no meaning on the owning computer: dropped without a word. */
export const isQuietAction = (action: Action) =>
  action.type === 'drift-verdict' || action.type === 'next-move-record';
