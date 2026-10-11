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

/** What a side question sees of its thread: read-only, never written back. */
export interface AgentAskContext {
  title: string;
  goal: string;
  steps: { title: string; status: string }[];
  activity: { who: string; text: string }[];
  diff: { path: string; added: number; removed: number }[] | null;
}

export interface AgentAskMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface AgentHost {
  start(options: AgentStartOptions): Promise<{ id: string }>;
  /** Streams the answer as `text` events on `onEvent` under the returned id, then one `done` (or `error`). */
  ask(context: AgentAskContext, messages: AgentAskMessage[]): Promise<{ id: string }>;
  onEvent(listener: (event: AgentEvent) => void): () => void;
}

export const agentMethods = {
  start: 'invoke',
  ask: 'invoke',
  onEvent: 'event',
} satisfies Manifest<AgentHost>;
