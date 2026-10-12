import type { Dispatch } from 'react';
import { Archive, ArrowRight, ArrowSwapHorizontal, BranchUp, CloseSquare, Copy, Edit, ExitFullscreen, Eye, EyeSlash, FolderOpen, Fullscreen, Grid, History, Inbox, Layers, Monitor, Moon, Pause, Pin, PinOff, Pip, Play, Refresh, Rotation, Route, Routing, RowHorizontal, RowVertical, Sidebar, SidebarRight, Sun, TaskSquare, TransferH, X, type IconComponent } from 'reicon-react';
import { toast } from 'sonner';
import { pageKey, reloadPage } from '../browser/pages';
import { host } from '../host';
import { threadCwd } from '../host/cwd';
import { PRESETS, PRESET_LABELS } from '../layout/tree';
import { SPACES, type Thread } from '../model';
import { PANE_TABS } from '../pane/tabs';
import { openRewind } from '../rewind/requests';
import { togglePin } from '../reorder';
import type { Action, State } from '../store';
import { toggleSettle } from '../useSettle';
import { when, type ActionScope } from './when';
import { IS_MAC, type Key } from '../keys';
import type { PaneTab } from '../model';

export const ACTION_GROUPS = ['Go to', 'Thread', 'Side pane', 'Layout', 'Space', 'Appearance'] as const;

export interface ActionContext {
  state: State;
  dispatch: Dispatch<Action>;
  scope: ActionScope;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  openReview: () => void;
}

export interface PaletteAction {
  id: string;
  group: (typeof ACTION_GROUPS)[number];
  title: string;
  icon: IconComponent;
  keywords?: string;
  shortcut?: Key[];
  when?: (scope: ActionScope) => boolean;
  run: (ctx: ActionContext) => void;
}

