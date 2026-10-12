import {
  buildPreset,
  closeLeaf,
  equalizeSplit,
  findLeaf,
  leaves,
  materialize,
  parentOf,
  presetSize,
  resizeSplit,
  rotateSplit,
  sameView,
  setLeafView,
  singleLayout,
  splitLeaf,
  swapLeaves,
  type Orientation,
  type Preset,
  type Side,
  type SpaceLayout,
  type View,
  type Zone,
} from '../layout/tree.ts';
import { getProfiles } from '../profiles.ts';
import { getPrefs } from '../settings/prefs.ts';
import type { Action, State } from './index.tsx';
import { showsDemoData } from '../demoData.ts';

export type { View };

export interface LayoutState {
  spaceId: string;
  /** Mirror of each space's focused leaf view: other slices and `useView` read and write this, the layout reducer keeps both in step. */
  views: Record<string, View>;
  layouts: Record<string, SpaceLayout>;
  orientation: Orientation;
  watched: string[];
  isStage: boolean;
  isOverview: boolean;
  /** Stage Manager setting: needs-you cards sort nearest the center on their side instead of strict pin order. */
  isNeedsYouNear: boolean;
}

export type LayoutAction =
  | { type: 'go'; view: View }
  | { type: 'space'; id: string }
  | { type: 'layout-split'; view: View; leafId?: string; side?: Side }
  | { type: 'layout-drop'; leafId: string; zone: Zone; view: View }
  | { type: 'layout-close'; leafId?: string }
  | { type: 'layout-focus'; leafId: string }
  | { type: 'layout-focus-step'; step: 1 | -1 }
  | { type: 'layout-zoom'; leafId?: string }
  | { type: 'layout-swap'; leafId?: string; withId?: string }
  | { type: 'layout-rotate'; leafId?: string }
  | { type: 'layout-resize'; splitId: string; sizes: number[] }
  | { type: 'layout-equalize'; splitId: string }
  | { type: 'layout-preset'; preset: Preset }
  | { type: 'layout-aspect'; orientation: Orientation }
  | { type: 'watch-toggle'; threadId: string }
  | { type: 'stage-toggle' }
  | { type: 'overview-toggle'; isOpen?: boolean }
  | { type: 'stage-needs-you-near' };

const STORAGE_KEY = 'harness.layouts.v1';

// The demo's profiles open on their demo work; every other profile opens on a new thread.
const DEMO_VIEWS: Record<string, View> = { latitude: { kind: 'thread', id: 'adm' }, personal: { kind: 'thread', id: 'lobby' }, liane: { kind: 'board' } };
const NEW_THREAD: View = { kind: 'new' };

export function initialLayout(saved: Pick<Saved, 'layouts' | 'watched'> & Partial<Saved> = loadLayouts()): LayoutState {
  const orientation = typeof window === 'undefined' ? 'row' : window.innerWidth >= window.innerHeight ? 'row' : 'column';
  const profiles = getProfiles();
  const defaults = showsDemoData() ? DEMO_VIEWS : {};
  const layouts = Object.fromEntries(profiles.map(({ id }) => [id, saved.layouts[id] ?? singleLayout(defaults[id] ?? NEW_THREAD, orientation)]));
  return { spaceId: profiles[0].id, views: mirror(layouts), layouts, orientation, watched: saved.watched, isStage: false, isOverview: false, isNeedsYouNear: saved.isNeedsYouNear ?? false };
}

export function layoutReducer(state: State, action: Action): State {
  const adopted = adoptForeignView(state);
  const next = reduce(adopted, action);
  if (next.layouts === state.layouts) return next === adopted ? state : next;
  return { ...next, views: mirror(next.layouts) };
}

