import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { RewindMode } from './checkpoints.ts';
import type { ForkPoint } from './fork.ts';

/** What the rewind layer of a thread should show; menus, step rows and the timeline open these, `RewindLayer` renders them. */
export type RewindRequest =
  /** `n` or `message` (an activity index) confirms that rewind, in `mode` (default: the one you ran last); neither picks a checkpoint first. */
  | {
      kind: 'rewind';
      threadId: string;
      n?: number;
      message?: number;
      mode?: RewindMode;
    }
  | { kind: 'fork'; threadId: string; point?: ForkPoint }
  | { kind: 'compare'; threadId: string; otherId: string };

const requestStore = createStore<{ request: RewindRequest | null }>(() => ({
  request: null,
}));

export function openRewind(request: RewindRequest | null) {
  requestStore.setState({ request });
}

export function useRewindRequest(threadId: string) {
  return useStore(requestStore, ({ request }) =>
    request?.threadId === threadId ? request : null,
  );
}
