import type { Action, State } from './types.ts';
import type { Quote, SideMessage } from './sidechat.ts';

/**
 * The side chat other computers ask on one of this computer's threads. It runs here, on this computer's agent and account
 * (`remote/commands.ts` `sideChat`), and lives in Core's projection beside the thread, not in the window's `sidechats`:
 * Core saves it in the thread's file (`Persist.SavedThread.sideChat`), so the `thread` stream every follower already reads
 * carries it, at the pace an agent's reply streams (Core writes changed threads about twice a second). Only these asks
 * are saved; this computer's own side chats stay in its window. Bounded to the latest `MAX_MESSAGES`.
 */
export interface RemoteSideChat {
  messages: SideMessage[];
}

export interface RemoteSideChatState {
  /** Thread id → its remote side chat. */
  remoteSideChats: Record<string, RemoteSideChat>;
}

export type RemoteSideChatAction =
  /** Another computer asked: the question and an empty answer that streams in. On a follower it is the `side-chat` command. */
  | {
      type: 'remote-sidechat-ask';
      threadId: string;
      id: string;
      text: string;
      quote?: Quote;
    }
  | {
      type: 'remote-sidechat-stream';
      threadId: string;
      id: string;
      text: string;
      isDone?: boolean;
    };

/** The tab id the remote side chat shows under in a side chat pane's store (`chatFor`), here and in a mirror. */
export const REMOTE_SIDE_CHAT_TAB = 'remote';

/** Questions and answers kept per thread; older ones drop off, so a long-lived thread's file doesn't grow with every ask. */
export const MAX_MESSAGES = 40;

const EMPTY: RemoteSideChat = { messages: [] };

/** A domain slice (`@mochi/domain` `DOMAIN_SLICES`): Core and every window fold it alike. */
export function remoteSideChatReducer(state: State, action: Action): State {
  switch (action.type) {
    case 'remote-sidechat-ask': {
      const question: SideMessage = {
        id: `${action.id}-q`,
        role: 'user',
        text: action.text,
        ...(action.quote && { quote: action.quote }),
      };
      const answer: SideMessage = {
        id: action.id,
        role: 'assistant',
        text: '',
        isStreaming: true,
      };
      return patch(state, action.threadId, (c) => ({
        messages: [...c.messages, question, answer].slice(-MAX_MESSAGES),
      }));
    }
    case 'remote-sidechat-stream':
      return patch(state, action.threadId, (c) => ({
        messages: c.messages.map((m) =>
          m.id === action.id
            ? { ...m, text: m.text + action.text, isStreaming: !action.isDone }
            : m,
        ),
      }));
    // The window asking reloaded: an answer it was streaming never ends, so it stops spinning.
    case 'window-loaded': {
      const streaming = Object.entries(state.remoteSideChats).filter(([, c]) =>
        c.messages.some((m) => m.isStreaming),
      );
      if (!streaming.length) return state;
      return {
        ...state,
        remoteSideChats: {
          ...state.remoteSideChats,
          ...Object.fromEntries(
            streaming.map(([id, c]) => [
              id,
              {
                messages: c.messages.map((m) =>
                  m.isStreaming ? { ...m, isStreaming: false } : m,
                ),
              },
            ]),
          ),
        },
      };
    }
    case 'delete': {
      if (!action.threadIds.some((id) => id in state.remoteSideChats))
        return state;
      return {
        ...state,
        remoteSideChats: Object.fromEntries(
          Object.entries(state.remoteSideChats).filter(
            ([id]) => !action.threadIds.includes(id),
          ),
        ),
      };
    }
    default:
      return state;
  }
}

function patch(
  state: State,
  threadId: string,
  fn: (chat: RemoteSideChat) => RemoteSideChat,
): State {
  if (!state.threads.some((t) => t.id === threadId)) return state;
  return {
    ...state,
    remoteSideChats: {
      ...state.remoteSideChats,
      [threadId]: fn(state.remoteSideChats[threadId] ?? EMPTY),
    },
  };
}
