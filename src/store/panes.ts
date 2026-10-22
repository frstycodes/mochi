import { persistedSlice } from '../lib/uiStorage.ts';
import { isMultiTab, PANE_TAB_KINDS, seedPanes, type Pane, type PaneTab, type PaneTabKind, type PaneVisual } from '../model.ts';
import { closeKind, EMPTY_LAYOUT, moveKind, openKind, type PaneLayout } from '../pane/layout.ts';
import type { Action, State } from './index.tsx';
import { showsDemoData } from '../demoData.ts';
import { runningBackground } from '../runtime/subagents.ts';
import { defaultBrowserUrl, listeningPorts } from '../terminal/devServer.ts';

export interface PanesState {
  panes: Pane[];
}

export type PanesAction =
  | { type: 'pane-toggle'; threadId: string }
  /** Opens the kind's pane with a tab: multi-tab kinds always get a new one, the others reuse theirs (a Files pane switches to `file`). `isPopped` adds it as a floating window, `isBackground` without touching the layout; both leave the selection as it is (a thread with no pane gets a closed one). `tabId` names the new tab up front, for a caller that keys state by it before the reducer runs. */
  | { type: 'pane-open-tab'; threadId: string; kind: PaneTabKind; url?: string; file?: { path: string; line?: number }; title?: string; visual?: PaneVisual; isPopped?: boolean; isBackground?: boolean; tabId?: string }
  /** Shows the tab in its pane, opening and focusing the pane. */
  | { type: 'pane-select-tab'; threadId: string; tabId: string }
  /** The thread's pane of this kind, open and focused; a new tab when there is none. */
  | { type: 'pane-show-tab'; threadId: string; kind: PaneTabKind }
  | { type: 'pane-close-tab'; threadId: string; tabId: string }
  | { type: 'pane-close-tabs'; threadId: string; tabIds: string[] }
  /** Closes the pane but keeps its tabs (terminals, pages), so opening it again picks up where it was. */
  | { type: 'pane-close-kind'; threadId: string; kind: PaneTabKind }
  | { type: 'pane-focus-kind'; threadId: string; kind: PaneTabKind }
  | { type: 'pane-expand'; threadId: string; kind: PaneTabKind | undefined }
  | { type: 'pane-move-kind'; threadId: string; kind: PaneTabKind; col: number; row: number }
  | { type: 'pane-resize'; threadId: string; patch: Pick<PaneLayout, 'weights' | 'share' | 'columnWeights'> }
  | { type: 'pane-restore'; pane: Pane }
  | { type: 'pane-pop'; threadId: string; tabId: string; isPopped: boolean }
  | { type: 'pane-drive'; threadId: string; tabId: string | undefined }
  | { type: 'pane-reorder'; threadId: string; order: string[] }
  | { type: 'pane-update-tab'; threadId: string; tabId: string; patch: Pick<PaneTab, 'url' | 'title'> }
  /** The thread's Background tasks pane, open on this task's page (an agent's transcript, a command's output), or on the list when `subagentId` (any task's id) is unset. */
  | { type: 'pane-show-agent'; threadId: string; subagentId?: string };

const STORAGE_KEY = 'harness.panes.v1';
const storageSlice = persistedSlice<Pane[]>(STORAGE_KEY, []);

export function initialPanes(saved = loadPanes()): PanesState {
  const savedIds = new Set(saved.map((p) => p.threadId));
  const demo = showsDemoData() ? seedPanes() : [];
  return { panes: [...demo.filter((p) => !savedIds.has(p.threadId)), ...saved] };
}

