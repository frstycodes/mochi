import type { Dispatch } from 'react';
import {
  Archive,
  Chart,
  Connector,
  ExternalLink,
  Plugin,
  Skill,
  Flag,
  Link,
  SearchAlt,
  ArrowLeft,
  ArrowRight,
  Clock,
  Scale,
  ArrowLeftRight,
  XSquare,
  Copy,
  Edit,
  ExitFullscreen,
  Eye,
  EyeSlash,
  Folder,
  FolderOpen,
  Fullscreen,
  Grid,
  Hierarchy2,
  History,
  Inbox,
  MagicStar,
  Monitor,
  Moon,
  Pause,
  Pin,
  PinOff,
  Pip,
  Play,
  Refresh,
  Rotation,
  Columns,
  Rows,
  Settings,
  Sidebar,
  SidebarRight,
  Sun,
  Transfer,
  VideoPlay,
  Share,
  X,
  type IconComponent,
} from '@/icons';
import { ForkIcon } from '../ui';
import { toast } from '../toast/store.ts';
import { getPage, openFind, pageKey, reloadPage } from '../browser/pages';
import { openExternally, openInLabel } from '../browser/systemBrowser';
import { threadCwd } from '../host/cwd';
import { autofixPr, setAutofix } from '../git/autofixToggle';
import { copyText } from '../clipboard';
import { REVEAL_IN, revealPath } from '../files/editors';
import { PRESETS, PRESET_LABELS } from '@mochi/domain/layout/tree';
import type { Provider, Thread } from '../model';
import { getProfiles, MAX_PROFILES } from '../profiles';
import { PANE_TABS } from '../pane/tabs';
import { rewindBlockedReason } from '../rewind/checkpoints';
import { openRewind } from '../rewind/requests';
import { PROVIDER_NAME } from '../rewind/handoff';
import { isSwitchPending, otherProvider, switchHere } from '../rewind/switch';
import { openSchedule } from '../schedule/ScheduleDialog';
import { openGoalEditor } from '../goals/GoalEditor';
import { hasGoal } from '../drift';
import { getPrefs } from '../settings/prefs';
import { startRename } from '../rename';
import { openSettings } from '../routes/nav';
import { openDeveloper, openReplay } from '../routes/nav';
import { shareReplay } from '../replay/load';
import { askInSideChat } from '../sidechat/AskInSideChat';
import { askSecondOpinion } from '../secondOpinion/run';
import { reviewerFor } from '../secondOpinion/reviewer';
import { providerName } from '../secondOpinion/verdict';
import { pinMany } from '../reorder';
import { pinnedNeighbour, slotsOf } from '../pager/slots';
import type { Action, State } from '../store';
import { toggleSettle } from '../useSettle';
import { when, type ActionScope } from './when';
import { spaceCommand, type CommandId } from '../keymap';
import type { PaneTab } from '../model';
import { plural } from '@mochi/domain/lib/format';

export const ACTION_GROUPS = [
  'Go to',
  'Thread',
  'Side pane',
  'Layout',
  'Space',
  'Appearance',
] as const;

export interface ActionContext {
  state: State;
  dispatch: Dispatch<Action>;
  scope: ActionScope;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
}

export interface PaletteAction {
  id: string;
  group: (typeof ACTION_GROUPS)[number];
  title: string;
  icon: IconComponent;
  keywords?: string;
  /** The keymap command that runs this from the keyboard; menus and the palette show its chord. */
  command?: CommandId;
  when?: (scope: ActionScope) => boolean;
  /** The title for this target, when it names something about it ("Ask Codex for a second opinion"). */
  label?: (scope: ActionScope) => string;
  /** A provider's mark in place of `icon` for this target (the agent that would answer). */
  mark?: (scope: ActionScope) => Provider;
  /** Shown but not runnable, with this reason, while it would fail (the other agent isn't signed in). */
  disabledReason?: (scope: ActionScope) => string | undefined;
  /** False while the thing it acts on doesn't exist at all (a profile slot past the last profile), so lists like Settings › Keyboard leave it out. */
  exists?: () => boolean;
  run: (ctx: ActionContext) => void;
  /** Bulk menus over a multi-selection: the same action on several threads with one toast. Actions without it stay out of bulk menus. */
  many?: {
    title: string;
    skipReason: string;
    run: (threads: Thread[], ctx: ActionContext) => void;
  };
}

