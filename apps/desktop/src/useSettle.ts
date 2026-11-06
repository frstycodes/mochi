import type { Dispatch } from 'react';
import type { Thread } from './model';
import { type Action, useDispatch } from './store';

/** Threads settled this session, newest last: what Cmd/Ctrl+Z reactivates, one entry per settle. */
const settledStack: string[][] = [];

/** Reactivates the most recently settled threads that are still settled (a reactivate from the menu may have beaten us to them). False when nothing was left to undo. */
export function undoLastSettle(
  threads: Thread[],
  dispatch: Dispatch<Action>,
): boolean {
  while (settledStack.length) {
    const ids = new Set(settledStack.pop());
    const back = threads.filter((t) => ids.has(t.id) && t.status === 'settled');
    if (!back.length) continue;
    toggleSettle(back, dispatch);
    return true;
  }
  return false;
}

/** Settle or reactivate a thread; Cmd/Ctrl+Z takes a settle back. */
export function useSettle(thread: Thread) {
  const dispatch = useDispatch();
  return {
    isSettled: thread.status === 'settled',
    toggle: () => toggleSettle([thread], dispatch),
  };
}

/** Settles or reactivates every thread in `threads` (all in the state of the first). No toast: you did it yourself; a settle is remembered for `undoLastSettle`. */
export function toggleSettle(threads: Thread[], dispatch: Dispatch<Action>) {
  const isSettled = threads[0]?.status === 'settled';
  const type = isSettled ? 'unsettle' : 'settle';
  threads.forEach((t) => dispatch({ type, threadId: t.id }));
  if (!isSettled) settledStack.push(threads.map((t) => t.id));
}
