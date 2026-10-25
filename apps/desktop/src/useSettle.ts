import type { Dispatch } from 'react';
import { toast } from './toast/store.ts';
import type { Thread } from './model';
import { type Action, useDispatch } from './store';
import { plural } from '@mochi/domain/lib/format';

/** Settle or reactivate a thread, with an undo toast. */
export function useSettle(thread: Thread) {
  const dispatch = useDispatch();
  return {
    isSettled: thread.status === 'settled',
    toggle: () => toggleSettle([thread], dispatch),
  };
}

/** Settles or reactivates every thread in `threads` (all in the state of the first), with one undo toast covering them all. */
export function toggleSettle(threads: Thread[], dispatch: Dispatch<Action>) {
  const isSettled = threads[0]?.status === 'settled';
  const each = (type: 'settle' | 'unsettle') =>
    threads.forEach((t) => dispatch({ type, threadId: t.id }));
  each(isSettled ? 'unsettle' : 'settle');
  const count = plural(threads.length, 'Thread', `${threads.length} threads`);
  toast(isSettled ? `${count} active again` : `${count} archived`, {
    description: isSettled
      ? undefined
      : 'Agent, terminals and dev servers stopped, PR watches too.',
    action: {
      label: 'Undo',
      onClick: () => each(isSettled ? 'settle' : 'unsettle'),
    },
  });
}
