import type { Dispatch } from 'react';
import { toast } from 'sonner';
import type { Thread } from './model';
import { useHarness, type Action } from './store';

/** Settle or reactivate a thread, with an undo toast. */
export function useSettle(thread: Thread) {
  const { dispatch } = useHarness();
  return { isSettled: thread.status === 'settled', toggle: () => toggleSettle([thread], dispatch) };
}

/** Settles or reactivates every thread in `threads` (all in the state of the first), with one undo toast covering them all. */
export function toggleSettle(threads: Thread[], dispatch: Dispatch<Action>) {
  const isSettled = threads[0]?.status === 'settled';
  const each = (type: 'settle' | 'unsettle') => threads.forEach((t) => dispatch({ type, threadId: t.id }));
  each(isSettled ? 'unsettle' : 'settle');
  const count = threads.length === 1 ? 'Thread' : `${threads.length} threads`;
  toast(isSettled ? `${count} active again` : `${count} settled`, {
    description: isSettled ? undefined : 'Idle terminals closed, PR watches stopped.',
    action: { label: 'Undo', onClick: () => each(isSettled ? 'settle' : 'unsettle') },
  });
}
