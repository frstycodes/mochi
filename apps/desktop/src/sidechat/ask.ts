import type { Dispatch } from 'react';
import { threadCwd } from '../host/cwd.ts';
import { host } from '../host/index.ts';
import type {
  AgentAskContext,
  AgentAskEvent,
  AgentAskMessage,
  AgentAskModel,
} from '../host/types/agent.ts';
import type { ModelChoice } from '../host/types/settings.ts';
import type { Thread } from '../model.ts';
import type { Action } from '../store/index.tsx';
import {
  questionText,
  type SideChat,
  type SideMessage,
} from '../store/sidechat.ts';

/** Asks the thread's side chat in tab `tabId`, streaming the answer into the store; resolves once it is done. */
export async function askSideChat(
  thread: Thread,
  tabId: string,
  chat: SideChat,
  model: ModelChoice,
  text: string,
  dispatch: Dispatch<Action>,
) {
  const at = { threadId: thread.id, tabId };
  const id = `side-${Date.now()}`;
  const question: SideMessage = {
    id: `${id}-q`,
    role: 'user',
    text,
    quote: chat.draft,
  };
  const history = [...chat.messages, question].map(toAgentMessage);
  dispatch({ type: 'sidechat-ask', ...at, id, text });
  const stream = (chunk: string, isDone?: boolean) =>
    dispatch({ type: 'sidechat-stream', ...at, id, text: chunk, isDone });
  try {
    for await (const chunk of askAgent(
      threadContext(thread, await diffSummary(thread)),
      history,
      model,
    ))
      stream(chunk);
    stream('', true);
  } catch (error) {
    stream(
      `\n\n_Couldn't answer: ${error instanceof Error ? error.message : String(error)}_`,
      true,
    );
  }
}

function toAgentMessage(message: SideMessage): AgentAskMessage {
  return message.role === 'user'
    ? { role: 'user', text: questionText(message) }
    : { role: 'assistant', text: message.text };
}

const RECENT_ACTIVITY = 12;
const MAX_ENTRY_CHARS = 600;

function threadContext(
  thread: Thread,
  diff: AgentAskContext['diff'],
): AgentAskContext {
  return {
    spaceId: thread.spaceId,
    title: thread.title,
    steps: thread.steps.map((s) => ({ title: s.title, status: s.status })),
    activity: thread.activity
      .slice(-RECENT_ACTIVITY)
      .map((a) => ({ who: a.who, text: a.text.slice(0, MAX_ENTRY_CHARS) })),
    diff,
  };
}

async function diffSummary(thread: Thread): Promise<AgentAskContext['diff']> {
  const cwd = threadCwd(thread);
  if (!cwd) return null;
  try {
    const diff = await host.git.diff(cwd, 'branch', thread.repo?.base);
    return diff.files.map((f) => ({
      path: f.path,
      added: f.added,
      removed: f.removed,
    }));
  } catch {
    return null;
  }
}

/** `host.agent.ask` answers through the shared event channel; this pulls out one answer's chunks as an async stream. */
async function* askAgent(
  context: AgentAskContext,
  messages: AgentAskMessage[],
  model: AgentAskModel,
) {
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
