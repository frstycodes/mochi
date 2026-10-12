import type { Dispatch } from 'react';
import { Archive, ArrowRight, ArrowSwapHorizontal, BranchUp, CloseSquare, Copy, Edit, ExitFullscreen, Eye, EyeSlash, FolderOpen, Fullscreen, Grid, History, Inbox, Layers, Monitor, Moon, Pause, Pin, PinOff, Pip, Play, Refresh, Rotation, Route, Routing, RowHorizontal, RowVertical, Setting2, Sidebar, SidebarRight, Sun, TaskSquare, TransferH, X, type IconComponent } from 'reicon-react';
import { toast } from 'sonner';
import { pageKey, reloadPage } from '../browser/pages';
import { threadCwd } from '../host/cwd';
import { copyText } from '../clipboard';
import { REVEAL_IN, revealPath } from '../files/editors';
import { PRESETS, PRESET_LABELS } from '../layout/tree';
import { SPACES, type Thread } from '../model';
import { PANE_TABS } from '../pane/tabs';
import { openRewind } from '../rewind/requests';
import { openSettings } from '../settings/open';
import { pinMany } from '../reorder';
import type { Action, State } from '../store';
import { toggleSettle } from '../useSettle';
import { when, type ActionScope } from './when';
import type { Key } from '../keys';
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
  /** Bulk menus over a multi-selection: the same action on several threads with one toast. Actions without it stay out of bulk menus. */
  many?: { title: string; skipReason: string; run: (threads: Thread[], ctx: ActionContext) => void };
}