/** Every app action mod K and the context menus can run. A new feature adds one entry here; `when` hides it where it would do nothing, and `run` acts on `scope`, never on the focused split directly. */
export const ACTIONS = [
  { id: 'go-queue', group: 'Go to', title: 'Queue', icon: Inbox, run: ({ dispatch }) => dispatch({ type: 'go', view: { kind: 'queue' } }) },
  { id: 'go-review', group: 'Go to', title: 'Review mode', icon: TaskSquare, keywords: 'inbox approve', when: when.reviews, run: ({ openReview }) => openReview() },
  { id: 'go-board', group: 'Go to', title: 'Board', icon: Route, run: ({ dispatch }) => dispatch({ type: 'go', view: { kind: 'board' } }) },
  { id: 'go-new', group: 'Go to', title: 'New thread', icon: Edit, shortcut: ['N'], run: ({ dispatch }) => dispatch({ type: 'go', view: { kind: 'new' } }) },

  { id: 'thread-open', group: 'Thread', title: 'Open thread', icon: ArrowRight, when: when.unfocusedThread, run: onThread((t, { dispatch }) => dispatch({ type: 'go', view: { kind: 'thread', id: t.id } })) },
  { id: 'thread-open-split', group: 'Thread', title: 'Open in new split', icon: RowVertical, when: when.unfocusedThread, run: onThread((t, { dispatch }) => dispatch({ type: 'layout-split', view: { kind: 'thread', id: t.id } })) },
  { id: 'thread-settle', group: 'Thread', title: 'Settle thread', icon: Archive, when: when.liveThread, run: onThread((t, { dispatch }) => toggleSettle(t, dispatch)) },
  { id: 'thread-reactivate', group: 'Thread', title: 'Reactivate thread', icon: Refresh, when: when.settledThread, run: onThread((t, { dispatch }) => toggleSettle(t, dispatch)) },
  { id: 'thread-pin', group: 'Thread', title: 'Pin thread', icon: Pin, shortcut: ['mod', 'shift', 'P'], when: when.unpinned, run: onThread(pin) },
  { id: 'thread-unpin', group: 'Thread', title: 'Unpin thread', icon: PinOff, shortcut: ['mod', 'shift', 'P'], when: when.pinned, run: onThread(pin) },
  { id: 'thread-rewind', group: 'Thread', title: 'Rewind to a checkpoint', icon: History, keywords: 'undo restore', when: when.liveThread, run: inThread((t) => openRewind({ kind: 'rewind', threadId: t.id })) },
  { id: 'thread-fork', group: 'Thread', title: 'Fork thread', icon: Routing, keywords: 'branch alternative', when: when.liveThread, run: inThread((t) => openRewind({ kind: 'fork', threadId: t.id })) },
  { id: 'thread-handoff', group: 'Thread', title: 'Hand off to another agent', icon: TransferH, keywords: 'claude codex switch', when: when.liveThread, run: inThread((t) => openRewind({ kind: 'handoff', threadId: t.id })) },
  { id: 'thread-watch', group: 'Thread', title: 'Watch thread', icon: Eye, keywords: 'notify follow', when: when.unwatched, run: onThread(watch) },
  { id: 'thread-unwatch', group: 'Thread', title: 'Stop watching', icon: EyeSlash, keywords: 'notify follow', when: when.watched, run: onThread(watch) },
  { id: 'thread-copy-branch', group: 'Thread', title: 'Copy branch name', icon: BranchUp, when: when.repo, run: onThread((t) => copy(t.repo!.branch, 'Copied branch name')) },
  { id: 'thread-reveal', group: 'Thread', title: IS_MAC ? 'Reveal worktree in Finder' : 'Show worktree in file manager', icon: FolderOpen, when: when.worktree, run: onThread((t) => void host.fs.reveal(threadCwd(t)!, '').catch((e: Error) => toast.error('Could not reveal the worktree', { description: e.message }))) },
  { id: 'thread-summary', group: 'Thread', title: 'Toggle summary', icon: SidebarRight, when: when.thread, run: ({ state }) => clickInFocusedSplit(state, 'Thread summary') },

  { id: 'pane-toggle', group: 'Side pane', title: 'Toggle side pane', icon: Sidebar, when: when.thread, run: onThread((t, { dispatch }) => dispatch({ type: 'pane-toggle', threadId: t.id })) },
  ...(['browser', 'changes', 'terminal', 'files', 'simulator', 'ports', 'sidechat'] as const).map(
    (kind) =>
      ({
        id: `pane-open-${kind}`,
        group: 'Side pane',
        title: `Open ${PANE_TABS[kind].title}`,
        icon: PANE_TABS[kind].icon,
        keywords: 'tab',
        when: when.thread,
        run: onThread((t, { dispatch }) => dispatch({ type: 'pane-open-tab', threadId: t.id, kind })),
      }) satisfies PaletteAction,
  ),
  { id: 'tab-close', group: 'Side pane', title: 'Close tab', icon: X, shortcut: ['mod', 'W'], when: when.tab, run: onTab((tab, t, { dispatch }) => dispatch({ type: 'pane-close-tab', threadId: t.id, tabId: tab.id })) },
  { id: 'tab-close-others', group: 'Side pane', title: 'Close other tabs', icon: CloseSquare, when: when.otherTabs, run: onTab((tab, t, ctx) => closeTabs(t.id, ctx.scope.tabs.filter((x) => x !== tab), ctx)) },
  { id: 'tab-close-right', group: 'Side pane', title: 'Close tabs to the right', icon: CloseSquare, when: when.tabsToRight, run: onTab((tab, t, ctx) => closeTabs(t.id, ctx.scope.tabs.slice(ctx.scope.tabs.indexOf(tab) + 1), ctx)) },
  { id: 'tab-reload', group: 'Side pane', title: 'Reload page', icon: Refresh, when: when.browserTab, run: onTab((tab, t) => reloadPage(pageKey(t.id, tab.id))) },
  { id: 'tab-duplicate', group: 'Side pane', title: 'Duplicate tab', icon: Copy, when: when.contentTab, run: onTab((tab, t, { dispatch }) => dispatch({ type: 'pane-open-tab', threadId: t.id, kind: tab.kind, url: tab.url, file: tab.file })) },
  { id: 'tab-pop', group: 'Side pane', title: 'Pop out into a floating window', icon: Pip, when: when.contentTab, run: onTab((tab, t, { dispatch }) => dispatch({ type: 'pane-pop', threadId: t.id, tabId: tab.id, isPopped: true })) },
  { id: 'tab-split', group: 'Side pane', title: 'Move tab to a new split', icon: RowVertical, when: when.contentTab, run: onTab((tab, t, { dispatch }) => dispatch({ type: 'layout-split', view: { kind: 'tab', threadId: t.id, tabId: tab.id } })) },
  { id: 'pane-dev-server', group: 'Side pane', title: 'Run a dev server', icon: Play, keywords: 'ports start npm pnpm', when: when.repo, run: onThread((t, { dispatch }) => dispatch({ type: 'pane-open-tab', threadId: t.id, kind: 'ports' })) },

  ...PRESETS.map((preset) => ({ id: `layout-${preset}`, group: 'Layout', title: `Layout: ${PRESET_LABELS[preset]}`, icon: Grid, run: ({ dispatch }) => dispatch({ type: 'layout-preset', preset }) }) satisfies PaletteAction),
  { id: 'layout-stage', group: 'Layout', title: 'Toggle Stage Manager', icon: Layers, shortcut: ['mod', 'shift', 'S'], run: ({ dispatch }) => dispatch({ type: 'stage-toggle' }) },
  { id: 'layout-overview', group: 'Layout', title: 'Show all sessions', icon: Grid, shortcut: ['mod', 'up'], keywords: 'overview mission control', run: ({ dispatch }) => dispatch({ type: 'overview-toggle', isOpen: true }) },
  { id: 'layout-split', group: 'Layout', title: 'Split right', icon: RowVertical, shortcut: ['mod', '\\'], run: ({ dispatch, scope }) => dispatch({ type: 'layout-split', view: { kind: 'new' }, leafId: scope.leafId }) },
  { id: 'layout-split-down', group: 'Layout', title: 'Split down', icon: RowHorizontal, run: ({ dispatch, scope }) => dispatch({ type: 'layout-split', view: { kind: 'new' }, leafId: scope.leafId, side: 'bottom' }) },
  { id: 'layout-rotate', group: 'Layout', title: 'Rotate split', icon: Rotation, when: when.unzoomedSplits, run: ({ dispatch, scope }) => dispatch({ type: 'layout-rotate', leafId: scope.leafId }) },
  { id: 'layout-swap', group: 'Layout', title: 'Swap with next split', icon: ArrowSwapHorizontal, when: when.unzoomedSplits, run: ({ dispatch, scope }) => dispatch({ type: 'layout-swap', leafId: scope.leafId }) },
  { id: 'layout-zoom', group: 'Layout', title: 'Zoom split', icon: Fullscreen, shortcut: ['mod', 'shift', 'Enter'], when: when.unzoomedSplits, run: ({ dispatch, scope }) => dispatch({ type: 'layout-zoom', leafId: scope.leafId }) },
  { id: 'layout-unzoom', group: 'Layout', title: 'Show all splits', icon: ExitFullscreen, shortcut: ['mod', 'shift', 'Enter'], when: when.zoomed, run: ({ dispatch }) => dispatch({ type: 'layout-zoom' }) },
  { id: 'layout-close', group: 'Layout', title: 'Close split', icon: X, when: when.splits, run: ({ dispatch, scope }) => dispatch({ type: 'layout-close', leafId: scope.leafId }) },

  ...SPACES.map((space, i) => ({ id: `space-${space.id}`, group: 'Space', title: `Switch to ${space.name}`, icon: Monitor, shortcut: ['nav', String(i + 1)], when: when.otherSpace(space.id), run: ({ dispatch }) => dispatch({ type: 'space', id: space.id }) }) satisfies PaletteAction),

  { id: 'theme-light', group: 'Appearance', title: 'Light theme', icon: Sun, run: ({ setTheme }) => setTheme('light') },
  { id: 'theme-dark', group: 'Appearance', title: 'Dark theme', icon: Moon, run: ({ setTheme }) => setTheme('dark') },
  { id: 'theme-system', group: 'Appearance', title: 'System theme', icon: Monitor, run: ({ setTheme }) => setTheme('system') },
  { id: 'sim-pause', group: 'Appearance', title: 'Pause or resume agents', icon: Pause, keywords: 'simulation tick', run: ({ dispatch }) => dispatch({ type: 'pause' }) },
] satisfies PaletteAction[];

