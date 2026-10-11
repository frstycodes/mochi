import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { ThreadStatus } from '../model';
import { useHarness } from '../store';

const WATCH_MESSAGE = { 'needs-you': 'needs you', review: 'is done and ready for review' } satisfies Partial<Record<ThreadStatus, string>>;

/** In-app toast when a watched thread starts needing you or finishes. GAP: OS notifications and CI failures arrive with the `notify` session. */
export function useWatchToasts() {
  const { state, dispatch } = useHarness();
  const last = useRef(new Map(state.threads.map((t) => [t.id, t.status])));

  useEffect(() => {
    for (const t of state.threads) {
      const before = last.current.get(t.id);
      last.current.set(t.id, t.status);
      if (before === t.status || !state.watched.includes(t.id) || !(t.status in WATCH_MESSAGE)) continue;
      toast(`${t.title} ${WATCH_MESSAGE[t.status as keyof typeof WATCH_MESSAGE]}`, {
        action: { label: 'Open', onClick: () => dispatch({ type: 'go', view: { kind: 'thread', id: t.id } }) },
      });
    }
  }, [state.threads, state.watched, dispatch]);
}