export function panesReducer(state: State, action: Action): State {
  switch (action.type) {
    case 'pane-toggle': {
      const pane = state.panes.find((p) => p.threadId === action.threadId);
      if (pane) return { ...state, panes: mapPane(state.panes, action.threadId, (p) => ({ ...p, isOpen: !p.isOpen })) };
      return { ...state, panes: [...state.panes, { ...emptyPane(action.threadId), isOpen: true }] };
    }
    case 'pane-open-tab': {
      const current = state.panes.find((p) => p.threadId === action.threadId);
      const existing = current ?? emptyPane(action.threadId);
      const sameVisual = action.visual && existing.tabs.find((t) => t.visual?.language === action.visual!.language && t.visual.code === action.visual!.code);
      // The same chat visual opened again goes to its tab (docked, or popped out to match) instead of a duplicate.
      if (sameVisual) return !!sameVisual.isPopped && !!action.isPopped ? state : panesReducer(state, { type: 'pane-pop', threadId: action.threadId, tabId: sameVisual.id, isPopped: !!action.isPopped });
      const reused = !isMultiTab(action.kind) && !action.isPopped ? existing.tabs.find((t) => t.kind === action.kind && !t.isPopped) : undefined;
      if (reused) {
        const patched = action.file ? { ...reused, file: action.file, title: action.title ?? action.file.path.split('/').pop() } : reused;
        const tabs = existing.tabs.map((t) => (t.id === reused.id ? patched : t));
        const pane = action.isBackground ? { ...existing, tabs } : select({ ...existing, tabs }, reused.id);
        return { ...state, panes: upsert(state.panes, pane) };
      }
      const tab: PaneTab = {
        id: action.tabId ?? nextTabId(existing.tabs),
        kind: action.kind,
        url: action.url ?? (action.kind === 'browser' ? defaultBrowserUrl(listeningPorts(action.threadId)) : undefined),
        file: action.file,
        title: action.title ?? action.file?.path.split('/').pop(),
        ...(action.visual && { visual: action.visual }),
      };
      if (action.isPopped) return { ...state, panes: upsert(state.panes, { ...existing, tabs: [...existing.tabs, { ...tab, isPopped: true }] }) };
      if (action.isBackground) return { ...state, panes: upsert(state.panes, { ...existing, tabs: [...existing.tabs, tab], activeTab: existing.activeTab || tab.id }) };
      return { ...state, panes: upsert(state.panes, select({ ...existing, tabs: [...existing.tabs, tab] }, tab.id)) };
    }
    case 'pane-show-tab': {
      const pane = state.panes.find((p) => p.threadId === action.threadId);
      const tab = pane && (shownTab(pane, action.kind) ?? pane.tabs.find((t) => t.kind === action.kind && !t.isPopped));
      if (!tab) return panesReducer(state, { type: 'pane-open-tab', threadId: action.threadId, kind: action.kind });
      return { ...state, panes: mapPane(state.panes, action.threadId, (p) => select(p, tab.id)) };
    }
    case 'layout-return-tab':
    case 'pane-select-tab':
      return { ...state, panes: mapPane(state.panes, action.threadId, (p) => select(p, action.tabId)) };
    case 'pane-focus-kind':
      return { ...state, panes: mapPane(state.panes, action.threadId, (p) => ({ ...p, activeTab: shownTab(p, action.kind)?.id ?? p.activeTab, layout: { ...layoutOf(p), focused: action.kind } })) };
    case 'pane-close-kind':
      return { ...state, panes: mapPane(state.panes, action.threadId, (p) => withLayout(p, closeKind(layoutOf(p), action.kind))) };
    case 'pane-expand':
      return { ...state, panes: mapPane(state.panes, action.threadId, (p) => ({ ...p, layout: { ...layoutOf(p), expanded: action.kind, ...(action.kind && { focused: action.kind }) } })) };
    case 'pane-move-kind':
      return { ...state, panes: mapPane(state.panes, action.threadId, (p) => ({ ...p, layout: moveKind(layoutOf(p), action.kind, action.col, action.row) })) };
    case 'pane-resize':
      return { ...state, panes: mapPane(state.panes, action.threadId, (p) => ({ ...p, layout: { ...layoutOf(p), ...action.patch } })) };
    case 'pane-drive':
      return { ...state, panes: mapPane(state.panes, action.threadId, (p) => ({ ...p, drivenTab: action.tabId })) };
    case 'pane-pop':
      return {
        ...state,
        panes: mapPane(state.panes, action.threadId, (p) => {
          const tabs = p.tabs.map((t) => (t.id === action.tabId ? { ...t, isPopped: action.isPopped } : t));
          if (!action.isPopped) return select({ ...p, tabs }, action.tabId);
          return withoutTab({ ...p, tabs }, action.tabId, tabs);
        }),
      };
    case 'pane-close-tab':
      return { ...state, panes: mapPane(state.panes, action.threadId, (p) => withoutTab(p, action.tabId, p.tabs.filter((t) => t.id !== action.tabId))) };
    case 'pane-close-tabs':
      return action.tabIds.reduce((s, tabId) => panesReducer(s, { type: 'pane-close-tab', threadId: action.threadId, tabId }), state);
    case 'pane-restore':
      return { ...state, panes: mapPane(state.panes, action.pane.threadId, () => action.pane) };
    case 'pane-reorder':
      return { ...state, panes: mapPane(state.panes, action.threadId, (p) => ({ ...p, tabs: reorderTabs(p.tabs, action.order) })) };
    case 'delete':
      return { ...state, panes: state.panes.filter((p) => !action.threadIds.includes(p.threadId)) };
    case 'pane-show-agent': {
      const shown = panesReducer(state, { type: 'pane-show-tab', threadId: action.threadId, kind: 'agents' });
      return { ...shown, panes: mapPane(shown.panes, action.threadId, (p) => ({ ...p, reveals: (p.reveals ?? 0) + 1, tabs: p.tabs.map((t) => (t.kind === 'agents' ? { ...t, isPopped: false, agentId: action.subagentId } : t)) })) };
    }
    case 'agent':
    case 'bg-start': {
      const threadId = action.type === 'agent' ? action.event.threadId : action.threadId;
      const isStart = action.type === 'bg-start' || (action.event.type === 'subagent' && (action.event.phase === 'start' || action.event.isBackground === true));
      return isStart ? withAgentsTab(state, threadId) : state;
    }
    case 'tick': {
      // Demo threads report inside the tick: an agent started this minute logged its row at `now`.
      const started = state.threads.filter((t) => t.activity.some((a) => a.kind === 'subagent' && a.at === state.now));
      return started.reduce((s, t) => withAgentsTab(s, t.id), state);
    }
    case 'pane-update-tab':
      return { ...state, panes: mapPane(state.panes, action.threadId, (p) => ({ ...p, tabs: p.tabs.map((t) => (t.id === action.tabId ? { ...t, ...action.patch } : t)) })) };
    default:
      return state;
  }
}

