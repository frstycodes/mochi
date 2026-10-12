import type { Dispatch } from 'react';
import { toast } from 'sonner';
import type { Thread } from './model';
import { useHarness, type Action } from './store';

/** Settle or reactivate a thread, with an undo toast. */
export function useSettle(thread: Thread) {
  const { dispatch } = useHarness();
  return { isSettled: thread.status === 'settled', toggle: () => toggleSettle(thread, dispatch) };
}

export function toggleSettle(thread: Thread, dispatch: Dispatch<Action>) {
  const isSettled = thread.status === 'settled';
  dispatch({ type: isSettled ? 'unsettle' : 'settle', threadId: thread.id });
  toast(isSettled ? 'Thread is active again' : 'Thread settled', {
    description: isSettled ? undefined : 'Idle terminals closed, PR watches stopped.',
    action: { label: 'Undo', onClick: () => dispatch({ type: isSettled ? 'settle' : 'unsettle', threadId: thread.id }) },
  });
}