function onThread(fn: (thread: Thread, ctx: ActionContext) => void) {
  return (ctx: ActionContext) => ctx.scope.thread && fn(ctx.scope.thread, ctx);
}

/** For dialogs that render inside the thread's own view (`RewindLayer`): a menu on another thread's row opens that thread first. */
function inThread(fn: (thread: Thread, ctx: ActionContext) => void) {
  return onThread((thread, ctx) => {
    if (!ctx.scope.isFocused) ctx.dispatch({ type: 'go', view: { kind: 'thread', id: thread.id } });
    fn(thread, ctx);
  });
}

function onTab(fn: (tab: PaneTab, thread: Thread, ctx: ActionContext) => void) {
  return (ctx: ActionContext) => ctx.scope.tab && ctx.scope.thread && fn(ctx.scope.tab, ctx.scope.thread, ctx);
}

function watch(thread: Thread, { state, dispatch }: ActionContext) {
  dispatch({ type: 'watch-toggle', threadId: thread.id });
  toast(state.watched.includes(thread.id) ? `Stopped watching ${thread.title}` : `Watching ${thread.title}`);
}

function copy(text: string, message: string) {
  navigator.clipboard.writeText(text).then(
    () => toast(message),
    () => toast.error('Could not copy to the clipboard'),
  );
}

/** Closes several tabs at once; their pane comes back whole from the undo toast. */
function closeTabs(threadId: string, tabs: PaneTab[], { state, dispatch }: ActionContext) {
  const before = state.panes.find((p) => p.threadId === threadId);
  if (!before || tabs.length === 0) return;
  dispatch({ type: 'pane-close-tabs', threadId, tabIds: tabs.map((t) => t.id) });
  toast(tabs.length === 1 ? 'Closed 1 tab' : `Closed ${tabs.length} tabs`, { action: { label: 'Undo', onClick: () => dispatch({ type: 'pane-restore', pane: before }) } });
}

function pin(thread: Thread, { state, dispatch }: ActionContext) {
  const lists = togglePin(state.threads, state.spaceId, thread.id);
  if (!lists) return toast('Pinned is full', { description: 'Orbit has five pin slots. Unpin a thread first.' });
  dispatch({ type: 'reorder', ...lists });
  toast(lists.pinned.includes(thread.id) ? `Pinned ${thread.title}` : `Unpinned ${thread.title}`);
}

// Summary visibility is ThreadView-local state; pressing its header toggle avoids lifting it into the store.
function clickInFocusedSplit(state: State, label: string) {
  const leafId = state.layouts[state.spaceId].focusId;
  document.querySelector<HTMLElement>(`[data-leaf-id="${leafId}"] [aria-label="${label}"]`)?.click();
}
