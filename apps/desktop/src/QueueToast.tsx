import { useEffect, useState } from 'react';
import { dismiss, getToasts } from './toast/store';
import { QueueDecision } from './QueueView';
import { useHarness } from './store';

/**
 * Options for a toast about a queue item: clicking it opens the item's card in place. Decided in there, the toast becomes the
 * outcome (with its Undo); decided anywhere else, it leaves.
 */
export function queueToast(queueId: string) {
  return {
    id: queueToastId(queueId),
    expand: <QueueToastWidget queueId={queueId} />,
  };
}

const queueToastId = (queueId: string) => `queue:${queueId}`;

/**
 * Dismisses each queue toast whose item was decided elsewhere (the Queue or the thread). One decided inside its own widget has
 * already become the outcome toast, with no widget left, and stays.
 */
export function useResolvedQueueToasts() {
  const { state } = useHarness();
  useEffect(() => {
    const pending = new Set(state.queue.map((q) => queueToastId(q.id)));
    for (const t of getToasts())
      if (t.id.startsWith('queue:') && !!t.expand && !pending.has(t.id))
        dismiss(t.id);
  }, [state.queue]);
}

function QueueToastWidget({ queueId }: { queueId: string }) {
  const { state } = useHarness();
  const pending = state.queue.find((q) => q.id === queueId);
  // Keeps showing the item as it was once it's decided, while the card fades it out into the outcome.
  const [last, setLast] = useState(pending);
  if (pending && pending !== last) setLast(pending);
  const item = pending ?? last;
  return (
    !!item && (
      <QueueDecision
        item={item}
        showThread
        className="bg-transparent shadow-none ring-0 *:data-[slot=card-footer]:border-t-0 *:data-[slot=card-footer]:bg-transparent *:data-[slot=card-footer]:pt-0 *:data-[slot=card-header]:pr-9"
      />
    )
  );
}
