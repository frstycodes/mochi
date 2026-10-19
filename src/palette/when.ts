import { findLeaf, leaves, type View } from '../layout/tree.ts';
import { isMultiTab, type PaneTab, type Thread } from '../model.ts';
import { autofixPr } from '../git/autofixToggle.ts';
import { pinnedThreads } from '../reorder.ts';
import { reviewThreads } from '../review/order.ts';
import type { State } from '../store/index.tsx';

/** What an action runs on. The palette scopes to the focused split; a context menu scopes to the row, card, split or tab it was opened on. */
export interface ActionScope {
  thread: Thread | undefined;
  /** False when a menu targets a thread other than the focused split's, so "Open" only shows where it would navigate. */
  isFocused: boolean;
  /** The menu was opened on the thread's sidebar row. */
  isRow: boolean;
  isPinned: boolean;
  isWatched: boolean;
  isDesktop: boolean;
  /** The split actions act on: the focused one, or the split whose header was right-clicked. */
  leafId: string;
  /** The pane tab actions act on: a right-clicked tab, a tab dragged into the split, else the open pane's active tab. */
  tab: PaneTab | undefined;
  /** The thread's docked pane tabs, in strip order. */
  tabs: PaneTab[];
  spaceId: string;
  leafCount: number;
  isZoomed: boolean;
  reviewCount: number;
}

export interface ScopeTarget {
  threadId?: string;
  leafId?: string;
  tabId?: string;
  isRow?: boolean;
}

type Rule = (scope: ActionScope) => boolean;

const isLive: Rule = (s) => !!s.thread && s.thread.status !== 'settled';
const tabIndex = (s: ActionScope) => (s.tab ? s.tabs.indexOf(s.tab) : -1);

export const when = {
  thread: (s: ActionScope) => !!s.thread,
  liveThread: isLive,
  unfocusedThread: (s: ActionScope) => !!s.thread && !s.isFocused,
  settledThread: (s: ActionScope) => s.thread?.status === 'settled',
  unpinned: (s: ActionScope) => isLive(s) && !s.isPinned,
  pinned: (s: ActionScope) => isLive(s) && s.isPinned,
  unwatched: (s: ActionScope) => isLive(s) && !s.isWatched,
  watched: (s: ActionScope) => !!s.thread && s.isWatched,
  repo: (s: ActionScope) => !!s.thread?.repo,
  autofixOff: (s: ActionScope) => !!s.thread && !!autofixPr(s.thread) && !autofixPr(s.thread)!.autofixSince,
  autofixOn: (s: ActionScope) => !!s.thread && !!autofixPr(s.thread)?.autofixSince,
  worktree: (s: ActionScope) => !!s.thread?.repo && s.isDesktop,
  splits: (s: ActionScope) => s.leafCount > 1,
  /** Swap, rotate and zoom need every split on screen. */
  unzoomedSplits: (s: ActionScope) => s.leafCount > 1 && !s.isZoomed,
  zoomed: (s: ActionScope) => s.isZoomed,
  reviews: (s: ActionScope) => s.reviewCount > 0,
  otherSpace: (id: string) => (s: ActionScope) => s.spaceId !== id,
  tab: (s: ActionScope) => !!s.tab,
  /** A tab of a pane that holds several (Preview, side chat): it can be duplicated. */
  multiTab: (s: ActionScope) => !!s.tab && isMultiTab(s.tab.kind),
  /** Browser tabs float only while an agent drives them. */
  poppableTab: (s: ActionScope) => !!s.tab && s.tab.kind !== 'browser',
  browserTab: (s: ActionScope) => s.tab?.kind === 'browser',
  /** A browser tab showing a web page, not about:blank. */
  webTab: (s: ActionScope) => s.tab?.kind === 'browser' && /^https?:/i.test(s.tab.url ?? ''),
  otherTabs: (s: ActionScope) => tabIndex(s) >= 0 && s.tabs.length > 1,
  tabsToRight: (s: ActionScope) => tabIndex(s) >= 0 && tabIndex(s) < s.tabs.length - 1,
};

export function available<T extends { id: string; when?: Rule }>(actions: readonly T[], scope: ActionScope) {
  return actions.filter((a) => !a.when || a.when(scope));
}

/** A bulk menu item over several targets: which scopes its rule allows and which it doesn't. Enabled only when `skipped` is empty. */
export function splitByRule(rule: Rule | undefined, scopes: ActionScope[]) {
  const applies = scopes.filter((s) => !rule || rule(s));
  return { applies, skipped: scopes.filter((s) => !applies.includes(s)) };
}

const IS_DESKTOP = typeof window !== 'undefined' && !!window.harnessHost;

export function scopeOf(state: State, target: ScopeTarget = {}, isDesktop = IS_DESKTOP): ActionScope {
  const layout = state.layouts[state.spaceId];
  const leafId = target.leafId ?? layout.focusId;
  const view = findLeaf(layout.root, leafId)?.view;
  const threadId = target.threadId ?? threadOf(view);
  const thread = state.threads.find((t) => t.id === threadId);
  const pane = state.panes.find((p) => p.threadId === threadId);
  const tabId = target.tabId ?? (view?.kind === 'tab' ? view.tabId : !target.threadId && pane?.isOpen ? pane.activeTab : undefined);
  const tab = pane?.tabs.find((t) => t.id === tabId);
  // Close others / to the right work within the tab's own pane.
  const tabs = pane?.tabs.filter((t) => !t.isPopped && t.kind === tab?.kind) ?? [];
  return {
    thread,
    isFocused: !!thread && thread.id === threadOf(findLeaf(layout.root, layout.focusId)?.view),
    isRow: !!target.isRow,
    isPinned: !!thread && pinnedThreads(state.threads, state.spaceId).includes(thread),
    isWatched: !!thread && state.watched.includes(thread.id),
    isDesktop,
    leafId,
    tab,
    tabs,
    spaceId: state.spaceId,
    leafCount: leaves(layout.root).length,
    isZoomed: !!layout.zoomId,
    reviewCount: reviewThreads(state).length,
  };
}

function threadOf(view: View | undefined) {
  return view?.kind === 'thread' ? view.id : view?.kind === 'tab' ? view.threadId : undefined;
}
