import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { host } from '../host';
import { DEFAULT_SETTINGS, type ModelChoice } from '../host/types/settings';
import type { Thread } from '../model';
import { sideChatChoice } from '../runtime/controls';
import { useHarness } from '../store';
import { chatFor, type Quote } from '../store/sidechat';
import { askSideChat } from './ask';

export function useSideChat(thread: Thread, tabId: string) {
  const { state, dispatch } = useHarness();
  const chat = chatFor(state, thread.id, tabId);
  const at = { threadId: thread.id, tabId };
  const isStreaming = chat.messages.some((m) => m.isStreaming);
  const [defaultModel] = useSideChatDefault();
  const model = chat.model ?? defaultModel ?? sideChatChoice(DEFAULT_SETTINGS.sideChatModel);
  // Codex has no spare process to park.
  const isClaude = model.provider === 'claude';
  useEffect(() => void (isClaude && host.agent.warm(thread.spaceId).catch(() => {})), [thread.spaceId, isClaude]);

  const ask = (text: string) => askSideChat(thread, tabId, chat, model, text, dispatch);

  // A ref, not the reducer alone: StrictMode runs this effect twice before `sidechat-ask` clears `pending`.
  const asked = useRef<string>(undefined);
  useEffect(() => {
    if (!chat.pending || asked.current === chat.pending || !(chat.model || defaultModel)) return;
    asked.current = chat.pending;
    void ask(chat.pending);
  });

  return {
    chat,
    isStreaming,
    model,
    setModel: (choice: ModelChoice) => dispatch({ type: 'sidechat-model', ...at, model: choice }),
    ask,
    setDraft: (quote?: Quote) => dispatch({ type: 'sidechat-draft', ...at, quote }),
    clear: () => dispatch({ type: 'sidechat-clear', ...at }),
    promote: (id: string, to: 'message' | 'thread') => dispatch({ type: 'sidechat-promote', ...at, id, to }),
  };
}

/** Settings › Defaults' side chat model, old catalog ids read as the provider's own (null until read), and a setter that saves it. */
export function useSideChatDefault() {
  const [model, setModel] = useState<ModelChoice | null>(null);
  useEffect(() => {
    let isCurrent = true;
    host.settings.get().then(
      (s) => isCurrent && setModel(sideChatChoice(s.sideChatModel)),
      () => {},
    );
    return () => {
      isCurrent = false;
    };
  }, []);
  const save = (choice: ModelChoice) => {
    setModel(choice);
    host.settings.set({ sideChatModel: choice }).catch((error: Error) => toast.error('Side chat model not saved', { description: error.message }));
  };
  return [model, save] as const;
}
