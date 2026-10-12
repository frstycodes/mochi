import type { DriftVerdict } from '../../drift.ts';
import type { Provider, Size, Thread } from '../../model.ts';
import type { Manifest } from './manifest.ts';

export interface AgentStartOptions {
  provider: Provider;
  /** The profile whose account for `provider` the thread runs on, for its whole life. */
  spaceId: string;
  /** An absolute folder; null for a folderless chat, which main runs in a folder of its own under the app's data dir. */
  cwd: string | null;
  prompt: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
  /** Provider session id from an earlier `session` event. */
  resume?: string;
  /** Bill the stored API key instead of the account's plan. Only ever set on the user's explicit per-thread choice. */
  useApiKey?: boolean;
}

export type AgentEvent =
  | { threadId: string; type: 'session'; provider: Provider; sessionId: string }
  | { threadId: string; type: 'message'; text: string; isDelta: boolean }
  | { threadId: string; type: 'reasoning'; text: string }
  | { threadId: string; type: 'tool'; id: string; phase: 'start' | 'end'; text: string; files?: string[]; exitCode?: number }
  | { threadId: string; type: 'plan'; items: AgentPlanItem[] }
  | { threadId: string; type: 'approval'; requestId: string; kind: 'command' | 'edit' | 'tool'; title: string; detail: string; code?: string }
  | { threadId: string; type: 'question'; requestId: string; questions: { text: string; options: string[] }[] }
  /** The agent withdrew an approval or question (interrupt, timeout, answered elsewhere): its queue card goes away. */
  | { threadId: string; type: 'resolved'; requestId: string }
  | { threadId: string; type: 'usage'; inputTokens: number; outputTokens: number; costUsd?: number; contextUsed?: number; contextMax?: number }
  | { threadId: string; type: 'limit'; resetsAt?: string }
  | { threadId: string; type: 'turn-end'; status: 'done' | 'interrupted' | 'failed'; error?: string };

/** What an adapter gets once main has resolved and checked the folder. */
export type AgentRunOptions = Omit<AgentStartOptions, 'cwd'> & { cwd: string };

/** `progress`, `size` and `files` are optional hints; Claude and Codex plans carry none of them. */
export interface AgentPlanItem {
  title: string;
  status: 'pending' | 'running' | 'done';
  progress?: number;
  size?: Size;
  files?: string[];
}

/** `forSession` allows the same kind of action for the rest of the session; `interrupt` denies and ends the turn. */
export type AgentDecision = { kind: 'allow'; forSession?: boolean } | { kind: 'deny'; message?: string; interrupt?: boolean } | { kind: 'answer'; answers: string[] };

/** Side chat's answer stream, separate from thread events: `id` is the one `ask` returned. */
export interface AgentAskEvent {
  id: string;
  type: 'text' | 'done' | 'error';
  text: string;
}

/** What a side question sees of its thread: read-only, never written back. */
export interface AgentAskContext {
  /** The thread's profile, whose Claude account answers. */
  spaceId: string;
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
  start(threadId: string, options: AgentStartOptions): Promise<void>;
  send(threadId: string, text: string): Promise<void>;
  interrupt(threadId: string): Promise<void>;
  resolve(requestId: string, decision: AgentDecision): Promise<void>;
  stop(threadId: string): Promise<void>;
  onEvent(listener: (event: AgentEvent) => void): () => void;
  /** Streams the answer as `text` events on `onAskEvent` under the returned id, then one `done` (or `error`). */
  ask(context: AgentAskContext, messages: AgentAskMessage[]): Promise<{ id: string }>;
  onAskEvent(listener: (event: AgentAskEvent) => void): () => void;
  /** Drift guard's model pass for prompts the local `similarity()` pass can't settle. */
  classify(prompt: string, thread: Thread): Promise<DriftVerdict>;
  /** Before the renderer restores a git checkpoint: rewinds a live Claude session's own file checkpoints to just before `text` was sent. No-op otherwise. */
  rewindFiles(threadId: string, text: string): Promise<void>;
  /** Parks a Claude Code process for the profile's account so the next side question or classify starts fast. Best effort. */
  warm(spaceId: string): Promise<void>;
}

export const agentMethods = {
  start: 'invoke',
  send: 'invoke',
  interrupt: 'invoke',
  resolve: 'invoke',
  stop: 'invoke',
  onEvent: 'event',
  ask: 'invoke',
  onAskEvent: 'event',
  classify: 'invoke',
  rewindFiles: 'invoke',
  warm: 'invoke',
} satisfies Manifest<AgentHost>;
