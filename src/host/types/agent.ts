import type { Manifest } from './manifest.ts';

export interface AgentStartOptions {
  cwd: string;
  prompt: string;
}

export interface AgentEvent {
  id: string;
  type: 'text' | 'tool' | 'done' | 'error';
  text: string;
}

export interface AgentHost {
  start(options: AgentStartOptions): Promise<{ id: string }>;
  onEvent(listener: (event: AgentEvent) => void): () => void;
}

export const agentMethods = {
  start: 'invoke',
  onEvent: 'event',
} satisfies Manifest<AgentHost>;
