import { useEffect, useRef, useState } from 'react';
import { toast } from '../toast/store.ts';
import { host } from '../host';
import { threadCwd } from '../host/cwd';
import type { AgentAskContext, AgentAskEvent, AgentAskMessage, AgentAskModel } from '../host/types/agent';
import { DEFAULT_SETTINGS, type ModelChoice } from '../host/types/settings';
import type { Thread } from '../model';
import { sideChatChoice } from '../runtime/controls';
import { useHarness } from '../store';
import { chatFor, questionText, type Quote, type SideMessage } from '../store/sidechat';

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

  const ask = async (text: string) => {
    const id = `side-${Date.now()}`;
    const question: SideMessage = { id: `${id}-q`, role: 'user', text, quote: chat.draft };
    const history = [...chat.messages, question].map(toAgentMessage);
    dispatch({ type: 'sidechat-ask', ...at, id, text });
    const stream = (chunk: string, isDone?: boolean) => dispatch({ type: 'sidechat-stream', ...at, id, text: chunk, isDone });
    try {
      for await (const chunk of askAgent(threadContext(thread, await diffSummary(thread)), history, model)) stream(chunk);
      stream('', true);
    } catch (error) {
      stream(`\n\n_Couldn't answer: ${error instanceof Error ? error.message : String(error)}_`, true);
    }
  };

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

function toAgentMessage(message: SideMessage): AgentAskMessage {
  return message.role === 'user' ? { role: 'user', text: questionText(message) } : { role: 'assistant', text: message.text };
}

const RECENT_ACTIVITY = 12;
const MAX_ENTRY_CHARS = 600;

function threadContext(thread: Thread, diff: AgentAskContext['diff']): AgentAskContext {
  return {
    spaceId: thread.spaceId,
    title: thread.title,
    goal: thread.goal,
    steps: thread.steps.map((s) => ({ title: s.title, status: s.status })),
    activity: thread.activity.slice(-RECENT_ACTIVITY).map((a) => ({ who: a.who, text: a.text.slice(0, MAX_ENTRY_CHARS) })),
    diff,
  };
}

async function diffSummary(thread: Thread): Promise<AgentAskContext['diff']> {
  const cwd = threadCwd(thread);
  if (!cwd) return null;
  try {
    const diff = await host.git.diff(cwd, 'branch', thread.repo?.base);
    return diff.files.map((f) => ({ path: f.path, added: f.added, removed: f.removed }));
  } catch {
    return null;
  }
}

/** `host.agent.ask` answers through the shared event channel; this pulls out one answer's chunks as an async stream. */
async function* askAgent(context: AgentAskContext, messages: AgentAskMessage[], model: AgentAskModel) {
  const pending: AgentAskEvent[] = [];
  let wake = () => {};
  const off = host.agent.onAskEvent((event) => {
    pending.push(event);
    wake();
  });
  try {
    // Subscribed before asking: the first chunk can arrive before `ask` resolves.
    const { id } = await host.agent.ask(context, messages, model);
    while (true) {
      const event = pending.shift();
      if (!event) {
        await new Promise<void>((resolve) => (wake = resolve));
        continue;
      }
      if (event.id !== id) continue;
      if (event.type === 'error') throw new Error(event.text);
      if (event.type === 'done') return;
      yield event.text;
    }
  } finally {
    off();
  }
}
