import { localClassifier } from '../../drift.ts';
import { demoReviewer } from '../../secondOpinion/demo.ts';
import { chunks, mockAnswer } from '../../sidechat/mockAnswer.ts';
import type { AgentAskEvent, AgentEvent, AgentHost } from '../types/agent.ts';

const listeners = new Set<(event: AgentEvent) => void>();
const askListeners = new Set<(event: AgentAskEvent) => void>();
let nextId = 0;

const emitAsk = (event: AgentAskEvent) => askListeners.forEach((listener) => listener(event));

// GAP: no runtime in the web build; threads run on the demo adapter (src/runtime/demo.ts), so these only end the turn.
const endTurn = async (threadId: string) => {
  setTimeout(() => listeners.forEach((listener) => listener({ threadId, type: 'turn-end', status: 'interrupted' })), 0);
};

export const agent: AgentHost = {
  start: endTurn,
  send: endTurn,
  interrupt: endTurn,
  stop: endTurn,
  async resolve() {},
  onEvent(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  async ask(context, messages) {
    const id = `ask-${++nextId}`;
    const parts = chunks(mockAnswer(context, messages));
    parts.forEach((text, i) => setTimeout(() => emitAsk({ id, type: 'text', text }), 200 + i * 25));
    setTimeout(() => emitAsk({ id, type: 'done', text: '' }), 220 + parts.length * 25);
    return { id };
  },
  onAskEvent(listener) {
    askListeners.add(listener);
    return () => askListeners.delete(listener);
  },
  ...demoReviewer,
  async classify(prompt, thread) {
    return localClassifier(prompt, thread);
  },
  async rewindFiles() {},
  // No agents in the web build, so no tool calls.
  onToolCall: () => () => {},
  async toolResult() {},
  async warm() {},
};
