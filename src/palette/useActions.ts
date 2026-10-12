import { useTheme } from 'next-themes';
import { useReviewMode } from '../review/useReviewMode';
import { useHarness } from '../store';
import { ACTIONS, type ActionContext, type PaletteAction } from './actions';
import { available, scopeOf, type ScopeTarget } from './when';

/** The registry actions available on `target` (the focused split when omitted) and a runner bound to it. Palette and context menus share it, so they never disagree. */
export function useActions(target?: ScopeTarget) {
  const { base, review } = useActionContext();
  const ctx: ActionContext = { ...base, scope: scopeOf(base.state, target) };
  return { actions: available<PaletteAction>(ACTIONS, ctx.scope), run: (action: PaletteAction) => action.run(ctx), review };
}

/** Everything an action's `run` needs except its scope, for callers that scope several targets themselves (bulk menus). */
export function useActionContext() {
  const { state, dispatch } = useHarness();
  const { setTheme } = useTheme();
  const review = useReviewMode();
  const base: Omit<ActionContext, 'scope'> = { state, dispatch, setTheme, openReview: review.open };
  return { base, review };
}
