import type { DriftVerdict } from '../../drift.ts';
import type { AgentInfo, Provider, Size, StepStatus, Thread } from '../../model.ts';
import type { Manifest } from './manifest.ts';

export interface AgentStartOptions {
  provider: Provider;
  /** The profile whose account for `provider` the thread runs on, for its whole life. */
  spaceId: string;
  /** An absolute folder; null for a folderless chat, which main runs in a folder of its own under the app's data dir. */
  cwd: string | null;
  /** Branch for the thread's own worktree of `cwd`, made by main before the agent starts; on failure (not a git repo) the agent runs in `cwd`. */
  worktree?: string;
  prompt: string;
  /** Sent with the first prompt. */
  images?: AgentImage[];
  model?: string;
  effort?: string;
  permissionMode?: string;
  /** Provider session id from an earlier `session` event. */
  resume?: string;
  /** Bill the stored API key instead of the account's plan. Only ever set on the user's explicit per-thread choice. */
  useApiKey?: boolean;
}

export type AgentEvent =
  /** Main made the thread's worktree and runs the agent there. */
  | { threadId: string; type: 'worktree'; path: string }
  | { threadId: string; type: 'session'; provider: Provider; sessionId: string }
  /** Merged into what the thread knows; `mcpServers` merge by name, so one server's status change can come alone. */
  | { threadId: string; type: 'info'; info: AgentInfo }
  | { threadId: string; type: 'message'; text: string; isDelta: boolean }
  | { threadId: string; type: 'reasoning'; text: string }
  | { threadId: string; type: 'tool'; id: string; phase: 'start' | 'end'; text: string; files?: string[]; exitCode?: number }
  | { threadId: string; type: 'plan'; items: AgentPlanItem[] }
  | { threadId: string; type: 'approval'; requestId: string; kind: 'command' | 'edit' | 'tool'; title: string; detail: string; code?: string }
  | { threadId: string; type: 'question'; requestId: string; questions: AgentQuestion[] }
  /** The agent withdrew an approval or question (interrupt, timeout, answered elsewhere): its queue card goes away. */
  | { threadId: string; type: 'resolved'; requestId: string }
  | { threadId: string; type: 'usage'; inputTokens: number; outputTokens: number; costUsd?: number; contextUsed?: number; contextMax?: number }
  | { threadId: string; type: 'limit'; resetsAt?: string }
  | { threadId: string; type: 'turn-end'; status: 'done' | 'interrupted' | 'failed'; error?: string };

/** Base64 without the `data:` prefix. */
export interface AgentImage {
  mediaType: 'image/jpeg' | 'image/png';
  data: string;
}

/** What an adapter gets once main has resolved and checked the folder. */
export type AgentRunOptions = Omit<AgentStartOptions, 'cwd' | 'worktree'> & { cwd: string };

/** You can always type your own answer too, so `options` may be empty. */
export interface AgentQuestion {
  text: string;
  options: string[];
  multiSelect: boolean;
}

/** `progress`, `size` and `files` are optional hints; Claude and Codex plans carry none of them. */
export interface AgentPlanItem {
  title: string;
  status: 'pending' | 'running' | 'done';
  progress?: number;
  size?: Size;
  files?: string[];
}

/** `forSession` allows the same kind of action for the rest of the session; `interrupt` denies and ends the turn. `answers` holds each question's picked labels and typed text, in question order; empty means skipped. */
export type AgentDecision = { kind: 'allow'; forSession?: boolean } | { kind: 'deny'; message?: string; interrupt?: boolean } | { kind: 'answer'; answers: string[][] };

/** Side chat's answer stream, separate from thread events: `id` is the one `ask` returned. */
export interface AgentAskEvent {
  id: string;
  type: 'text' | 'done' | 'error';
  text: string;
}

/** What a side question sees of its thread: read-only, never written back. */
export interface AgentAskContext {
  /** The thread's profile, whose account for the asked provider answers. */
  spaceId: string;
  title: string;
  goal: string;
  steps: { title: string; status: string }[];
  activity: { who: string; text: string }[];
  diff: { path: string; added: number; removed: number }[] | null;
}

/** Who answers a side question; `model` unset runs the harness's own default (Codex's catalog entries carry no real id). */
export interface AgentAskModel {
  provider: Provider;
  model?: string;
}

export interface AgentAskMessage {
  role: 'user' | 'assistant';
  text: string;
}

/** A read-only second-opinion run on `provider`, in the thread's folder. The renderer builds the prompt and checks the verdict. */
export interface AgentReviewRequest {
  provider: Provider;
  /** The thread's profile, whose account for `provider` reviews. */
  spaceId: string;
  cwd: string;
  prompt: string;
}

/** A review's stream under the id `review` returned: what it is doing (`step`), then one `done` with its answer (structured output or text) or one `error`. */
export type AgentReviewEvent = { id: string; type: 'step'; text: string } | { id: string; type: 'done'; result: unknown } | { id: string; type: 'error'; text: string };

/** The statuses an agent may set on a step through Mochi's tools. */
export const STEP_STATUSES = ['ready', 'running', 'waiting', 'blocked', 'done', 'dropped'] as const satisfies readonly StepStatus[];

/** A Mochi tool an agent called (`electron/mcp`); the renderer runs it on the store and answers with `toolResult`. */
export interface AgentToolCall {
  id: string;
  threadId: string;
  name: string;
  args: Record<string, unknown>;
}

/** `text` goes back to the agent as the tool's result. */
export interface AgentToolResult {
  text: string;
  isError?: boolean;
}

export interface AgentHost {
  start(threadId: string, options: AgentStartOptions): Promise<void>;
  send(threadId: string, text: string, images?: AgentImage[]): Promise<void>;
  interrupt(threadId: string): Promise<void>;
  resolve(requestId: string, decision: AgentDecision): Promise<void>;
  stop(threadId: string): Promise<void>;
  onEvent(listener: (event: AgentEvent) => void): () => void;
  /** Streams the answer from `model` on the profile's account as `text` events on `onAskEvent` under the returned id, then one `done` (or `error`). */
  ask(context: AgentAskContext, messages: AgentAskMessage[], model: AgentAskModel): Promise<{ id: string }>;
  onAskEvent(listener: (event: AgentAskEvent) => void): () => void;
  /** Starts a review run beside the thread's agent, never touching its session. Events arrive on `onReviewEvent`. */
  review(request: AgentReviewRequest): Promise<{ id: string }>;
  onReviewEvent(listener: (event: AgentReviewEvent) => void): () => void;
  /** Drift guard's model pass for prompts the local `similarity()` pass can't settle. */
  classify(prompt: string, thread: Thread): Promise<DriftVerdict>;
  /** Before the renderer restores a git checkpoint: rewinds a live Claude session's own file checkpoints to just before `text` was sent. No-op otherwise. */
  rewindFiles(threadId: string, text: string): Promise<void>;
  /** Parks a Claude Code process for the profile's account so the next side question or classify starts fast. Best effort. */
  warm(spaceId: string): Promise<void>;
  onToolCall(listener: (call: AgentToolCall) => void): () => void;
  toolResult(id: string, result: AgentToolResult): Promise<void>;
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
  review: 'invoke',
  onReviewEvent: 'event',
  classify: 'invoke',
  rewindFiles: 'invoke',
  warm: 'invoke',
  onToolCall: 'event',
  toolResult: 'invoke',
} satisfies Manifest<AgentHost>;
