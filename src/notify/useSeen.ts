import { useEffect, useEffectEvent } from 'react';
import { useDispatch, useGetState } from '../store';
import { markSeen, type SeenAction } from '../store/seen';

type Target = Omit<SeenAction, 'type'>;

/**
 * Marks a thread read when it opens and again when it closes (what arrived while you watched), or Queue cards when you leave
 * the Queue, so their dots last the visit. Under `RemoteScope` this becomes a `seen` command to the thread's computer.
 */
export function useSeen(target: Target, when: 'open-and-leave' | 'leave') {
  const dispatch = useDispatch();
  const getState = useGetState();
  const { threadId } = target;
  const markRead = useEffectEvent((opened: typeof threadId) => {
    const state = getState();
    const marked = { type: 'seen' as const, ...(opened ? { threadId: opened } : target) };
    if (markSeen(state, marked) !== state) dispatch(marked);
  });
  useEffect(() => {
    // The thread this effect opened, not the one the route has already moved on to.
    const mark = () => markRead(threadId);
    if (when === 'open-and-leave') mark();
    return mark;
  }, [threadId, when]);
}

/** `useSeen` for a spot that sits under `RemoteScope` without a component of its own. */
export function Seen({ when, ...target }: Target & { when: 'open-and-leave' | 'leave' }) {
  useSeen(target, when);
  return null;
}
