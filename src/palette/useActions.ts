import { useTheme } from 'next-themes';
import { Star } from '@/icons';
import { usePrefs } from '../settings/prefs';
import { splitStarred } from '../themes/groups';
import { useThemesState } from '../themes/store';
import { useApplyTheme } from '../themes/useMarketplace';
import { useReviewMode } from '../review/useReviewMode';
import { useHarness } from '../store';
import { ACTIONS, type ActionContext, type PaletteAction } from './actions';
import { available, scopeOf, type ScopeTarget } from './when';

/** The registry actions available on `target` (the focused split when omitted) and a runner bound to it. Palette and context menus share it, so they never disagree. */
export function useActions(target?: ScopeTarget) {
  const { base, review } = useActionContext();
  const ctx: ActionContext = { ...base, scope: scopeOf(base.state, target) };
  const themes = useStarredThemeActions();
  return { actions: [...available<PaletteAction>(ACTIONS, ctx.scope), ...themes], run: (action: PaletteAction) => action.run(ctx), scope: ctx.scope, review };
}

/** One "Use <theme>" per starred theme, so switching between favourites never needs Settings. */
function useStarredThemeActions(): PaletteAction[] {
  const { installed } = useThemesState();
  const { starredThemes } = usePrefs();
  const apply = useApplyTheme();
  return splitStarred(installed, starredThemes).starred.map((theme) => ({ id: `theme-use-${theme.id}`, group: 'Appearance', title: `Use ${theme.label}`, keywords: 'theme color starred favorite', icon: Star, run: () => apply(theme) }));
}

/** Everything an action's `run` needs except its scope, for callers that scope several targets themselves (bulk menus). */
export function useActionContext() {
  const { state, dispatch } = useHarness();
  const { setTheme } = useTheme();
  const review = useReviewMode();
  const base: Omit<ActionContext, 'scope'> = { state, dispatch, setTheme, openReview: review.open };
  return { base, review };
}
