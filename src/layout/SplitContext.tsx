import { createContext, useContext } from 'react';

export interface SplitInfo {
  leafId: string;
  isFocused: boolean;
  /** More than one split on screen (zoomed counts): split chrome shows. */
  isMulti: boolean;
  isZoomed: boolean;
  /** Top-left split: the only one that carries the sidebar toggle, so it never jumps between headers. */
  isFirst: boolean;
  /** Wide enough to dock the summary column and the side pane; narrower splits fold them into a sheet and a tab. */
  isWide: boolean;
}

export const SplitContext = createContext<SplitInfo | null>(null);

/** Inside a read-only preview (a pinned page beside the one in view): native overlays such as browser views must not attach. */
export const PreviewContext = createContext(false);

export function useSplit() {
  const split = useContext(SplitContext);
  if (!split) throw new Error('useSplit must be used inside a Workspace leaf');
  return split;
}
