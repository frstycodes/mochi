import { toast } from 'sonner';
import type { Thread } from './model';
import { useHarness } from './store';

/** Settle or reactivate a thread, with an undo toast. */
export function useSettle(thread: Thread) {
  const { dispatch } = useHarness();
  const isSettled = thread.status === 'settled';
  const toggle = () => {
    dispatch({ type: isSettled ? 'unsettle' : 'settle', threadId: thread.id });
    toast(isSettled ? 'Thread is active again' : 'Thread settled', {
      description: isSettled ? undefined : 'Idle terminals closed, PR watches stopped.',
      action: { label: 'Undo', onClick: () => dispatch({ type: isSettled ? 'settle' : 'unsettle', threadId: thread.id }) },
    });
  };
  return { isSettled, toggle };
}