/** Every app action mod K and the context menus can run. A new feature adds one entry here; `when` hides it where it would do nothing, and `run` acts on `scope`, never on the focused split directly. */
export const ACTIONS = [
  { id: 'go-queue', group: 'Go to', title: 'Queue', icon: Inbox, run: ({ dispatch }) => dispatch({ type: 'go', view: { kind: 'queue' } }) },
  { id: 'go-review', group: 'Go to', title: 'Review mode', icon: TaskSquare, keywords: 'inbox approve', when: when.reviews, run: ({ openReview }) => openReview() },
  { id: 'go-board', group: 'Go to', title: 'Board', icon: Route, run: ({ dispatch }) => dispatch({ type: 'go', view: { kind: 'board' } }) },
  { id: 'go-settings', group: 'Go to', title: 'Settings', icon: Setting2, shortcut: ['mod', ','], keywords: 'agents claude codex accounts login api key preferences', run: () => openSettings() },
  { id: 'go-new', group: 'Go to', title: 'New thread', icon: Edit, shortcut: ['N'], run: ({ dispatch }) => dispatch({ type: 'go', view: { kind: 'new' } }) },

  { id: 'thread-open', group: 'Thread', title: 'Open thread', icon: ArrowRight, when: when.unfocusedThread, run: onThread((t, ctx) => open(ctx, { type: 'go', view: { kind: 'thread', id: t.id } })) },
  { id: 'thread-open-split', group: 'Thread', title: 'Open in new split', icon: RowVertical, when: when.unfocusedThread, run: onThread((t, ctx) => openSplits([t], ctx)), many: { title: 'Open each in a new split', skipReason: 'already open', run: openSplits } },
  { id: 'thread-settle', group: 'Thread', title: 'Settle thread', icon: Archive, when: when.liveThread, run: onThread((t, { dispatch }) => toggleSettle([t], dispatch)), many: { title: 'Settle threads', skipReason: 'already settled', run: (ts, { dispatch }) => toggleSettle(ts, dispatch) } },
  { id: 'thread-reactivate', group: 'Thread', title: 'Reactivate thread', icon: Refresh, when: when.settledThread, run: onThread((t, { dispatch }) => toggleSettle([t], dispatch)), many: { title: 'Reactivate threads', skipReason: 'not settled', run: (ts, { dispatch }) => toggleSettle(ts, dispatch) } },
  { id: 'thread-pin', group: 'Thread', title: 'Pin thread', icon: Pin, shortcut: ['mod', 'shift', 'P'], when: when.unpinned, run: onThread((t, ctx) => pin([t], ctx)), many: { title: 'Pin threads', skipReason: 'already pinned or settled', run: pin } },
  { id: 'thread-unpin', group: 'Thread', title: 'Unpin thread', icon: PinOff, shortcut: ['mod', 'shift', 'P'], when: when.pinned, run: onThread((t, ctx) => pin([t], ctx)), many: { title: 'Unpin threads', skipReason: 'not pinned', run: pin } },
  { id: 'thread-rewind', group: 'Thread', title: 'Rewind to a checkpoint', icon: History, keywords: 'undo restore', when: when.liveThread, run: inThread((t) => openRewind({ kind: 'rewind', threadId: t.id })) },
  { id: 'thread-fork', group: 'Thread', title: 'Fork thread', icon: Routing, keywords: 'branch alternative', when: when.liveThread, run: inThread((t) => openRewind({ kind: 'fork', threadId: t.id })) },
  { id: 'thread-handoff', group: 'Thread', title: 'Hand off to another agent', icon: TransferH, keywords: 'claude codex switch', when: when.liveThread, run: inThread((t) => openRewind({ kind: 'handoff', threadId: t.id })) },
  { id: 'thread-watch', group: 'Thread', title: 'Watch thread', icon: Eye, keywords: 'notify follow', when: when.unwatched, run: onThread((t, ctx) => watch([t], ctx)), many: { title: 'Watch threads', skipReason: 'already watched or settled', run: watch } },
  { id: 'thread-unwatch', group: 'Thread', title: 'Stop watching', icon: EyeSlash, keywords: 'notify follow', when: when.watched, run: onThread((t, ctx) => watch([t], ctx)), many: { title: 'Stop watching threads', skipReason: 'not watched', run: watch } },
  { id: 'thread-copy-branch', group: 'Thread', title: 'Copy branch name', icon: BranchUp, when: when.repo, run: onThread((t) => copyBranches([t])), many: { title: 'Copy branch names', skipReason: 'no project, so no branch', run: copyBranches } },
  { id: 'thread-reveal', group: 'Thread', title: `Reveal worktree in ${REVEAL_IN}`, icon: FolderOpen, when: when.worktree, run: onThread((t) => revealPath(threadCwd(t)!, '')) },
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

/** Opening from an Overview card leaves the Overview, as clicking the card does. */
function open({ dispatch }: ActionContext, action: Action) {
  dispatch(action);
  dispatch({ type: 'overview-toggle', isOpen: false });
}

function onTab(fn: (tab: PaneTab, thread: Thread, ctx: ActionContext) => void) {
  return (ctx: ActionContext) => ctx.scope.tab && ctx.scope.thread && fn(ctx.scope.tab, ctx.scope.thread, ctx);
}

function openSplits(threads: Thread[], ctx: ActionContext) {
  threads.forEach((t) => ctx.dispatch({ type: 'layout-split', view: { kind: 'thread', id: t.id } }));
  ctx.dispatch({ type: 'overview-toggle', isOpen: false });
}

function watch(threads: Thread[], { state, dispatch }: ActionContext) {
  threads.forEach((t) => dispatch({ type: 'watch-toggle', threadId: t.id }));
  const isStopping = state.watched.includes(threads[0].id);
  toast(isStopping ? `Stopped watching ${named(threads)}` : `Watching ${named(threads)}`);
}

function copyBranches(threads: Thread[]) {
  copyText(threads.map((t) => t.repo!.branch).join('\n'), threads.length === 1 ? 'Copied branch name' : `Copied ${threads.length} branch names`);
}

const named = (threads: Thread[]) => (threads.length === 1 ? threads[0].title : `${threads.length} threads`);

/** Closes several tabs at once; their pane comes back whole from the undo toast. */
function closeTabs(threadId: string, tabs: PaneTab[], { state, dispatch }: ActionContext) {
  const before = state.panes.find((p) => p.threadId === threadId);
  if (!before || tabs.length === 0) return;
  dispatch({ type: 'pane-close-tabs', threadId, tabIds: tabs.map((t) => t.id) });
  toast(tabs.length === 1 ? 'Closed 1 tab' : `Closed ${tabs.length} tabs`, { action: { label: 'Undo', onClick: () => dispatch({ type: 'pane-restore', pane: before }) } });
}

function pin(threads: Thread[], { state, dispatch }: ActionContext) {
  const lists = pinMany(state.threads, state.spaceId, threads.map((t) => t.id));
  if (!lists) return toast('Pinned is full', { description: 'Orbit has five pin slots. Unpin a thread first.' });
  dispatch({ type: 'reorder', ...lists });
  toast(lists.pinned.includes(threads[0].id) ? `Pinned ${named(threads)}` : `Unpinned ${named(threads)}`);
}

// Summary visibility is ThreadView-local state; pressing its header toggle avoids lifting it into the store.
function clickInFocusedSplit(state: State, label: string) {
  const leafId = state.layouts[state.spaceId].focusId;
  document.querySelector<HTMLElement>(`[data-leaf-id="${leafId}"] [aria-label="${label}"]`)?.click();
}
