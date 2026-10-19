import { useEffect, useRef } from 'react';
import { toast } from '../toast/store.ts';
import { pinnedThreads, togglePin } from '../reorder';
import { useHarness, type State } from '../store';
import { ARROW_SIDE, findLeaf, neighbourInDirection, type Rect } from './tree';
import { commandOf, pinnedCommand, type CommandId } from '../keymap';
import { startRename } from '../rename';

const FOCUS = { 'split-focus-left': 'ArrowLeft', 'split-focus-right': 'ArrowRight', 'split-focus-up': 'ArrowUp', 'split-focus-down': 'ArrowDown' } as const satisfies Partial<Record<CommandId, keyof typeof ARROW_SIDE>>;

const PINNED = [1, 2, 3, 4, 5].flatMap((n) => [pinnedCommand(n), pinnedCommand(n, true)]);

const COMMANDS = [...(Object.keys(FOCUS) as (keyof typeof FOCUS)[]), 'split-focus-previous', 'split-focus-next', 'layout-zoom', 'layout-split', 'thread-pin', 'thread-rename', ...PINNED] as const satisfies CommandId[];

/** Split and pin commands (`src/keymap.ts`): move focus between splits, zoom, split, pin or rename the focused thread, jump to pinned N here or in a new split. */
export function useLayoutKeys() {
  const { state, dispatch } = useHarness();
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const command = commandOf(e, COMMANDS);
      if (!command) return;
      const s = latest.current;
      const layout = s.layouts[s.spaceId];
      const handled = () => e.preventDefault();

      if (command in FOCUS) {
        const to = neighbourInDirection(leafRects(), layout.focusId, ARROW_SIDE[FOCUS[command as keyof typeof FOCUS]]);
        if (!to) return;
        handled();
        return dispatch({ type: 'layout-focus', leafId: to });
      }
      if (command === 'split-focus-previous' || command === 'split-focus-next') {
        handled();
        return dispatch({ type: 'layout-focus-step', step: command === 'split-focus-previous' ? -1 : 1 });
      }
      if (command === 'layout-zoom') {
        handled();
        return dispatch({ type: 'layout-zoom' });
      }
      if (command === 'layout-split') {
        handled();
        return dispatch({ type: 'layout-split', view: { kind: 'new' } });
      }
      if (command === 'thread-pin') {
        handled();
        return pinFocused(s, dispatch);
      }
      if (command === 'thread-rename') {
        const rowId = e.target instanceof Element ? e.target.closest('[data-thread-row]')?.getAttribute('data-thread-row') : undefined;
        const id = rowId ?? focusedThreadId(s);
        if (!id) return;
        handled();
        return startRename(id, rowId ? 'row' : 'dialog');
      }
      const index = PINNED.indexOf(command);
      const thread = pinnedThreads(s.threads, s.spaceId)[Math.floor(index / 2)];
      if (!thread) return;
      handled();
      const view = { kind: 'thread', id: thread.id } as const;
      dispatch(index % 2 ? { type: 'layout-split', view } : { type: 'go', view });
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
  const thread = s.threads.find((t) => t.id === focusedThreadId(s));
  if (!thread || thread.status === 'settled') return;
  const lists = togglePin(s.threads, s.spaceId, thread.id);
  if (!lists) return toast('Pinned is full', { description: 'Orbit has five pin slots. Unpin a thread first.' });
  dispatch({ type: 'reorder', ...lists, at: Date.now() });
  toast(lists.pinned.includes(thread.id) ? `Pinned ${thread.title}` : `Unpinned ${thread.title}`);
}

function focusedThreadId(s: State) {
  const layout = s.layouts[s.spaceId];
  const view = findLeaf(layout.root, layout.focusId)?.view;
  return view?.kind === 'thread' ? view.id : undefined;
}
