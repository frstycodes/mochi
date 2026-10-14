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
    case 'go':
      return action.view.kind === 'thread' ? { type: 'open', threadId: action.view.id } : null;
    default:
      return null;
  }
}
