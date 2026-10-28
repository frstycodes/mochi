import { useQuery } from '@tanstack/react-query';
import { queryClient } from '../query.ts';
import { queryKeys } from '../queryKeys.ts';
import { useEffect, useRef } from 'react';
import { toast } from '../toast/store.ts';
import { host } from '../host';
import { DEFAULT_SETTINGS, type ModelChoice } from '../host/types/settings';
import type { Thread } from '../model';
import { sideChatChoice } from '../runtime/controls';
import { useHarness } from '../store';
import { useRemoteMachine } from '../remote/origin';
import { remoteSideChatBlocker } from '../remote/sideChat';
import { chatFor, promotedText, type Quote } from '../store/sidechat';
import { askSideChat } from './ask';

/**
 * The side chat in tab `tabId`. On another computer's thread (`RemoteThreadScope`) it is that computer's: asked and answered
 * there, its messages from the mirror; `remote` then says where, and why asking can't go now.
 */
export function useSideChat(thread: Thread, tabId: string) {
  const { state, dispatch } = useHarness();
  const machine = useRemoteMachine();
  const blocker = machine && remoteSideChatBlocker(machine);
  const chat = chatFor(state, thread.id, tabId);
  const at = { threadId: thread.id, tabId };
  const isStreaming = chat.messages.some((m) => m.isStreaming);
  const [defaultModel] = useSideChatDefault();
  const model =
    chat.model ??
    defaultModel ??
    sideChatChoice(DEFAULT_SETTINGS.sideChatModel);
  // Codex has no spare process to park.
  const isClaude = model.provider === 'claude';
  const isLocal = !machine;
  useEffect(
    () =>
      void (
        isLocal &&
        isClaude &&
        host.agent.warm(thread.spaceId).catch(() => {})
      ),
    [thread.spaceId, isClaude, isLocal],
  );

  // On another computer's thread the scope sends this as its `side-chat` command; the quote and waiting question clear here.
  const askThere = async (text: string) => {
    if (blocker) return void toast(blocker);
    dispatch({
      type: 'remote-sidechat-ask',
      threadId: thread.id,
      id: `side-${Date.now()}`,
      text,
      ...(chat.draft && { quote: chat.draft }),
    });
    dispatch({ type: 'sidechat-clear', ...at });
  };
  const ask = (text: string) =>
    machine
      ? askThere(text)
      : askSideChat(thread, tabId, chat, model, text, dispatch);

  // A ref, not the reducer alone: StrictMode runs this effect twice before `sidechat-ask` clears `pending`.
  const asked = useRef<string>(undefined);
  useEffect(() => {
    if (
      !chat.pending ||
      asked.current === chat.pending ||
      !(machine || chat.model || defaultModel)
    )
      return;
    asked.current = chat.pending;
    void ask(chat.pending);
  });

  return {
    chat,
    isStreaming,
    model,
    setModel: (choice: ModelChoice) =>
      dispatch({ type: 'sidechat-model', ...at, model: choice }),
    ask,
    setDraft: (quote?: Quote) =>
      dispatch({ type: 'sidechat-draft', ...at, quote }),
    clear: () => dispatch({ type: 'sidechat-clear', ...at }),
    promote: (id: string, to: 'message' | 'thread') => {
      const answer = chat.messages.find((m) => m.id === id);
      // There, an answer goes to the thread as your message (`send`); a new thread starts on that computer's own screen.
      if (!machine) dispatch({ type: 'sidechat-promote', ...at, id, to });
      else if (answer && to === 'message')
        dispatch({
          type: 'send',
          threadId: thread.id,
          text: promotedText(answer),
          reason: '',
        });
    },
    /** The computer the side chat runs on, and why asking it can't go now; null for this computer's own thread. */
    remote: machine && { machine, blocker },
  };
}

/** Settings › Models' side chat model, old catalog ids read as the provider's own (null until read), and a setter that saves it. */
export function useSideChatDefault() {
  const settingsQuery = useQuery({
    queryKey: queryKeys.agent.settings(),
    queryFn: () => host.settings.get(),
  });
  const model = settingsQuery.data
    ? sideChatChoice(settingsQuery.data.sideChatModel)
    : null;
  const save = (choice: ModelChoice) => {
    host.settings
      .set({ sideChatModel: choice })
      .then((next) =>
        queryClient.setQueryData(queryKeys.agent.settings(), next),
      )
      .catch((error: Error) =>
        toast.error('Side chat model not saved', {
          description: error.message,
        }),
      );
  };
  return [model, save] as const;
}
