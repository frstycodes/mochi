import type { DriftVerdict } from '../../drift.ts';
import type { AgentInfo, GeneratedImage, McpCall, McpWidget, McpWidgetResource, Provider, Thread, ThreadRef, WebLink } from '../../model.ts';
import type { Manifest } from './manifest.ts';
import type { UtilityTask } from '../../utility/prompts.ts';

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
  /** A speed id from the model's `speeds`; unset runs at standard speed. Main drops one the model doesn't list. */
  speed?: string;
  permissionMode?: string;
  /** Provider session id from an earlier `session` event. */
  resume?: string;
  /** With `resume`: continue a fork of that session holding only what came up to this point (`rewindPoint`), leaving the original as it was. */
  forkAt?: string;
  /** Bill the stored API key instead of the account's plan. Only ever set on the user's explicit per-thread choice. */
  useApiKey?: boolean;
  /** Goals are off (always, now they're retired): the session gets no goal instructions, tools or nudge. Read at session start. */
  isGoalsOff?: boolean;
  /** The profile's settings chat (Settings › Ask Mochi): only the settings tools and their instructions, no files, shell or browser. */
  isSettingsChat?: boolean;
  /** The profile's turned-off Claude Code or Codex items for this harness (`NativeItem.id`); main leaves them out of this session only. Read at session start. */
  nativeOff?: string[];
}

export type SeqAgentEvent = AgentEvent & { seq?: number };

export interface AttachedAgent {
  threadId: string;
  isWorking: boolean;
  events: SeqAgentEvent[];
}

export type AgentEvent =
  /** Main made the thread's worktree and runs the agent there. */
  | { threadId: string; type: 'worktree'; path: string }
  /** Main is preparing the new worktree before the agent's first turn; each event carries the whole setup so far. */
  | { threadId: string; type: 'setup'; setup: WorktreeSetup }
  /** The thread's agent runs on this branch: a project folder thread's checkout, or a worktree's temp branch named after its title. */
  | { threadId: string; type: 'branch'; branch: string; isDetached?: boolean }
  /** Main named a new thread from its first message (`StartWorkspace.titlePrompt`) before its agent started. */
  | { threadId: string; type: 'title'; title: string }
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
  | { threadId: string; type: 'tool'; id: string; phase: 'start' | 'end'; text: string; description?: string; files?: string[]; exitCode?: number; output?: string; patch?: string; links?: WebLink[]; skill?: string; mcp?: McpCall; /** Replays only: the message a `send_to_thread` call delivered, which live runs record when the tool runs. */ sent?: ThreadRef & { text: string }; /** End: images the call returned (a screenshot), saved by main; absolute paths. */ images?: string[]; /** An image the call is making (Codex image generation); start and end both carry it. */ generated?: GeneratedImage; /** End: the MCP App view the tool declared, with what to hand it. */ widget?: McpWidget }
  | { threadId: string; type: 'plan'; items: AgentPlanItem[] }
  /** A subagent the thread's agent started (Claude's Agent tool, a Codex spawn) or a Mochi background agent: its own steps, tokens and result, never flattened into the parent's log. Fields are sparse after `start`. */
  | AgentSubagentEvent
  /** A command (or workflow, monitor) the agent left running in the background: Claude's `run_in_background` Bash and its other non-agent tasks, a Codex background terminal. */
  | AgentTaskEvent
  | { threadId: string; type: 'approval'; requestId: string; kind: 'command' | 'edit' | 'tool'; title: string; detail: string; code?: string }
  | { threadId: string; type: 'question'; requestId: string; questions: AgentQuestion[] }
  /** The agent withdrew an approval or question (interrupt, timeout, answered elsewhere): its queue card goes away. */
  | { threadId: string; type: 'resolved'; requestId: string }
  /** `cachedTokens`: the part of `inputTokens` read from the prompt cache. */
  | { threadId: string; type: 'usage'; inputTokens: number; outputTokens: number; cachedTokens?: number; costUsd?: number; contextUsed?: number; contextMax?: number }
  /** What the harness itself says about the account's usage as it goes (Claude's limit warning, its switch to extra usage); a line in the transcript, nothing more. */
  | { threadId: string; type: 'limit-notice'; text: string }
  /** What the harness did on its own to keep the thread going (a fork it couldn't make); a line in the transcript. */
  | { threadId: string; type: 'notice'; text: string }
  /**
   * The account hit a plan window's limit. `label` names the window ("5-hour"). `isTurnHeld`: the harness keeps the turn and
   * continues it at the reset (Claude Code); otherwise the turn ended (Codex).
   */
  | { threadId: string; type: 'limit'; resetsAt?: string; label?: string; isTurnHeld?: boolean }
  /** The harness reports the window open again while it held the turn: the turn goes on. */
  | { threadId: string; type: 'limit-cleared' }
  /**
   * The harness compacted the conversation: Claude Code's `/compact` or auto-compact, Codex's `thread/compact/start` or its own.
   * `start` while it summarizes, `end` once done (token counts where the harness reports them), `summary` when it hands the
   * summary over (Claude's PostCompact hook; Codex shows none).
   */
  | { threadId: string; type: 'compaction'; phase: 'start' | 'end' | 'summary'; trigger?: 'manual' | 'auto'; preTokens?: number; postTokens?: number; summary?: string; error?: string }
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

