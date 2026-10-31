import type { Dispatch } from 'react';
import type { Thread } from './model';
import type { Action } from './store';
import { toast } from './toast/store';

export function unnestWithUndo(
  dispatch: Dispatch<Action>,
  threads: Thread[],
  thread: Thread,
) {
  const link = thread.parent!;
  const parent = threads.find((t) => t.id === link.threadId);
  dispatch({ type: 'unnest', threadId: thread.id });
  toast(`${thread.title} is a thread of its own again`, {
    description: parent
      ? `It was a sub-thread of “${parent.title}”`
      : undefined,
    action: {
      label: 'Undo',
      onClick: () =>
        dispatch({
          type: 'nest',
          threadId: thread.id,
          parentId: link.threadId,
        }),
    },
  });
}