/** The tab each pane shows: a multi-tab pane's pick, else its first docked tab. */
export function shownTab(pane: Pane, kind: PaneTabKind) {
  const docked = pane.tabs.filter((t) => t.kind === kind && !t.isPopped);
  return docked.find((t) => t.id === pane.shown?.[kind]) ?? docked[0];
}

/** Whether a tab is in front in its open pane. GAP: a pane folded to its header or hidden behind an expanded one still counts. */
export function isTabOnScreen(pane: Pane, tab: PaneTab) {
  return pane.isOpen && layoutOf(pane).columns.flat().includes(tab.kind) && shownTab(pane, tab.kind)?.id === tab.id;
}

export function layoutOf(pane: Pane): PaneLayout {
  return pane.layout ?? EMPTY_LAYOUT;
}

/** Shows `tabId` in its pane, opening and focusing that pane and the column. */
function select(pane: Pane, tabId: string): Pane {
  const tab = pane.tabs.find((t) => t.id === tabId);
  if (!tab) return pane;
  return { ...pane, isOpen: true, activeTab: tabId, shown: { ...pane.shown, [tab.kind]: tabId }, layout: openKind(layoutOf(pane), tab.kind) };
}

/** After `tabId` leaves the docked tabs: its pane shows a neighbour, or closes when it was the last of its kind. */
function withoutTab(pane: Pane, tabId: string, tabs: PaneTab[]): Pane {
  const tab = pane.tabs.find((t) => t.id === tabId);
  if (!tab) return pane;
  const sameKind = pane.tabs.filter((t) => t.kind === tab.kind && (!t.isPopped || t.id === tabId));
  const i = sameKind.findIndex((t) => t.id === tabId);
  const next = (sameKind[i + 1] ?? sameKind[i - 1])?.id;
  const kept = { ...pane, tabs, shown: { ...pane.shown, [tab.kind]: next } };
  if (next) return { ...kept, activeTab: pane.activeTab === tabId ? next : pane.activeTab };
  return withLayout(kept, closeKind(layoutOf(pane), tab.kind));
}

