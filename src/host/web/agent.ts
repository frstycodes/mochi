import type { AgentEvent, AgentHost } from '../types/agent.ts';

const listeners = new Set<(event: AgentEvent) => void>();
let nextId = 0;

export const agent: AgentHost = {
  async start({ prompt }) {
    const id = `agent-${++nextId}`;
    setTimeout(() => listeners.forEach((listener) => listener({ id, type: 'done', text: `Web preview: would run "${prompt}"` })), 300);
    return { id };
  },
  onEvent(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