/** Every app action mod K and the context menus can run. A new feature adds one entry here; `when` hides it where it would do nothing, and `run` acts on `scope`, never on the focused split directly. */
export const ACTIONS = [
  {
    id: 'go-queue',
    group: 'Go to',
    title: 'Queue',
    icon: Inbox,
    run: ({ dispatch }) => dispatch({ type: 'go', view: { kind: 'queue' } }),
  },
  {
    id: 'go-usage',
    group: 'Go to',
    title: 'Usage',
    icon: Chart,
    keywords: 'tokens cost spend stats share commits pull requests',
    run: ({ dispatch }) => dispatch({ type: 'go', view: { kind: 'usage' } }),
  },
  {
    id: 'go-projects',
    group: 'Go to',
    title: 'Projects',
    icon: Folder,
    keywords: 'folder repository clone add',
    run: ({ dispatch }) => dispatch({ type: 'go', view: { kind: 'projects' } }),
  },
  {
    id: 'go-skills',
    group: 'Go to',
    title: 'Skills',
    icon: Skill,
    keywords: 'library skill install github',
    run: () => openSettings('skills'),
  },
  {
    id: 'go-plugins',
    group: 'Go to',
    title: 'Plugins',
    icon: Plugin,
    keywords: 'library plugin marketplace install',
    run: () => openSettings('plugins'),
  },
  {
    id: 'go-connectors',
    group: 'Go to',
    title: 'Connectors',
    icon: Connector,
    keywords: 'library connector account mcp server sign in oauth',
    run: () => openSettings('connectors'),
  },
  {
    id: 'go-developer',
    group: 'Go to',
    title: 'Developer',
    icon: Monitor,
    keywords: 'metrics cpu gpu memory processes spawns spans logs performance',
    when: (s) => s.isDesktop,
    run: () => openDeveloper(),
  },
  {
    id: 'go-settings',
    group: 'Go to',
    title: 'Settings',
    icon: Settings,
    command: 'go-settings',
    keywords: 'agents claude codex accounts login api key preferences',
    run: () => openSettings(),
  },
  {
    id: 'go-new',
    group: 'Go to',
    title: 'New thread',
    icon: Edit,
    command: 'go-new',
    run: ({ dispatch }) => dispatch({ type: 'go', view: { kind: 'new' } }),
  },

  {
    id: 'thread-open',
    group: 'Thread',
    title: 'Open thread',
    icon: ArrowRight,
    when: when.unfocusedThread,
    run: onThread((t, ctx) =>
      open(ctx, { type: 'go', view: { kind: 'thread', id: t.id } }),
    ),
  },
  {
    id: 'thread-open-split',
    group: 'Thread',
    title: 'Open in new split',
    icon: Rows,
    when: when.unfocusedThread,
    run: onThread((t, ctx) => openSplits([t], ctx)),
    many: {
      title: 'Open each in a new split',
      skipReason: 'already open',
      run: openSplits,
    },
  },
  {
    id: 'thread-settle',
    group: 'Thread',
    title: 'Archive thread',
    icon: Archive,
    when: when.liveThread,
    run: onThread((t, { dispatch }) => toggleSettle([t], dispatch)),
    many: {
      title: 'Archive threads',
      skipReason: 'already archived',
      run: (ts, { dispatch }) => toggleSettle(ts, dispatch),
    },
  },
  {
    id: 'thread-reactivate',
    group: 'Thread',
    title: 'Unarchive thread',
    icon: Refresh,
    when: when.settledThread,
    run: onThread((t, { dispatch }) => toggleSettle([t], dispatch)),
    many: {
      title: 'Unarchive threads',
      skipReason: 'not archived',
      run: (ts, { dispatch }) => toggleSettle(ts, dispatch),
    },
  },
  {
    id: 'thread-pin',
    group: 'Thread',
    title: 'Pin thread',
    icon: Pin,
    command: 'thread-pin',
    when: when.unpinned,
    run: onThread((t, ctx) => pin([t], ctx)),
    many: {
      title: 'Pin threads',
      skipReason: 'already pinned or settled',
      run: pin,
    },
  },
  {
    id: 'thread-unpin',
    group: 'Thread',
    title: 'Unpin thread',
    icon: PinOff,
    command: 'thread-pin',
    when: when.pinned,
    run: onThread((t, ctx) => pin([t], ctx)),
    many: { title: 'Unpin threads', skipReason: 'not pinned', run: pin },
  },
  // Desktop runs need a real agent; the web build edits schedules on demo threads so the editor can be tried.
  {
    id: 'thread-rename',
    group: 'Thread',
    title: 'Rename thread',
    icon: Edit,
    command: 'thread-rename',
    keywords: 'title name',
    when: when.thread,
    run: onThread((t, { scope }) =>
      startRename(t.id, scope.isRow ? 'row' : 'dialog'),
    ),
  },
  {
    id: 'thread-schedule',
    group: 'Thread',
    title: 'Schedule…',
    icon: Clock,
    keywords: 'cron nightly background pr trigger recurring',
    when: (s) => when.liveThread(s) && (!s.isDesktop || !!s.thread!.live),
    run: onThread((t) => openSchedule(t.id)),
  },
  {
    id: 'thread-rewind',
    group: 'Thread',
    title: 'Rewind to a checkpoint',
    icon: History,
    keywords: 'undo restore',
    when: when.liveThread,
    disabledReason: (s) => s.thread && rewindBlockedReason(s.thread),
    run: inThread((t) => openRewind({ kind: 'rewind', threadId: t.id })),
  },
  {
    id: 'thread-fork',
    group: 'Thread',
    title: 'Fork thread',
    icon: ForkIcon,
    keywords: 'branch alternative',
    when: when.liveThread,
    run: inThread((t) => openRewind({ kind: 'fork', threadId: t.id })),
  },
  {
    id: 'thread-replay',
    group: 'Thread',
    title: 'Replay thread',
    icon: VideoPlay,
    keywords: 'recording session playback demo debug',
    when: when.thread,
    run: onThread((t) => openReplay(t.id)),
  },
  {
    id: 'thread-export-replay',
    group: 'Thread',
    title: 'Export replay…',
    icon: Share,
    keywords: 'recording session share html',
    when: when.thread,
    run: onThread((t, { state }) => void shareReplay(state, t)),
  },
  {
    id: 'thread-goal-make',
    group: 'Thread',
    title: 'Make this a goal',
    icon: Flag,
    keywords: 'goal outcome criteria done task track progress',
    when: (s) => when.thread(s) && getPrefs().goals && !hasGoal(s.thread!),
    run: onThread((t) => openGoalEditor(t.id)),
  },
  {
    id: 'thread-goal-remove',
    group: 'Thread',
    title: 'Remove goal',
    icon: XSquare,
    keywords: 'goal chat question untrack progress',
    when: (s) => when.thread(s) && hasGoal(s.thread!),
    run: onThread((t, { dispatch }) =>
      dispatch({ type: 'goal-remove', threadId: t.id }),
    ),
  },
  {
    id: 'thread-handoff',
    group: 'Thread',
    title: 'Switch to another agent',
    icon: Transfer,
    keywords: 'claude codex switch hand off provider',
    when: when.liveThread,
    label: (s) =>
      `Switch to ${PROVIDER_NAME[otherProvider(s.thread!)]} from the next message`,
    mark: (s) => otherProvider(s.thread!),
    disabledReason: (s) =>
      isSwitchPending(s.thread!) ? 'Already switching' : undefined,
    run: onThread((t, { dispatch }) => switchHere(t, dispatch)),
  },
  {
    id: 'thread-second-opinion',
    group: 'Thread',
    title: 'Ask for a second opinion',
    icon: Scale,
    keywords: 'review verdict claude codex other agent',
    when: (s) => when.liveThread(s) && when.repo(s),
    label: (s) =>
      `Ask ${providerName(reviewerFor(s.thread!).provider)} for a second opinion`,
    mark: (s) => reviewerFor(s.thread!).provider,
    disabledReason: (s) => reviewerFor(s.thread!).reason,
    run: onThread((t, { dispatch }) => askSecondOpinion(t, dispatch)),
  },
  {
    id: 'thread-watch',
    group: 'Thread',
    title: 'Watch thread',
    icon: Eye,
    keywords: 'notify follow',
    when: when.unwatched,
    run: onThread((t, ctx) => watch([t], ctx)),
    many: {
      title: 'Watch threads',
      skipReason: 'already watched or settled',
      run: watch,
    },
  },
  {
    id: 'thread-unwatch',
    group: 'Thread',
    title: 'Stop watching',
    icon: EyeSlash,
    keywords: 'notify follow',
    when: when.watched,
    run: onThread((t, ctx) => watch([t], ctx)),
    many: {
      title: 'Stop watching threads',
      skipReason: 'not watched',
      run: watch,
    },
  },
  {
    id: 'thread-autofix',
    group: 'Thread',
    title: 'Auto-fix pull request',
    icon: MagicStar,
    keywords: 'ci checks review conflicts pr',
    when: when.autofixOff,
    label: (s) => `Auto-fix PR #${autofixPr(s.thread!)!.number}`,
    run: onThread((t, { dispatch }) =>
      setAutofix(dispatch, t, autofixPr(t)!, true),
    ),
  },
  {
    id: 'thread-autofix-off',
    group: 'Thread',
    title: 'Stop Auto-fix',
    icon: MagicStar,
    keywords: 'ci checks review conflicts pr',
    when: when.autofixOn,
    label: (s) => `Stop Auto-fix on PR #${autofixPr(s.thread!)!.number}`,
    run: onThread((t, { dispatch }) =>
      setAutofix(dispatch, t, autofixPr(t)!, false),
    ),
  },
  {
    id: 'thread-copy-branch',
    group: 'Thread',
    title: 'Copy branch name',
    icon: Hierarchy2,
    when: when.repo,
    run: onThread((t) => copyBranches([t])),
    many: {
      title: 'Copy branch names',
      skipReason: 'no project, so no branch',
      run: copyBranches,
    },
  },
  {
    id: 'thread-reveal',
    group: 'Thread',
    title: `Reveal worktree in ${REVEAL_IN}`,
    icon: FolderOpen,
    when: when.worktree,
    run: onThread((t) => revealPath(threadCwd(t)!, '')),
  },
  {
    id: 'thread-summary',
    group: 'Thread',
    title: 'Toggle summary',
    icon: SidebarRight,
    when: when.thread,
    run: ({ state }) => clickInFocusedSplit(state, 'Thread summary'),
  },

  {
    id: 'pane-toggle',
    group: 'Side pane',
    title: 'Toggle side pane',
    icon: Sidebar,
    when: when.thread,
    run: onThread((t, { dispatch }) =>
      dispatch({ type: 'pane-toggle', threadId: t.id }),
    ),
  },
  ...(
    [
      'browser',
      'changes',
      'terminal',
      'files',
      'simulator',
      'ports',
      'sidechat',
    ] as const
  ).map(
    (kind) =>
      ({
        id: `pane-open-${kind}`,
        group: 'Side pane',
        title: `Open ${PANE_TABS[kind].title}`,
        icon: PANE_TABS[kind].icon,
        keywords: 'tab',
        when: when.thread,
        run: onThread((t, { dispatch }) =>
          dispatch({ type: 'pane-open-tab', threadId: t.id, kind }),
        ),
      }) satisfies PaletteAction,
  ),
  {
    id: 'sidechat-ask',
    group: 'Side pane',
    title: 'Ask in side chat',
    icon: PANE_TABS.sidechat.icon,
    keywords: 'side question aside /side',
    when: when.thread,
    run: onThread((t, { dispatch }) => askInSideChat(dispatch, t.id)),
  },
  {
    id: 'tab-close',
    group: 'Side pane',
    title: 'Close tab',
    icon: X,
    command: 'tab-close',
    when: when.tab,
    run: onTab((tab, t, { dispatch }) =>
      dispatch({ type: 'pane-close-tab', threadId: t.id, tabId: tab.id }),
    ),
  },
  {
    id: 'tab-close-others',
    group: 'Side pane',
    title: 'Close other tabs',
    icon: XSquare,
    when: when.otherTabs,
    run: onTab((tab, t, ctx) =>
      closeTabs(
        t.id,
        ctx.scope.tabs.filter((x) => x !== tab),
        ctx,
      ),
    ),
  },
  {
    id: 'tab-close-right',
    group: 'Side pane',
    title: 'Close tabs to the right',
    icon: XSquare,
    when: when.tabsToRight,
    run: onTab((tab, t, ctx) =>
      closeTabs(
        t.id,
        ctx.scope.tabs.slice(ctx.scope.tabs.indexOf(tab) + 1),
        ctx,
      ),
    ),
  },
  {
    id: 'tab-reload',
    group: 'Side pane',
    title: 'Reload page',
    icon: Refresh,
    when: when.browserTab,
    run: onTab((tab, t) => reloadPage(pageKey(t.id, tab.id))),
  },
  {
    id: 'tab-find',
    group: 'Side pane',
    title: 'Find in page',
    icon: SearchAlt,
    command: 'find',
    keywords: 'search text',
    when: when.browserTab,
    run: onTab(
      (tab, t, { dispatch }) => (
        dispatch({ type: 'pane-select-tab', threadId: t.id, tabId: tab.id }),
        openFind(pageKey(t.id, tab.id))
      ),
    ),
  },
  {
    id: 'tab-copy-url',
    group: 'Side pane',
    title: 'Copy URL',
    icon: Link,
    when: when.webTab,
    run: onTab((tab, t) => copyText(tabUrl(tab, t), 'URL copied')),
  },
  {
    id: 'tab-open-external',
    group: 'Side pane',
    title: 'Open in your browser',
    label: () => openInLabel(),
    icon: ExternalLink,
    keywords: 'external system default browser',
    when: when.webTab,
    run: onTab((tab, t) => openExternally(tabUrl(tab, t))),
  },
  {
    id: 'tab-duplicate',
    group: 'Side pane',
    title: 'Duplicate tab',
    icon: Copy,
    when: when.multiTab,
    run: onTab((tab, t, { dispatch }) =>
      dispatch({
        type: 'pane-open-tab',
        threadId: t.id,
        kind: tab.kind,
        url: tab.url,
        file: tab.file,
      }),
    ),
  },
  {
    id: 'tab-pop',
    group: 'Side pane',
    title: 'Pop out into a floating window',
    icon: Pip,
    when: when.poppableTab,
    run: onTab((tab, t, { dispatch }) =>
      dispatch({
        type: 'pane-pop',
        threadId: t.id,
        tabId: tab.id,
        isPopped: true,
      }),
    ),
  },
  {
    id: 'tab-split',
    group: 'Side pane',
    title: 'Move tab to a new split',
    icon: Rows,
    when: when.tab,
    run: onTab((tab, t, { dispatch }) =>
      dispatch({
        type: 'layout-split',
        view: { kind: 'tab', threadId: t.id, tabId: tab.id },
      }),
    ),
  },
  {
    id: 'pane-dev-server',
    group: 'Side pane',
    title: 'Run a dev server',
    icon: Play,
    keywords: 'ports start npm pnpm',
    when: when.repo,
    run: onThread((t, { dispatch }) =>
      dispatch({ type: 'pane-open-tab', threadId: t.id, kind: 'ports' }),
    ),
  },

  ...PRESETS.map(
    (preset) =>
      ({
        id: `layout-${preset}`,
        group: 'Layout',
        title: `Layout: ${PRESET_LABELS[preset]}`,
        icon: Grid,
        run: ({ dispatch }) => dispatch({ type: 'layout-preset', preset }),
      }) satisfies PaletteAction,
  ),
  {
    id: 'pinned-previous',
    group: 'Layout',
    title: 'Previous pinned thread',
    icon: ArrowLeft,
    command: 'pinned-previous',
    keywords: 'swipe switch tab',
    run: ({ state, dispatch }) => goPinned(state, dispatch, -1),
  },
  {
    id: 'pinned-next',
    group: 'Layout',
    title: 'Next pinned thread',
    icon: ArrowRight,
    command: 'pinned-next',
    keywords: 'swipe switch tab',
    run: ({ state, dispatch }) => goPinned(state, dispatch, 1),
  },
  {
    id: 'layout-overview',
    group: 'Layout',
    title: 'Show all sessions',
    icon: Grid,
    command: 'layout-overview',
    keywords: 'overview mission control',
    run: ({ dispatch }) => dispatch({ type: 'overview-toggle', isOpen: true }),
  },
  {
    id: 'layout-split',
    group: 'Layout',
    title: 'Split right',
    icon: Rows,
    command: 'layout-split',
    run: ({ dispatch, scope }) =>
      dispatch({
        type: 'layout-split',
        view: { kind: 'new' },
        leafId: scope.leafId,
      }),
  },
  {
    id: 'layout-split-down',
    group: 'Layout',
    title: 'Split down',
    icon: Columns,
    run: ({ dispatch, scope }) =>
      dispatch({
        type: 'layout-split',
        view: { kind: 'new' },
        leafId: scope.leafId,
        side: 'bottom',
      }),
  },
  {
    id: 'layout-rotate',
    group: 'Layout',
    title: 'Rotate split',
    icon: Rotation,
    when: when.unzoomedSplits,
    run: ({ dispatch, scope }) =>
      dispatch({ type: 'layout-rotate', leafId: scope.leafId }),
  },
  {
    id: 'layout-swap',
    group: 'Layout',
    title: 'Swap with next split',
    icon: ArrowLeftRight,
    when: when.unzoomedSplits,
    run: ({ dispatch, scope }) =>
      dispatch({ type: 'layout-swap', leafId: scope.leafId }),
  },
  {
    id: 'layout-zoom',
    group: 'Layout',
    title: 'Zoom split',
    icon: Fullscreen,
    command: 'layout-zoom',
    when: when.unzoomedSplits,
    run: ({ dispatch, scope }) =>
      dispatch({ type: 'layout-zoom', leafId: scope.leafId }),
  },
  {
    id: 'layout-unzoom',
    group: 'Layout',
    title: 'Show all splits',
    icon: ExitFullscreen,
    command: 'layout-zoom',
    when: when.zoomed,
    run: ({ dispatch }) => dispatch({ type: 'layout-zoom' }),
  },
  {
    id: 'layout-close',
    group: 'Layout',
    title: 'Close split',
    icon: X,
    when: when.splits,
    run: ({ dispatch, scope }) =>
      dispatch({ type: 'layout-close', leafId: scope.leafId }),
  },

  // One per `nav` + digit, bound to whichever profile sits at that position now (Settings › Profiles adds and removes them).
  ...Array.from(
    { length: MAX_PROFILES },
    (_, i) =>
      ({
        id: `space-${i + 1}`,
        group: 'Space',
        get title() {
          return `Switch to ${getProfiles()[i]?.name ?? `profile ${i + 1}`}`;
        },
        icon: Monitor,
        command: spaceCommand(i + 1),
        exists: () => i < getProfiles().length,
        when: (scope: ActionScope) =>
          i < getProfiles().length &&
          when.otherSpace(getProfiles()[i].id)(scope),
        run: ({ dispatch }: ActionContext) =>
          dispatch({ type: 'space', id: getProfiles()[i].id }),
      }) satisfies PaletteAction,
  ),

  {
    id: 'theme-light',
    group: 'Appearance',
    title: 'Light theme',
    icon: Sun,
    run: ({ setTheme }) => setTheme('light'),
  },
  {
    id: 'theme-dark',
    group: 'Appearance',
    title: 'Dark theme',
    icon: Moon,
    run: ({ setTheme }) => setTheme('dark'),
  },
  {
    id: 'theme-system',
    group: 'Appearance',
    title: 'System theme',
    icon: Monitor,
    run: ({ setTheme }) => setTheme('system'),
  },
  {
    id: 'sim-pause',
    group: 'Appearance',
    title: 'Pause or resume agents',
    icon: Pause,
    keywords: 'simulation tick',
    run: ({ dispatch }) => dispatch({ type: 'pause' }),
  },
] satisfies PaletteAction[];