export type BackgroundTaskKind = 'shell' | 'workflow' | 'monitor';

export interface AgentTaskEvent {
  threadId: string;
  type: 'task';
  /** Claude: the task id Claude Code gives it (`stopTask` takes it); Codex: the background terminal's commandExecution item id. */
  id: string;
  phase: 'start' | 'progress' | 'end';
  kind?: BackgroundTaskKind;
  /** The agent's own description of it, else the command. */
  title?: string;
  command?: string;
  /** Where its output goes, once the harness says. */
  outputFile?: string;
  /** `end` only. */
  status?: Exclude<SubagentStatus, 'running'>;
  exitCode?: number;
}

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
  /** The thread's first start: its new branch must not exist yet. A restart after cleanup checks out the one it left. */
  isNew?: boolean;
  /** With `isNew`, on a temp branch: main asks for a title while the worktree is set up and renames the branch after it before the agent starts. */
  titlePrompt?: string;
}

/**
 * A new worktree's preparation (`electron/git/setup.ts`): copy the project's ignored local files, install dependencies, run the
 * project's setup command. `failed` waits for `setupChoice`; `cancelled` was stopped by an interrupt and the agent never started.
 */
export interface WorktreeSetup {
  status: 'running' | 'failed' | 'ready' | 'skipped' | 'cancelled';
  /** Wall-clock ms. */
  startedAt: number;
  endedAt?: number;
  steps: SetupStep[];
}

export interface SetupStep {
  id: string;
  /** "Copy .env, .env.local", "Install dependencies with pnpm", "Run setup command". */
  label: string;
  /** The command as it ran, for commands. */
  command?: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  startedAt?: number;
  endedAt?: number;
  /** Tail-capped stdout and stderr, interleaved; for a failed copy, the error. */
  output?: string;
  exitCode?: number;
}

export type SetupChoice = 'retry' | 'skip';

/** Base64 without the `data:` prefix. */
export interface AgentImage {
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  /** Base64, no `data:` prefix. */
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
  /** Faster tiers than standard the model reports (Claude fast mode, Codex `serviceTiers`); empty when it reports none. */
  speeds: AgentSpeed[];
  isDefault: boolean;
}

