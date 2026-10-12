import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { pinnedThreads, togglePin } from '../reorder';
import { useHarness, type State } from '../store';
import { ARROW_SIDE, findLeaf, neighbourInDirection, type Rect } from './tree';
import { isMod, isNav } from '../keys';

/**
 * Split and pin shortcuts. mod [ / ] and nav arrows move focus, mod Shift Enter zooms, mod \ splits,
 * mod 1–9 jumps to pinned N, mod alt 1–9 opens it in a new split, mod Shift P pins or unpins the focused thread.
 * Digits use `e.code`: Option turns `e.key` into symbols on macOS.
 */
export function useLayoutKeys() {
  const { state, dispatch } = useHarness();
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const s = latest.current;
      const layout = s.layouts[s.spaceId];
      const handled = () => e.preventDefault();

      if (isNav(e) && e.key in ARROW_SIDE) {
        const to = neighbourInDirection(leafRects(), layout.focusId, ARROW_SIDE[e.key as keyof typeof ARROW_SIDE]);
        if (!to) return;
        handled();
        return dispatch({ type: 'layout-focus', leafId: to });
      }
      if (!isMod(e)) return;
      if (!e.shiftKey && !e.altKey && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
        handled();
        return dispatch({ type: 'layout-focus-step', step: e.code === 'BracketLeft' ? -1 : 1 });
      }
      if (e.shiftKey && e.key === 'Enter') {
        handled();
        return dispatch({ type: 'layout-zoom' });
      }
      if (!e.shiftKey && e.code === 'Backslash') {
        handled();
        return dispatch({ type: 'layout-split', view: { kind: 'new' } });
      }
      if (e.shiftKey && e.code === 'KeyP') {
        handled();
        return pinFocused(s, dispatch);
      }
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (!digit || e.shiftKey) return;
      const thread = pinnedThreads(s.threads, s.spaceId)[Number(digit[1]) - 1];
      if (!thread) return;
      handled();
      const view = { kind: 'thread', id: thread.id } as const;
      dispatch(e.altKey ? { type: 'layout-split', view } : { type: 'go', view });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch]);
}

function leafRects() {
  const rects: Record<string, Rect> = {};
  for (const el of document.querySelectorAll<HTMLElement>('[data-leaf-id]')) rects[el.dataset.leafId!] = el.getBoundingClientRect();
  return rects;
}

function pinFocused(s: State, dispatch: ReturnType<typeof useHarness>['dispatch']) {
  const layout = s.layouts[s.spaceId];
  const view = findLeaf(layout.root, layout.focusId)?.view;
  if (view?.kind !== 'thread') return;
  const thread = s.threads.find((t) => t.id === view.id);
  if (!thread || thread.status === 'settled') return;
  const lists = togglePin(s.threads, s.spaceId, thread.id);
  if (!lists) return toast('Pinned is full', { description: 'Orbit has five pin slots. Unpin a thread first.' });
  dispatch({ type: 'reorder', ...lists });
  toast(lists.pinned.includes(thread.id) ? `Pinned ${thread.title}` : `Unpinned ${thread.title}`);
}
