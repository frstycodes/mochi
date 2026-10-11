import { chunks, mockAnswer } from '../../sidechat/mockAnswer.ts';
import type { AgentEvent, AgentHost } from '../types/agent.ts';

const listeners = new Set<(event: AgentEvent) => void>();
let nextId = 0;

const emit = (event: AgentEvent) => listeners.forEach((listener) => listener(event));

export const agent: AgentHost = {
  async start({ prompt }) {
    const id = `agent-${++nextId}`;
    setTimeout(() => emit({ id, type: 'done', text: `Web preview: would run "${prompt}"` }), 300);
    return { id };
  },
  async ask(context, messages) {
    const id = `ask-${++nextId}`;
    const parts = chunks(mockAnswer(context, messages));
    parts.forEach((text, i) => setTimeout(() => emit({ id, type: 'text', text }), 200 + i * 25));
    setTimeout(() => emit({ id, type: 'done', text: '' }), 220 + parts.length * 25);
    return { id };
  },
  onEvent(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
