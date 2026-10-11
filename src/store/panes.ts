import { PANE_TAB_KINDS, seedPanes, type Pane, type PaneTab, type PaneTabKind } from '../model.ts';
import type { Action, State } from './index.tsx';

export interface PanesState {
  panes: Pane[];
}

export type PanesAction =
  | { type: 'pane-toggle'; threadId: string }
  | { type: 'pane-open-tab'; threadId: string; kind: PaneTabKind; file?: { path: string; line?: number } }
  | { type: 'pane-select-tab'; threadId: string; tabId: string }
  | { type: 'pane-close-tab'; threadId: string; tabId: string }
  | { type: 'pane-pop'; threadId: string; tabId: string; isPopped: boolean }
  | { type: 'pane-reorder'; threadId: string; order: string[] };

const STORAGE_KEY = 'harness.panes.v1';

export function initialPanes(saved = loadPanes()): PanesState {
  const savedIds = new Set(saved.map((p) => p.threadId));
  return { panes: [...seedPanes().filter((p) => !savedIds.has(p.threadId)), ...saved] };
}

export function panesReducer(state: State, action: Action): State {
  switch (action.type) {
    case 'pane-toggle': {
      const pane = state.panes.find((p) => p.threadId === action.threadId);
      if (pane) return { ...state, panes: mapPane(state.panes, action.threadId, (p) => ({ ...p, isOpen: !p.isOpen })) };
      return { ...state, panes: [...state.panes, newPane(action.threadId)] };
    }
    case 'pane-open-tab': {
      const thread = state.threads.find((t) => t.id === action.threadId);
      const existing = state.panes.find((p) => p.threadId === action.threadId) ?? newPane(action.threadId);
      const tab: PaneTab = { id: nextTabId(existing.tabs), kind: action.kind, url: action.kind === 'browser' ? `localhost:3000/${thread?.repo?.branch.split('/')[1] ?? ''}` : undefined, file: action.file, title: action.file?.path.split('/').pop() };
      const tabs = existing.tabs.flatMap((t) => (t.kind !== 'new' ? [t] : t.id === existing.activeTab ? [tab] : []));
      const pane = { ...existing, isOpen: true, tabs: tabs.includes(tab) ? tabs : [...tabs, tab], activeTab: tab.id };
      return { ...state, panes: [...state.panes.filter((p) => p.threadId !== action.threadId), pane] };
    }
    case 'pane-select-tab':
      return { ...state, panes: mapPane(state.panes, action.threadId, (p) => ({ ...p, activeTab: action.tabId })) };
    case 'pane-pop':
      return {
        ...state,
        panes: mapPane(state.panes, action.threadId, (p) => {
          const tabs = p.tabs.map((t) => (t.id === action.tabId ? { ...t, isPopped: action.isPopped } : t));
          if (!action.isPopped) return { ...p, isOpen: true, tabs, activeTab: action.tabId };
          return { ...p, tabs, activeTab: p.activeTab === action.tabId ? neighbour(p.tabs, action.tabId) : p.activeTab };
        }),
      };
    case 'pane-close-tab':
      return {
        ...state,
        panes: mapPane(state.panes, action.threadId, (p) => {
          const tabs = p.tabs.filter((t) => t.id !== action.tabId);
          if (tabs.length === 0) return { ...p, isOpen: false, tabs: [], activeTab: '' };
          return { ...p, tabs, activeTab: p.activeTab === action.tabId ? neighbour(p.tabs, action.tabId) : p.activeTab };
        }),
      };
    case 'pane-reorder':
      return { ...state, panes: mapPane(state.panes, action.threadId, (p) => ({ ...p, tabs: reorderTabs(p.tabs, action.order) })) };
    default:
      return state;
  }
}

export function savePanes(panes: Pane[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(panes));
  } catch {
    // Storage blocked (private window, artifact sandbox): tabs just don't persist.
  }
}

function loadPanes(): Pane[] {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    const panes: Pane[] = raw ? JSON.parse(raw) : [];
    return panes.map((p) => ({ ...p, tabs: p.tabs.filter((t) => PANE_TAB_KINDS.includes(t.kind)) }));
  } catch {
    return [];
  }
}

function newPane(threadId: string): Pane {
  return { threadId, isOpen: true, tabs: [{ id: 'tab-1', kind: 'new' }], activeTab: 'tab-1' };
}

function nextTabId(tabs: PaneTab[]) {
  return `tab-${Math.max(0, ...tabs.map((t) => Number(t.id.split('-').pop()) || 0)) + 1}`;
}

/** The docked tab that takes over when `tabId` closes or pops out: the one to its right, else to its left, like a browser. */
function neighbour(tabs: PaneTab[], tabId: string) {
  const docked = tabs.filter((t) => !t.isPopped || t.id === tabId);
  const i = docked.findIndex((t) => t.id === tabId);
  return (docked[i + 1] ?? docked[i - 1])?.id ?? '';
}

/** Tabs listed in `order` take that order; unlisted ones (popped out) keep theirs after them. */
function reorderTabs(tabs: PaneTab[], order: string[]) {
  const rank = (t: PaneTab) => (order.includes(t.id) ? order.indexOf(t.id) : order.length);
  return [...tabs].sort((a, b) => rank(a) - rank(b));
}

function mapPane(panes: Pane[], threadId: string, fn: (p: Pane) => Pane) {
  return panes.map((p) => (p.threadId === threadId ? fn(p) : p));
}
