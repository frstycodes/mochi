import type { RemoteCommand } from '../host/types/remote.ts';
import type { Action } from '../store/index.tsx';

/**
 * What a store action means on another computer's thread: the command that does it there, `open` for going to one of its
 * threads, or null for what a device can't do (yet). The shared UI (Queue cards, sidebar rows) dispatches as it does at home.
 */
export function commandFor(action: Action): RemoteCommand | { type: 'open'; threadId: string } | null {
  switch (action.type) {
    case 'answer':
      return { type: 'resolve', queueId: action.queueId, ...(action.answers && { answers: action.answers }) };
    case 'interrupt':
      return { type: 'interrupt', threadId: action.threadId };
    case 'rename':
      return { type: 'rename', threadId: action.threadId, title: action.title };
    case 'settle':
    case 'unsettle':
      return { type: 'settle', threadId: action.threadId, isSettled: action.type === 'settle' };
    case 'handoff':
      return { type: 'handoff', threadId: action.threadId, to: action.to };
    case 'fork':
      return { type: 'fork', threadId: action.threadId, point: action.point };
    case 'rewind':
      return { type: 'rewind', threadId: action.threadId, point: { kind: 'checkpoint', n: action.n }, mode: action.mode ?? 'files' };
    case 'rewind-message':
      return { type: 'rewind', threadId: action.threadId, point: { kind: 'message', index: action.index }, mode: action.mode ?? 'files' };
    case 'edit-goal':
      return { type: 'edit-goal', threadId: action.threadId, goal: action.draft.goal };
    case 'pin-at':
      return { type: 'pin', threadId: action.threadId, isPinned: true, order: action.order };
    case 'delete':
      return action.threadIds.length === 1 ? { type: 'delete', threadId: action.threadIds[0] } : null;
    case 'go':
      return action.view.kind === 'thread' ? { type: 'open', threadId: action.view.id } : null;
    default:
      return null;
  }
}
