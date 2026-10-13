import type { DriftVerdict } from '../../drift.ts';
import type { AgentInfo, McpCall, Provider, Size, StepStatus, Thread, WebLink } from '../../model.ts';
import type { Manifest } from './manifest.ts';

export interface AgentStartOptions {
  provider: Provider;
  /** The profile whose account for `provider` the thread runs on, for its whole life. */
  spaceId: string;
  /** An absolute folder; null for a folderless chat, which main runs in a folder of its own under the app's data dir. */
  cwd: string | null;
  /** Where in `cwd` the agent works; unset runs it in `cwd` as is (restarts, folderless chats). */
  workspace?: StartWorkspace;
  prompt: string;
  /** Sent with the first prompt. */
  images?: AgentImage[];
  /** Skills the first prompt asks for by name, for harnesses that attach a skill to the message (Codex) rather than load it by name. */
  skills?: string[];
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
  /** A project folder thread's agent runs on this branch of the project's checkout. */
  | { threadId: string; type: 'branch'; branch: string }
  | { threadId: string; type: 'session'; provider: Provider; sessionId: string }
  /** Merged into what the thread knows; `mcpServers` merge by name, so one server's status change can come alone. */
  | { threadId: string; type: 'info'; info: AgentInfo }
  | { threadId: string; type: 'message'; text: string; isDelta: boolean }
  | { threadId: string; type: 'reasoning'; text: string }
  /**
   * `links`: the pages a web search returned or the page a fetch read; with them, `end` also replaces the start's text (Codex fills
   * the query in late). `skill`: the call loaded this skill (Claude's Skill tool, a skill Codex got with the message). `mcp`: the
   * call ran this tool of this MCP server. `description`: the agent's own plain-language line for the call (Claude's Bash).
   * `output` (commands, tail-capped) and `patch` (edits, unified diff) come with `end`.
   */
  | { threadId: string; type: 'tool'; id: string; phase: 'start' | 'end'; text: string; description?: string; files?: string[]; exitCode?: number; output?: string; patch?: string; links?: WebLink[]; skill?: string; mcp?: McpCall }
  | { threadId: string; type: 'plan'; items: AgentPlanItem[] }
  /** A subagent the thread's agent started (Claude's Agent tool, a Codex spawn) or a Mochi background agent: its own steps, tokens and result, never flattened into the parent's log. Fields are sparse after `start`. */
  | AgentSubagentEvent
  | { threadId: string; type: 'approval'; requestId: string; kind: 'command' | 'edit' | 'tool'; title: string; detail: string; code?: string }
  | { threadId: string; type: 'question'; requestId: string; questions: AgentQuestion[] }
  /** The agent withdrew an approval or question (interrupt, timeout, answered elsewhere): its queue card goes away. */
  | { threadId: string; type: 'resolved'; requestId: string }
  /** `cachedTokens`: the part of `inputTokens` read from the prompt cache. */
  | { threadId: string; type: 'usage'; inputTokens: number; outputTokens: number; cachedTokens?: number; costUsd?: number; contextUsed?: number; contextMax?: number }
  | { threadId: string; type: 'limit'; resetsAt?: string }
  | { threadId: string; type: 'turn-end'; status: 'done' | 'interrupted' | 'failed'; error?: string };

/** One plan rate-limit window of an account, as the provider reported it. */
export interface LimitWindow {
  /** Stable per window so sparse updates replace it: Claude's `rateLimitType`, Codex's `primary` / `secondary`. */
  id: string;
  label: string;
  /** 0–100. */
  usedPct: number;
  resetsAt?: string;
}

/** The latest windows main knows for one account; `updatedAt` is when the provider last reported any of them, unset before it ever has. */
export interface AccountLimits {
  accountId: string;
  provider: Provider;
  windows: LimitWindow[];
  updatedAt?: string;
}

export type SubagentStatus = 'running' | 'done' | 'failed' | 'stopped';

export interface AgentSubagentEvent {
  threadId: string;
  type: 'subagent';
  /** Claude: the Agent tool call's id; Codex: the spawned agent's thread id; Mochi: the background agent's id. */
  id: string;
  phase: 'start' | 'progress' | 'end';
  /** The parent's tool call that started it. */
  toolId?: string;
  name?: string;
  /** What it was asked to do. */
  prompt?: string;
  model?: string;
  /** Runs on while the parent's turn goes on. */
  isBackground?: boolean;
  /** `end` only. */
  status?: Exclude<SubagentStatus, 'running'>;
  /** One line on what it is doing now. */
  activity?: string;
  /** One of its own tool calls. */
  /** One of its tool calls, with the same extras as the thread's own (`description` on start; `output`, `patch` on end). */
  step?: { id: string; phase: 'start' | 'end'; text: string; description?: string; files?: string[]; exitCode?: number; output?: string; patch?: string };
  /** Its latest message; `isDelta` appends to the one before. */
  message?: string;
  isDelta?: boolean;
  /** Its final answer, `end` only; the latest message stands in when unset. */
  result?: string;
  /** Running total. */
  tokens?: number;
  error?: string;
  /** The folder it works in, when not the parent's. */
  cwd?: string;
}

/**
 * `worktree`: the thread's own worktree of `cwd` on `branch`, made by main before the agent starts (from `base`, or checking out
 * an existing branch); not a git repo runs the agent in `cwd`. `folder`: `cwd` itself, switched to `branch` first when `isExisting`.
 */
export interface StartWorkspace {
  mode: 'worktree' | 'folder';
  branch: string;
  base?: string;
  isExisting?: boolean;
}

/** Base64 without the `data:` prefix. */
export interface AgentImage {
  mediaType: 'image/jpeg' | 'image/png';
  data: string;
}

/** What an adapter gets once main has resolved and checked the folder. */
export type AgentRunOptions = Omit<AgentStartOptions, 'cwd' | 'workspace'> & { cwd: string };

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

/** Who answers a side question; `model` unset, or one the account doesn't offer, runs the account's default model. */
export interface AgentAskModel {
  provider: Provider;
  model?: string;
}

/** One model a provider offers an account, from the provider's own list (Claude Agent SDK `supportedModels()`, Codex `model/list`). */
export interface AgentModel {
  /** The provider's own model id, sent as-is. */
  id: string;
  name: string;
  description: string;
  /** Provider effort ids (`low` … `max`, Codex's `ultra`); empty when the model takes none. */
  efforts: string[];
  /** The provider's default effort for this model; unset leaves it to the harness. */
  defaultEffort?: string;
  isDefault: boolean;
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

/** `text` goes back to the agent as the tool's result; `image` (base64, no data: prefix) after it, for screenshots. */
export interface AgentToolResult {
  text: string;
  isError?: boolean;
  image?: { data: string; mimeType: 'image/png' };
}

export interface AgentHost {
  start(threadId: string, options: AgentStartOptions): Promise<void>;
  /** `skills`: as `AgentStartOptions.skills`, for this message. */
  send(threadId: string, text: string, images?: AgentImage[], skills?: string[]): Promise<void>;
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
  /** Stops one of a thread's native subagents (Claude task, Codex spawned agent); it ends with status `stopped`. */
  stopSubagent(threadId: string, subagentId: string): Promise<void>;
  /** Parks a Claude Code process for the profile's account so the next side question or classify starts fast. Best effort. */
  warm(spaceId: string): Promise<void>;
  /** The models `provider` offers the profile's account; cached per account, refetched when its login changes. */
  models(provider: Provider, spaceId: string): Promise<AgentModel[]>;
  /** The latest plan windows main keeps for the profile's `provider` account; `refresh` reads them from the provider first (throttled). */
  limits(provider: Provider, spaceId: string, refresh?: boolean): Promise<AccountLimits>;
  onLimits(listener: (limits: AccountLimits) => void): () => void;
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
  stopSubagent: 'invoke',
  warm: 'invoke',
  models: 'invoke',
  limits: 'invoke',
  onLimits: 'event',
  onToolCall: 'event',
  toolResult: 'invoke',
} satisfies Manifest<AgentHost>;