/** One speed tier above standard. `description` carries the provider's own note on what it costs. */
export interface AgentSpeed {
  /** Sent as-is: Claude's `fast`, a Codex service tier id (`priority`). */
  id: string;
  name: string;
  description: string;
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
  /**
   * `skills`: as `AgentStartOptions.skills`, for this message. `speed`: the thread's speed from this message on ('' standard); unset keeps it.
   * `steer`: the turn in flight takes the message at its next step instead of a new turn starting after it (Claude `priority: 'next'`, Codex `turn/steer`).
   */
  send(threadId: string, text: string, images?: AgentImage[], skills?: string[], speed?: string, steer?: boolean): Promise<void>;
  /** Compacts the live session now with the harness's own compaction; `focus` is what you typed after `/compact` (Claude only). */
  compact(threadId: string, focus: string): Promise<void>;
  /** What Mochi asks the harness to keep on every compaction of the thread, manual or auto: '' clears it. Claude only (PreCompact hook); Codex takes none. */
  compactInstructions(threadId: string, instructions: string): Promise<void>;
  /** Stops a turn; during worktree setup, stops the setup and the agent doesn't start. */
  interrupt(threadId: string): Promise<void>;
  /** After a failed setup step: run the failed step again, or start the agent without the rest of the setup. */
  setupChoice(threadId: string, choice: SetupChoice): Promise<void>;
  /** You named the thread: a start still naming it (`titlePrompt`) leaves its title and branch as they are. */
  keepTitle(threadId: string): Promise<void>;
  resolve(requestId: string, decision: AgentDecision): Promise<void>;
  stop(threadId: string): Promise<void>;
  /** Shuts down everything the thread started: its agent and background agents, its terminals (and the dev servers in them), its compare server. */
  settle(threadId: string): Promise<void>;
  /**
   * Of `threads`, those whose agent is still running in main, e.g. across a window reload: `isWorking` while a turn is in flight, and
   * with `after` (the last `seq` the window applied), the events sent since, which the reload missed.
   */
  attached(threads: { threadId: string; after?: number }[]): Promise<AttachedAgent[]>;
  /** `seq`: rises with every event this run of main sends, so a reloaded window asks `attached` for what came after its last. */
  onEvent(listener: (event: SeqAgentEvent) => void): () => void;
  /** Streams the answer from `model` on the profile's account as `text` events on `onAskEvent` under the returned id, then one `done` (or `error`). */
  ask(context: AgentAskContext, messages: AgentAskMessage[], model: AgentAskModel): Promise<{ id: string }>;
  onAskEvent(listener: (event: AgentAskEvent) => void): () => void;
  /** Starts a review run beside the thread's agent, never touching its session. Events arrive on `onReviewEvent`. */
  review(request: AgentReviewRequest): Promise<{ id: string }>;
  onReviewEvent(listener: (event: AgentReviewEvent) => void): () => void;
  /** A background task's raw answer (prompt from `src/utility/prompts.ts`) on its Settings model, then the cheapest ones; null when none answers in time. */
  utility(task: UtilityTask, spaceId: string, prompt: string): Promise<string | null>;
  /** Drift guard's model pass for prompts the local `similarity()` pass can't settle. */
  classify(prompt: string, thread: Thread): Promise<DriftVerdict>;
  /** Before the renderer restores a git checkpoint: rewinds a live Claude session's own file checkpoints to just before `text` was sent. No-op otherwise. */
  rewindFiles(threadId: string, text: string): Promise<void>;
  /** Where the thread's live session stood just before `text` was sent, for `forkAt`: Claude's last chain entry, Codex's previous turn. Null when this run doesn't know (restarted, or it was the session's first message). */
  rewindPoint(threadId: string, text: string): Promise<string | null>;
  /** A tool's MCP App view (`ui://`), read through a live Claude session's own connection to `server`; the last read is kept on disk for when none is live. */
  readWidget(threadId: string, server: string, uri: string): Promise<McpWidgetResource>;
  /** Stops one of a thread's native background tasks (a Claude subagent or shell task, a Codex spawned agent or background terminal); it ends with status `stopped`. */
  stopTask(threadId: string, taskId: string): Promise<void>;
  /** Parks a Claude Code process for the profile's account so the next side question or classify starts fast. Best effort. */
  warm(spaceId: string): Promise<void>;
  /** The models `provider` offers the profile's account; cached per account, refetched when its login changes. */
  models(provider: Provider, spaceId: string): Promise<AgentModel[]>;
  /** The latest plan windows main keeps for the profile's `provider` account; `refresh` reads them from the provider first (throttled). */
  limits(provider: Provider, spaceId: string, refresh?: boolean): Promise<AccountLimits>;
  onLimits(listener: (limits: AccountLimits) => void): () => void;
  onToolCall(listener: (call: AgentToolCall) => void): () => void;
  /** After a window reload: the tool calls the old page was running, still waiting in main, each returned once. */
  pendingToolCalls(): Promise<AgentToolCall[]>;
  toolResult(id: string, result: AgentToolResult): Promise<void>;
}

export const agentMethods = {
  start: 'invoke',
  send: 'invoke',
  compact: 'invoke',
  compactInstructions: 'invoke',
  interrupt: 'invoke',
  setupChoice: 'invoke',
  keepTitle: 'invoke',
  resolve: 'invoke',
  stop: 'invoke',
  settle: 'invoke',
  attached: 'invoke',
  onEvent: 'event',
  ask: 'invoke',
  onAskEvent: 'event',
  review: 'invoke',
  onReviewEvent: 'event',
  classify: 'invoke',
  utility: 'invoke',
  rewindFiles: 'invoke',
  rewindPoint: 'invoke',
  readWidget: 'invoke',
  stopTask: 'invoke',
  warm: 'invoke',
  models: 'invoke',
  limits: 'invoke',
  onLimits: 'event',
  onToolCall: 'event',
  pendingToolCalls: 'invoke',
  toolResult: 'invoke',
} satisfies Manifest<AgentHost>;

/** What main throws for a send to a thread with no agent process this launch; the renderer restarts it with `resume` instead. */
export const NO_AGENT_PROCESS = 'This thread has no running agent process';

/** What main throws for an answer to a request the agent no longer waits on (it withdrew it, or the process ended). */
export const NO_PENDING_REQUEST = 'The agent is no longer waiting on this request';