/** The pinned pager's keys: the next or previous pinned thread, instantly (keyboard navigation never animates). */
function goPinned(state: State, dispatch: Dispatch<Action>, step: 1 | -1) {
  const id = pinnedNeighbour(slotsOf(state), step);
  if (id) dispatch({ type: 'go', view: { kind: 'thread', id } });
}

function onThread(fn: (thread: Thread, ctx: ActionContext) => void) {
  return (ctx: ActionContext) => ctx.scope.thread && fn(ctx.scope.thread, ctx);
}

/** For dialogs that render inside the thread's own view (`RewindLayer`): a menu on another thread's row opens that thread first. */
function inThread(fn: (thread: Thread, ctx: ActionContext) => void) {
  return onThread((thread, ctx) => {
    if (!ctx.scope.isFocused)
      ctx.dispatch({ type: 'go', view: { kind: 'thread', id: thread.id } });
    fn(thread, ctx);
  });
}

/** Opening from an Overview card leaves the Overview, as clicking the card does. */
function open({ dispatch }: ActionContext, action: Action) {
  dispatch(action);
  dispatch({ type: 'overview-toggle', isOpen: false });
}

/** The page's live URL; the tab's saved one until its page exists. */
function tabUrl(tab: PaneTab, thread: Thread) {
  return getPage(pageKey(thread.id, tab.id))?.url ?? tab.url ?? '';
}