/** A layout change that may have closed panes: the last tab picked follows focus, and no panes left hides the column. */
function withLayout(pane: Pane, layout: PaneLayout): Pane {
  const focused = layout.focused && shownTab(pane, layout.focused);
  return { ...pane, layout, activeTab: focused?.id ?? '', isOpen: pane.isOpen && layout.columns.length > 0 };
}

export function savePanes(panes: Pane[]) {
  storageSlice.setState({ value: panes });
}

function loadPanes(): Pane[] {
  try {
    const panes = storageSlice.getState().value;
    // Browser tabs float only while an agent drives them, so an old manual pop-out goes back in the pane.
    return panes.map((p) => migrate({ ...p, tabs: p.tabs.filter((t) => PANE_TAB_KINDS.includes(t.kind)).map((t) => (t.kind === 'browser' ? { ...t, isPopped: false } : t)) }));
  } catch {
    return [];
  }
}

/** Panes saved before panes had a layout showed one tab at a time: that tab's pane opens, the other tabs wait closed. */
function migrate(pane: Pane): Pane {
  if (pane.layout) return pane;
  const active = pane.tabs.find((t) => t.id === pane.activeTab && !t.isPopped) ?? pane.tabs.find((t) => !t.isPopped);
  const shown = Object.fromEntries(pane.tabs.filter((t) => isMultiTab(t.kind)).map((t) => [t.kind, t.id]));
  const layout = active ? openKind(EMPTY_LAYOUT, active.kind) : EMPTY_LAYOUT;
  return { ...pane, layout, shown: active ? { ...shown, [active.kind]: active.id } : shown, activeTab: active?.id ?? '', isOpen: pane.isOpen && !!active };
}

/**
 * The first background agent of a thread adds its Background tasks tab: the pane opens if it was closed, but whatever tab you were
 * on stays in front. Runs after the threads slice, so the agent is already counted.
 */
function withAgentsTab(state: State, threadId: string): State {
  const thread = state.threads.find((t) => t.id === threadId);
  const pane = state.panes.find((p) => p.threadId === threadId) ?? emptyPane(threadId);
  if (!thread || runningBackground(thread) !== 1 || pane.tabs.some((t) => t.kind === 'agents')) return state;
  const tab: PaneTab = { id: nextTabId(pane.tabs), kind: 'agents' };
  const layout = layoutOf(pane);
  const opened = openKind(layout, 'agents');
  const keepFocus = layout.focused ?? 'agents';
  return { ...state, panes: upsert(state.panes, { ...pane, isOpen: true, tabs: [...pane.tabs, tab], activeTab: pane.activeTab || tab.id, layout: { ...opened, focused: keepFocus } }) };
}

function emptyPane(threadId: string): Pane {
  return { threadId, isOpen: false, tabs: [], activeTab: '', layout: EMPTY_LAYOUT };
}

function upsert(panes: Pane[], pane: Pane) {
  return [...panes.filter((p) => p.threadId !== pane.threadId), pane];
}

export function nextTabId(tabs: PaneTab[]) {
  return `tab-${Math.max(0, ...tabs.map((t) => Number(t.id.split('-').pop()) || 0)) + 1}`;
}

/** Tabs listed in `order` take that order; unlisted ones (popped out) keep theirs after them. */
function reorderTabs(tabs: PaneTab[], order: string[]) {
  const rank = (t: PaneTab) => (order.includes(t.id) ? order.indexOf(t.id) : order.length);
  return [...tabs].sort((a, b) => rank(a) - rank(b));
}

function mapPane(panes: Pane[], threadId: string, fn: (p: Pane) => Pane) {
  return panes.map((p) => (p.threadId === threadId ? fn(p) : p));
}
