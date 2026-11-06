import { useState } from 'react';
import { isStreamedOnly, type Thread } from '../model.ts';

/**
 * `thread`, or the one already shown while only the text of its entries grew (`isStreamedOnly`, no entry added). For views that
 * don't show the reply being written: they skip the render each streamed batch would cost them.
 */
export function useWithoutStreamedText(thread: Thread) {
  const [held, setHeld] = useState(thread);
  const isSame =
    held === thread ||
    (isStreamedOnly(held, thread) &&
      held.activity.length === thread.activity.length);
  if (!isSame) setHeld(thread);
  return isSame ? held : thread;
}