function onTab(fn: (tab: PaneTab, thread: Thread, ctx: ActionContext) => void) {
  return (ctx: ActionContext) =>
    ctx.scope.tab &&
    ctx.scope.thread &&
    fn(ctx.scope.tab, ctx.scope.thread, ctx);
}

function openSplits(threads: Thread[], ctx: ActionContext) {
  threads.forEach((t) =>
    ctx.dispatch({ type: 'layout-split', view: { kind: 'thread', id: t.id } }),
  );
  ctx.dispatch({ type: 'overview-toggle', isOpen: false });
}

function watch(threads: Thread[], { dispatch }: ActionContext) {
  threads.forEach((t) => dispatch({ type: 'watch-toggle', threadId: t.id }));
}

function copyBranches(threads: Thread[]) {
  copyText(
    threads.map((t) => t.repo!.branch).join('\n'),
    plural(
      threads.length,
      'Copied branch name',
      `Copied ${threads.length} branch names`,
    ),
  );
}

/** Closes several tabs at once; their pane comes back whole from the undo toast. */
function closeTabs(
  threadId: string,
  tabs: PaneTab[],
  { state, dispatch }: ActionContext,
) {
  const before = state.panes.find((p) => p.threadId === threadId);
  if (!before || tabs.length === 0) return;
  dispatch({
    type: 'pane-close-tabs',
    threadId,
    tabIds: tabs.map((t) => t.id),
  });
  toast(plural(tabs.length, 'Closed 1 tab', `Closed ${tabs.length} tabs`), {
    action: {
      label: 'Undo',
      onClick: () => dispatch({ type: 'pane-restore', pane: before }),
    },
  });
}

function pin(threads: Thread[], { state, dispatch }: ActionContext) {
  const at = Date.now();
  const lists = pinMany(
    state.threads,
    state.spaceId,
    threads.map((t) => t.id),
    at,
  );
  if (!lists)
    return toast('Pinned is full', {
      description: 'Orbit has five pin slots. Unpin a thread first.',
    });
  dispatch({ type: 'reorder', ...lists, at });
}

// Summary visibility is ThreadView-local state; pressing its header toggle avoids lifting it into the store.
function clickInFocusedSplit(state: State, label: string) {
  const leafId = state.layouts[state.spaceId].focusId;
  document
    .querySelector<HTMLElement>(
      `[data-leaf-id="${leafId}"] [aria-label="${label}"]`,
    )
    ?.click();
}
