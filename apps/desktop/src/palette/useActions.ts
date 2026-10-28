import { useTheme } from 'next-themes';
import { Star } from '@/icons';
import { usePrefs } from '../settings/prefs';
import { splitStarred } from '../themes/groups';
import { useThemesState } from '../themes/store';
import { useApplyTheme } from '../themes/useMarketplace';
import { useHarness } from '../store';
import type { FollowedMachine } from '../host/types/remote';
import { elsewhereReason, useRemoteMachine } from '../remote/origin';
import { ACTIONS, type ActionContext, type PaletteAction } from './actions';
import { available, scopeOf, type ScopeTarget } from './when';

/** The registry actions available on `target` (the focused split when omitted) and a runner bound to it. Palette and context menus share it, so they never disagree. */
export function useActions(target?: ScopeTarget) {
  const { base } = useActionContext();
  const ctx: ActionContext = { ...base, scope: scopeOf(base.state, target) };
  const themes = useStarredThemeActions();
  const machine = useRemoteMachine();
  const listed = available<PaletteAction>(ACTIONS, ctx.scope);
  return {
    actions: [
      ...(machine ? listed.map((a) => onAnotherComputer(a, machine)) : listed),
      ...themes,
    ],
    run: (action: PaletteAction) => action.run(ctx),
    scope: ctx.scope,
  };
}

/** Thread actions that run through a command on the thread's computer, or only change this screen. */
const REMOTE_THREAD_ACTIONS = new Set([
  'thread-open',
  'thread-open-split',
  'thread-rename',
  'thread-watch',
  'thread-unwatch',
  'thread-goal-make',
  'thread-fork',
  'thread-rewind',
  'thread-handoff',
  'thread-settle',
  'thread-reactivate',
  'thread-delete',
  'thread-copy-branch',
  'thread-summary',
]);

/** On another computer's thread, a thread action that would run on this computer is shown disabled with why, never run here. */
export function onAnotherComputer(
  action: PaletteAction,
  machine: Pick<FollowedMachine, 'name'>,
): PaletteAction {
  if (!action.id.startsWith('thread-') || REMOTE_THREAD_ACTIONS.has(action.id))
    return action;
  return { ...action, disabledReason: () => elsewhereReason(machine) };
}

/** One "Use <theme>" per starred theme, so switching between favourites never needs Settings. */
function useStarredThemeActions(): PaletteAction[] {
  const { installed } = useThemesState();
  const { starredThemes } = usePrefs();
  const apply = useApplyTheme();
  return splitStarred(installed, starredThemes).starred.map((theme) => ({
    id: `theme-use-${theme.id}`,
    group: 'Appearance',
    title: `Use ${theme.label}`,
    keywords: 'theme color starred favorite',
    icon: Star,
    run: () => apply(theme),
  }));
}

/** Everything an action's `run` needs except its scope, for callers that scope several targets themselves (bulk menus). */
export function useActionContext() {
  const { state, dispatch } = useHarness();
  const { setTheme } = useTheme();
  const base: Omit<ActionContext, 'scope'> = {
    state,
    dispatch,
    setTheme,
  };
  return { base };
}
