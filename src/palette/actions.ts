import type { Dispatch } from 'react';
import { Archive, Edit, Grid, History, Inbox, Layers, Maximize, Monitor, Moon, Pause, Pin, PinOff, Play, Refresh, Route, Routing, Sidebar, SidebarRight, Sun, TaskSquare, TransferH, type IconComponent } from 'reicon-react';
import { toast } from 'sonner';
import { PRESETS, PRESET_LABELS } from '../layout/tree';
import { SPACES, type Thread } from '../model';
import { PANE_TABS } from '../pane/tabs';
import { openRewind } from '../rewind/requests';
import { togglePin } from '../reorder';
import type { Action, State } from '../store';
import { when, type ActionScope } from './when';
import type { Key } from '../keys';

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

/** Every app action mod K can run. A new feature adds one entry here; `when` hides it where it would do nothing. */
export const ACTIONS = [
  { id: 'go-queue', group: 'Go to', title: 'Queue', icon: Inbox, run: ({ dispatch }) => dispatch({ type: 'go', view: { kind: 'queue' } }) },
  { id: 'go-review', group: 'Go to', title: 'Review mode', icon: TaskSquare, keywords: 'inbox approve', when: when.reviews, run: ({ openReview }) => openReview() },
  { id: 'go-board', group: 'Go to', title: 'Board', icon: Route, run: ({ dispatch }) => dispatch({ type: 'go', view: { kind: 'board' } }) },
  { id: 'go-new', group: 'Go to', title: 'New thread', icon: Edit, shortcut: ['N'], run: ({ dispatch }) => dispatch({ type: 'go', view: { kind: 'new' } }) },

  { id: 'thread-settle', group: 'Thread', title: 'Settle thread', icon: Archive, when: when.liveThread, run: onThread((t, { dispatch }) => dispatch({ type: 'settle', threadId: t.id })) },
  { id: 'thread-reactivate', group: 'Thread', title: 'Reactivate thread', icon: Refresh, when: when.settledThread, run: onThread((t, { dispatch }) => dispatch({ type: 'unsettle', threadId: t.id })) },
  { id: 'thread-pin', group: 'Thread', title: 'Pin thread', icon: Pin, shortcut: ['mod', 'shift', 'P'], when: when.unpinned, run: onThread(pin) },
  { id: 'thread-unpin', group: 'Thread', title: 'Unpin thread', icon: PinOff, shortcut: ['mod', 'shift', 'P'], when: when.pinned, run: onThread(pin) },
  { id: 'thread-rewind', group: 'Thread', title: 'Rewind to a checkpoint', icon: History, keywords: 'undo restore', when: when.liveThread, run: onThread((t) => openRewind({ kind: 'rewind', threadId: t.id })) },
  { id: 'thread-fork', group: 'Thread', title: 'Fork thread', icon: Routing, keywords: 'branch alternative', when: when.liveThread, run: onThread((t) => openRewind({ kind: 'fork', threadId: t.id })) },
  { id: 'thread-handoff', group: 'Thread', title: 'Hand off to another agent', icon: TransferH, keywords: 'claude codex switch', when: when.liveThread, run: onThread((t) => openRewind({ kind: 'handoff', threadId: t.id })) },
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
  { id: 'pane-dev-server', group: 'Side pane', title: 'Run a dev server', icon: Play, keywords: 'ports start npm pnpm', when: when.repo, run: onThread((t, { dispatch }) => dispatch({ type: 'pane-open-tab', threadId: t.id, kind: 'ports' })) },

  ...PRESETS.map((preset) => ({ id: `layout-${preset}`, group: 'Layout', title: `Layout: ${PRESET_LABELS[preset]}`, icon: Grid, run: ({ dispatch }) => dispatch({ type: 'layout-preset', preset }) }) satisfies PaletteAction),
  { id: 'layout-stage', group: 'Layout', title: 'Toggle Stage Manager', icon: Layers, shortcut: ['mod', 'shift', 'S'], run: ({ dispatch }) => dispatch({ type: 'stage-toggle' }) },
  { id: 'layout-overview', group: 'Layout', title: 'Show all sessions', icon: Grid, shortcut: ['mod', 'up'], keywords: 'overview mission control', run: ({ dispatch }) => dispatch({ type: 'overview-toggle', isOpen: true }) },
  { id: 'layout-split', group: 'Layout', title: 'Split right', icon: Grid, shortcut: ['mod', '\\'], run: ({ dispatch }) => dispatch({ type: 'layout-split', view: { kind: 'new' } }) },
  { id: 'layout-rotate', group: 'Layout', title: 'Rotate the focused split', icon: Grid, when: when.splits, run: ({ dispatch }) => dispatch({ type: 'layout-rotate' }) },
  { id: 'layout-swap', group: 'Layout', title: 'Swap the focused split with the next', icon: Grid, when: when.splits, run: ({ dispatch }) => dispatch({ type: 'layout-swap' }) },
  { id: 'layout-zoom', group: 'Layout', title: 'Zoom the focused split', icon: Maximize, shortcut: ['mod', 'shift', 'Enter'], when: when.splits, run: ({ dispatch }) => dispatch({ type: 'layout-zoom' }) },
  { id: 'layout-close', group: 'Layout', title: 'Close the focused split', icon: Grid, when: when.splits, run: ({ dispatch }) => dispatch({ type: 'layout-close' }) },

  ...SPACES.map((space, i) => ({ id: `space-${space.id}`, group: 'Space', title: `Switch to ${space.name}`, icon: Monitor, shortcut: ['nav', String(i + 1)], when: when.otherSpace(space.id), run: ({ dispatch }) => dispatch({ type: 'space', id: space.id }) }) satisfies PaletteAction),

  { id: 'theme-light', group: 'Appearance', title: 'Light theme', icon: Sun, run: ({ setTheme }) => setTheme('light') },
  { id: 'theme-dark', group: 'Appearance', title: 'Dark theme', icon: Moon, run: ({ setTheme }) => setTheme('dark') },
  { id: 'theme-system', group: 'Appearance', title: 'System theme', icon: Monitor, run: ({ setTheme }) => setTheme('system') },
  { id: 'sim-pause', group: 'Appearance', title: 'Pause or resume agents', icon: Pause, keywords: 'simulation tick', run: ({ dispatch }) => dispatch({ type: 'pause' }) },
] satisfies PaletteAction[];

function onThread(fn: (thread: Thread, ctx: ActionContext) => void) {
  return (ctx: ActionContext) => ctx.scope.thread && fn(ctx.scope.thread, ctx);
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