function reduce(state: State, action: Action): State {
  const layout = state.layouts[state.spaceId];
  const set = (l: SpaceLayout, spaceId = state.spaceId): State => ({ ...state, layouts: { ...state.layouts, [spaceId]: l } });
  const edit = () => materialize(layout, state.orientation);

  switch (action.type) {
    case 'go': {
      const view = action.view;
      const threadId = view.kind === 'thread' ? view.id : view.kind === 'tab' ? view.threadId : undefined;
      const spaceId = threadId ? (state.threads.find((t) => t.id === threadId)?.spaceId ?? state.spaceId) : state.spaceId;
      return { ...set(openView(state.layouts[spaceId], view), spaceId), spaceId };
    }
    case 'space':
      if (state.layouts[action.id]) return { ...state, spaceId: action.id };
      return { ...set(singleLayout(NEW_THREAD, state.orientation), action.id), spaceId: action.id };
    case 'layout-split': {
      const existing = action.view.kind !== 'new' && leaves(layout.root).find((l) => sameView(l.view, action.view));
      if (existing) return set({ ...layout, focusId: existing.id, zoomId: layout.zoomId && existing.id });
      const l = edit();
      const side = action.side ?? (state.orientation === 'row' ? 'right' : 'bottom');
      const { root, leafId } = splitLeaf(l.root, action.leafId ?? l.focusId, action.view, side);
      return set({ ...l, root, focusId: leafId, zoomId: undefined });
    }
    case 'layout-drop': {
      // A view already open in another split moves: dropped in the centre the two swap, dropped on an edge it leaves its old split.
      const existing = leaves(layout.root).find((l) => sameView(l.view, action.view));
      if (existing?.id === action.leafId) return state;
      if (action.zone === 'center') {
        const root = existing ? swapLeaves(layout.root, existing.id, action.leafId) : setLeafView(layout.root, action.leafId, action.view);
        return set({ ...layout, root, focusId: action.leafId });
      }
      const l = edit();
      const base = existing ? closeLeaf(l.root, existing.id)! : l.root;
      const { root, leafId } = splitLeaf(base, action.leafId, action.view, action.zone);
      return set({ ...l, root, focusId: leafId, zoomId: undefined });
    }
    case 'layout-close': {
      const id = action.leafId ?? layout.focusId;
      const order = leaves(layout.root);
      const root = closeLeaf(layout.root, id);
      if (!root) return state;
      const i = order.findIndex((l) => l.id === id);
      const focusId = id === layout.focusId ? (order[i - 1] ?? order[i + 1]).id : layout.focusId;
      return set({ ...layout, root, focusId, zoomId: undefined });
    }
    case 'layout-focus':
      if (action.leafId === layout.focusId || !findLeaf(layout.root, action.leafId)) return state;
      return set({ ...layout, focusId: action.leafId, zoomId: layout.zoomId && action.leafId });
    case 'layout-focus-step': {
      const order = leaves(layout.root);
      const i = order.findIndex((l) => l.id === layout.focusId);
      const focusId = order.at((i + action.step) % order.length)!.id;
      return set({ ...layout, focusId, zoomId: layout.zoomId && focusId });
    }
    case 'layout-zoom': {
      if (leaves(layout.root).length < 2) return state;
      // Zooming a split that isn't focused focuses it too, or the zoomed split would show while focus stays on a hidden one.
      const id = action.leafId ?? layout.focusId;
      return set({ ...layout, zoomId: layout.zoomId ? undefined : id, focusId: layout.zoomId ? layout.focusId : id });
    }
    case 'layout-swap': {
      const order = leaves(layout.root);
      const id = action.leafId ?? layout.focusId;
      const i = order.findIndex((l) => l.id === id);
      const withId = action.withId ?? order[(i + 1) % order.length].id;
      if (withId === id) return state;
      return set({ ...layout, root: swapLeaves(layout.root, id, withId), focusId: layout.focusId === id ? withId : layout.focusId });
    }
    case 'layout-rotate': {
      const l = edit();
      const target = parentOf(l.root, action.leafId ?? l.focusId) ?? l.root;
      if (target.kind === 'leaf') return state;
      return set({ ...l, root: rotateSplit(l.root, target.id), isAuto: false });
    }
    case 'layout-resize':
      return set({ ...layout, root: resizeSplit(layout.root, action.splitId, action.sizes) });
    case 'layout-equalize':
      return set({ ...layout, root: equalizeSplit(layout.root, action.splitId) });
    case 'layout-preset': {
      const views = presetViews(state, presetSize(action.preset));
      const root = buildPreset(action.preset, views, state.orientation);
      const isFixed = action.preset === '3-columns' || action.preset === 'stack-3';
      return set({ root, focusId: leaves(root)[0].id, builtFor: state.orientation, isAuto: !isFixed });
    }
    case 'layout-aspect':
      return action.orientation === state.orientation ? state : { ...state, orientation: action.orientation };
    case 'watch-toggle': {
      const isWatched = state.watched.includes(action.threadId);
      return { ...state, watched: isWatched ? state.watched.filter((id) => id !== action.threadId) : [...state.watched, action.threadId] };
    }
    case 'stage-toggle':
      return { ...state, isStage: !state.isStage };
    case 'overview-toggle':
      return { ...state, isOverview: action.isOpen ?? !state.isOverview };
    case 'stage-needs-you-near':
      return { ...state, isNeedsYouNear: !state.isNeedsYouNear };
    default:
      return state;
  }
}

