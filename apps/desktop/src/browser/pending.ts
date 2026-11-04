/** A URL the address bar navigated to that the page hasn't committed yet; the bar shows it meanwhile, as browsers do. */
export interface PendingNavigation {
  url: string;
  /** The page's committed URL when it was asked for: a state still on it is the old page, any other URL is the new one. */
  from: string;
  hasStarted: boolean;
}

export interface NavigationState {
  url: string;
  isLoading: boolean;
  error: string | null;
}

export function startNavigation(
  url: string,
  current: { url: string; pending: PendingNavigation | null },
): PendingNavigation {
  return { url, from: current.pending?.from ?? current.url, hasStarted: false };
}

/**
 * Folds a page state into the pending navigation: a new URL commits it, a load that ends (or fails) still on the old URL
 * drops it, so the bar falls back. `url` is what the bar shows; empty while neither side has one.
 */
export function settleNavigation(
  pending: PendingNavigation | null,
  state: NavigationState,
) {
  const next = pending && stillPending(pending, state);
  return {
    pending: next,
    url: next?.url ?? (state.url || pending?.from || ''),
  };
}

function stillPending(pending: PendingNavigation, state: NavigationState) {
  if (state.url && state.url !== pending.from) return null;
  // States from before the load starts belong to the old page, its stale error included.
  const hasStarted = pending.hasStarted || state.isLoading;
  if (hasStarted && (!state.isLoading || state.error)) return null;
  return hasStarted === pending.hasStarted
    ? pending
    : { ...pending, hasStarted };
}
