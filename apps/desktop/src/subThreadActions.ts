import type { Dispatch } from 'react';
import type { Thread } from './model';
import { nestBlocker, pinOrderOf } from './reorder';
import type { Action } from './store';
import { toast } from './toast/store';

/** Nests a thread with an undo toast that puts it back where it was. */
export function nestWithUndo(
  dispatch: Dispatch<Action>,
  threads: Thread[],
  thread: Thread,
  parentId: string,
) {
  const parent = threads.find((t) => t.id === parentId);
  if (!parent || nestBlocker(threads, thread.id, parentId)) return;
  const before = thread.parent;
  const pinOrder = thread.orbitSlot === undefined ? null : pinOrderOf(thread);
  dispatch({ type: 'nest', threadId: thread.id, parentId });
  toast(`Now a sub-thread of “${parent.title}”`, {
    description: thread.title,
    action: {
      label: 'Undo',
      onClick: () => {
        dispatch(
          before
            ? {
                type: 'nest',
                threadId: thread.id,
                parentId: before.threadId,
              }
            : { type: 'unnest', threadId: thread.id },
        );
        // Nesting unpinned it; its pin comes back in the place it had.
        if (pinOrder !== null)
          dispatch({ type: 'pin-at', threadId: thread.id, order: pinOrder });
      },
    },
  });
}

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