/** Going somewhere already open in a split focuses that split instead of opening it twice. */
function openView(layout: SpaceLayout, view: View): SpaceLayout {
  const existing = leaves(layout.root).find((l) => sameView(l.view, view));
  if (existing) return { ...layout, focusId: existing.id, zoomId: layout.zoomId && existing.id };
  return { ...layout, root: setLeafView(layout.root, layout.focusId, view) };
}

/** Another slice (a new thread) wrote `views` directly: move that view into the focused leaf. */
function adoptForeignView(state: State): State {
  const layout = state.layouts[state.spaceId];
  const view = state.views[state.spaceId];
  const focused = findLeaf(layout.root, layout.focusId);
  if (!focused || !view || focused.view === view) return state;
  return { ...state, layouts: { ...state.layouts, [state.spaceId]: { ...layout, root: setLeafView(layout.root, layout.focusId, view) } } };
}

function mirror(layouts: Record<string, SpaceLayout>) {
  return Object.fromEntries(Object.entries(layouts).map(([id, l]) => [id, findLeaf(l.root, l.focusId)?.view ?? leaves(l.root)[0].view]));
}

/** Preset fill order: the focused view, then pinned threads in pin order, then other active threads. */
function presetViews(state: State, count: number): View[] {
  const layout = state.layouts[state.spaceId];
  const focused = findLeaf(layout.root, layout.focusId)!.view;
  const threads = state.threads.filter((t) => t.spaceId === state.spaceId && t.status !== 'settled');
  const ranked = [...threads.filter((t) => t.orbitSlot !== undefined).sort((a, b) => a.orbitSlot! - b.orbitSlot!), ...threads.filter((t) => t.orbitSlot === undefined)];
  const views: View[] = [focused];
  for (const t of ranked) {
    const v: View = { kind: 'thread', id: t.id };
    if (!views.some((x) => sameView(x, v))) views.push(v);
  }
  return views.slice(0, count);
}

type Saved = Pick<LayoutState, 'layouts' | 'watched' | 'isNeedsYouNear'>;

export function saveLayouts(state: Saved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ layouts: state.layouts, watched: state.watched, isNeedsYouNear: state.isNeedsYouNear }));
  } catch {
    // Storage blocked (private window, artifact preview): layouts just don't persist.
  }
}

function loadLayouts(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    const saved = getPrefs().restoreLayout ? (raw?.layouts ?? {}) : {};
    const layouts = Object.fromEntries(Object.entries(saved).filter(([, l]) => isValidLayout(l))) as Record<string, SpaceLayout>;
    return { layouts, watched: Array.isArray(raw?.watched) ? raw.watched : [], isNeedsYouNear: raw?.isNeedsYouNear === true };
  } catch {
    return { layouts: {}, watched: [], isNeedsYouNear: false };
  }
}

function isValidLayout(l: unknown): l is SpaceLayout {
  const layout = l as SpaceLayout;
  return !!layout?.root && typeof layout.focusId === 'string' && !!findLeaf(layout.root, layout.focusId);
}
