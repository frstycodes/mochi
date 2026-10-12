import { useTheme } from 'next-themes';
import { useReviewMode } from '../review/useReviewMode';
import { useHarness } from '../store';
import { ACTIONS, type ActionContext, type PaletteAction } from './actions';
import { available, scopeOf, type ScopeTarget } from './when';

/** The registry actions available on `target` (the focused split when omitted) and a runner bound to it. Palette and context menus share it, so they never disagree. */
export function useActions(target?: ScopeTarget) {
  const { state, dispatch } = useHarness();
  const { setTheme } = useTheme();
  const review = useReviewMode();
  const scope = scopeOf(state, target);
  const ctx: ActionContext = { state, dispatch, scope, setTheme, openReview: review.open };
  return { actions: available<PaletteAction>(ACTIONS, scope), run: (action: PaletteAction) => action.run(ctx), review };
}
