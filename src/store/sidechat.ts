import type { Action, State } from './index.tsx';
import { panesReducer } from './panes.ts';
import { threadsReducer } from './threads.ts';

export type QuoteSource = 'diff' | 'terminal' | 'file';

export interface Quote {
  source: QuoteSource;
  /** Where it came from: `apps/api/gateway.ts @@ -12,6 +12,9 @@`, `zsh`, `src/App.tsx:40–52`. */
  label: string;
  text: string;
}

export interface SideMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  quote?: Quote;
  isStreaming?: boolean;
  promotedTo?: 'message' | 'thread';
}

export interface SideChat {
  messages: SideMessage[];
  /** A selection waiting in the composer for its question. */
  draft?: Quote;
}

/** threadId → pane tab id → chat. Lives beside the thread, never inside it, so asking can't touch goal, steps or activity. */
export interface SideChatState {
  sidechats: Record<string, Record<string, SideChat>>;
}

export type SideChatAction =
  | { type: 'sidechat-open'; threadId: string; quote?: Quote }
  | { type: 'sidechat-draft'; threadId: string; tabId: string; quote?: Quote }
  | { type: 'sidechat-ask'; threadId: string; tabId: string; id: string; text: string }
  | { type: 'sidechat-stream'; threadId: string; tabId: string; id: string; text: string; isDone?: boolean }
  | { type: 'sidechat-clear'; threadId: string; tabId: string }
  /** Every side chat at once: Settings › Data clears them and its undo puts them back. */
  | { type: 'sidechat-replace'; sidechats: SideChatState['sidechats'] }
  | { type: 'sidechat-promote'; threadId: string; tabId: string; id: string; to: 'message' | 'thread' };

export const SIDECHAT_STORAGE_KEY = 'harness.sidechat.v1';
const EMPTY: SideChat = { messages: [] };

export function initialSideChat(saved = loadSideChats()): SideChatState {
  return { sidechats: saved };
}

export function sidechatReducer(state: State, action: Action): State {
  switch (action.type) {
    case 'sidechat-open':
      return open(state, action.threadId, action.quote);
    case 'sidechat-draft':
      return patchChat(state, action.threadId, action.tabId, (c) => ({ ...c, draft: action.quote }));
    case 'sidechat-ask': {
      const question: SideMessage = { id: `${action.id}-q`, role: 'user', text: action.text };
      const answer: SideMessage = { id: action.id, role: 'assistant', text: '', isStreaming: true };
      return patchChat(state, action.threadId, action.tabId, (c) => ({ messages: [...c.messages, { ...question, quote: c.draft }, answer] }));
    }
    case 'sidechat-stream':
      return patchMessage(state, action, (m) => ({ ...m, text: m.text + action.text, isStreaming: !action.isDone }));
    case 'sidechat-clear':
      return patchChat(state, action.threadId, action.tabId, () => EMPTY);
    case 'sidechat-replace':
      return { ...state, sidechats: action.sidechats };
    case 'sidechat-promote':
      return promote(state, action);
    default:
      return state;
  }
}

export function chatFor(state: SideChatState, threadId: string, tabId: string): SideChat {
  return state.sidechats[threadId]?.[tabId] ?? EMPTY;
}

/** The question as the agent reads it: the quote as a labelled block above the text. */
export function questionText(message: SideMessage) {
  if (!message.quote) return message.text;
  const quoted = `> **${SOURCE_NAMES[message.quote.source]}** ${message.quote.label}\n\n\`\`\`\n${message.quote.text}\n\`\`\``;
  return `${quoted}\n\n${message.text}`;
}

export const SOURCE_NAMES = { diff: 'Diff hunk', terminal: 'Terminal output', file: 'File range' } satisfies Record<QuoteSource, string>;

export function saveSideChats(sidechats: SideChatState['sidechats']) {
  try {
    localStorage.setItem(SIDECHAT_STORAGE_KEY, JSON.stringify(sidechats));
  } catch {
    // Storage blocked (private window, artifact sandbox): side chats last for the session.
  }
}

function loadSideChats(): SideChatState['sidechats'] {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(SIDECHAT_STORAGE_KEY);
    const saved: SideChatState['sidechats'] = raw ? JSON.parse(raw) : {};
    // A reload cuts any answer mid-stream; its listener is gone, so it would spin forever.
    return mapChats(saved, (c) => ({ ...c, messages: c.messages.map((m) => ({ ...m, isStreaming: false })) }));
  } catch {
    return {};
  }
}

/** Reuses the thread's newest side chat tab, else opens one, and parks the quote in its composer. */
function open(state: State, threadId: string, quote?: Quote): State {
  const existing = state.panes.find((p) => p.threadId === threadId)?.tabs.findLast((t) => t.kind === 'sidechat' && !t.isPopped);
  const next = existing
    ? panesReducer(state, { type: 'pane-select-tab', threadId, tabId: existing.id })
    : panesReducer(state, { type: 'pane-open-tab', threadId, kind: 'sidechat' });
  const opened = { ...next, panes: next.panes.map((p) => (p.threadId === threadId ? { ...p, isOpen: true } : p)) };
  const tabId = opened.panes.find((p) => p.threadId === threadId)!.activeTab;
  if (!quote) return opened;
  return patchChat(opened, threadId, tabId, (c) => ({ ...c, draft: quote }));
}

function promote(state: State, action: Extract<Action, { type: 'sidechat-promote' }>): State {
  const thread = state.threads.find((t) => t.id === action.threadId);
  const messages = chatFor(state, action.threadId, action.tabId).messages;
  const i = messages.findIndex((m) => m.id === action.id);
  const answer = messages[i];
  if (!thread || !answer || answer.isStreaming) return state;
  const question = messages[i - 1];
  const text = `From the side chat:\n\n${answer.text}`;
  const marked = patchMessage(state, action, (m) => ({ ...m, promotedTo: action.to }));
  if (action.to === 'message') return threadsReducer(marked, { type: 'say', threadId: thread.id, entry: { who: 'you', kind: 'message', text } });
  const newId = `new-${state.seq}`;
  const created = threadsReducer(marked, { type: 'create', title: question?.text || answer.text.split('\n')[0], provider: thread.providers[0], project: thread.repo?.project ?? null });
  return threadsReducer(created, { type: 'say', threadId: newId, entry: { who: 'you', kind: 'message', text } });
}

function patchChat(state: State, threadId: string, tabId: string, fn: (chat: SideChat) => SideChat): State {
  const byTab = state.sidechats[threadId] ?? {};
  return { ...state, sidechats: { ...state.sidechats, [threadId]: { ...byTab, [tabId]: fn(byTab[tabId] ?? EMPTY) } } };
}

function patchMessage(state: State, at: { threadId: string; tabId: string; id: string }, fn: (m: SideMessage) => SideMessage): State {
  return patchChat(state, at.threadId, at.tabId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === at.id ? fn(m) : m)) }));
}

function mapChats(all: SideChatState['sidechats'], fn: (chat: SideChat) => SideChat) {
  return Object.fromEntries(Object.entries(all).map(([threadId, byTab]) => [threadId, Object.fromEntries(Object.entries(byTab).map(([tabId, chat]) => [tabId, fn(chat)]))]));
}
