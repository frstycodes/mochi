import { randomUUID } from 'node:crypto';
import { hooksEnv } from '../../git/hooks.ts';
import { PR_GUARD } from './prGuard.ts';
import { EventEmitter, once } from 'node:events';
import { query, type CanUseTool, type EffortLevel, type HookCallbackMatcher, type HookEvent, type PermissionMode, type PermissionResult, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { app } from 'electron';
import type { AgentDecision, AgentImage, AgentRunOptions } from '../../../src/host/types/agent.ts';
import { accountFor, type ClaudeAccount } from './account.ts';
import { HARNESSES } from '../../../src/settings/harnesses.ts';
import { warmClaude } from './oneshot.ts';
import { approvalEvent, commandsFrom, createMapper, mcpServersFromStatus, PERMISSION_MODES, permissionOptions, permissionResult, userContent, withPlanTools } from './map.ts';
import { AUTO_ALLOWED, claudeServer, SERVER } from '../../mcp/server.ts';
import { emitAgentEvent } from '../events.ts';
import { HIDDEN_CLAUDE_SKILLS, MOCHI_INSTRUCTIONS } from '../instructions.ts';
import { recordLimits } from '../limits.ts';
import { claudeEventWindow } from '../../../src/usage/limits.ts';
import { MOCHI_TIMEOUT_MS } from '../../../src/runtime/toolTable.ts';
import { FORK_MISSING_NOTICE, FORK_REFUSED_NOTICE, forkPoint, MISSING_FORK_POINT, takeForkAt, transcriptUuids } from './fork.ts';

/**
 * One `query()` per thread, fed by a streaming-input inbox. A live session holds a Claude Code child process; at most
 * the concurrency cap are live, the rest wait in `waiting`. A session whose turn ended gives its process up when someone is
 * waiting and comes back with `resume` on its next message.
 */
interface Session {
  threadId: string;
  options: AgentRunOptions;
  inbox: { text: string; images?: AgentImage[] }[];
  /** Every message handed to Claude Code, with the uuid `rewindFiles` takes and the chain entry before it (`rewindPoint`). */
  sent: { uuid: string; text: string; images?: AgentImage[]; after: string | null }[];
  /** The newest entry of the main conversation chain; undefined while a resumed session hasn't shown one yet. */
  lastUuid?: string | null;
  wake: EventEmitter;
  mapper: ReturnType<typeof createMapper>;
  query?: Query;
  abort?: AbortController;
  /** Fixed at start: a thread never moves to another Claude account, its transcript lives in that account's config dir. */
  account: ClaudeAccount;
  sessionId?: string;
  isBusy: boolean;
}

const sessions = new Map<string, Session>();
/** By thread, outliving its session: what Mochi's PreCompact hook asks Claude Code to keep (`compactInstructions`). */
const keep = new Map<string, string>();
const waiting: Session[] = [];
const approvals = new Map<string, { threadId: string; toolName: string; input: Record<string, unknown>; resolve: (result: PermissionResult) => void }>();

export const DEFAULT_MODEL = 'claude-opus-5-5';
const DEFAULT_CAP = 6;
const EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export const hasClaudeSession = (threadId: string) => sessions.has(threadId);

/** What a live session runs on, with the speed its latest message set. */
export const claudeRunOptions = (threadId: string) => sessions.get(threadId)?.options;

export async function startClaude(threadId: string, options: AgentRunOptions) {
  if (options.permissionMode && !(options.permissionMode in PERMISSION_MODES)) throw new TypeError(`permissionMode must be one of ${Object.keys(PERMISSION_MODES).join(', ')}`);
  if (options.effort && !EFFORTS.includes(options.effort as EffortLevel)) throw new TypeError(`effort must be one of ${EFFORTS.join(', ')}`);
  if (options.speed && options.speed !== 'fast') throw new TypeError('speed must be fast');
  const account = await accountFor(options.spaceId, 'claude');
  stopClaude(threadId);
  const session: Session = { threadId, options, account, inbox: [{ text: options.prompt, images: options.images }], sent: [], wake: new EventEmitter(), mapper: createMapper(threadId, options.cwd), sessionId: options.resume, lastUuid: options.resume ? undefined : null, isBusy: true };
  sessions.set(threadId, session);
  void warmClaude(options.spaceId).catch(() => {});
  await schedule(session);
}

/** `speed`: '' standard, 'fast' fast mode, unset keeps it; a live process switches before reading the message. */
export async function sendClaude(threadId: string, text: string, images?: AgentImage[], speed?: string) {
  const session = sessions.get(threadId);
  if (!session) throw new Error('No Claude session for this thread in this run of Harness; start it again with resume');
  if (speed !== undefined && speed !== (session.options.speed ?? '')) {
    session.options = { ...session.options, speed: speed || undefined };
    await session.query?.applyFlagSettings({ fastMode: !!speed });
  }
  session.inbox.push({ text, images });
  session.isBusy = true;
  if (session.query) session.wake.emit('push');
  else if (!waiting.includes(session)) await schedule(session);
}

/** `/compact` is Claude Code's own command, taken as a message; the PreCompact hook adds Mochi's instructions to `focus`. */
export function compactClaude(threadId: string, focus: string) {
  return sendClaude(threadId, focus ? `/compact ${focus}` : '/compact');
}

export function setClaudeCompactInstructions(threadId: string, instructions: string) {
  if (instructions) keep.set(threadId, instructions);
  else keep.delete(threadId);
}

export async function interruptClaude(threadId: string) {
  const session = sessions.get(threadId);
  if (!session) return;
  dropApprovals(threadId, 'Interrupted by the user');
  const queued = waiting.indexOf(session);
  if (queued >= 0) waiting.splice(queued, 1);
  if (!session.query || !session.isBusy) return emit({ threadId, type: 'turn-end', status: 'interrupted' });
  session.mapper.markInterrupting();
  await session.query.interrupt();
}

export function stopClaude(threadId: string) {
  const session = sessions.get(threadId);
  if (!session) return;
  sessions.delete(threadId);
  const queued = waiting.indexOf(session);
  if (queued >= 0) waiting.splice(queued, 1);
  release(session);
}

/**
 * Rewinds Claude's file checkpoints to just before the latest sent message with this text, so its own view of the files
 * matches the git checkpoint the renderer restores next. Only a live session can rewind; git refs stay the source of truth.
 */
// GAP: matched by text because activity entries carry no message id yet; pass the uuid once the entry stores it. Two
// identical messages rewind to the later one.
export async function rewindClaude(threadId: string, text: string) {
  const session = sessions.get(threadId);
  const uuid = session?.sent.findLast((m) => m.text.includes(text))?.uuid;
  if (!session?.query || !uuid) return;
  const result = await session.query.rewindFiles(uuid);
  if (!result.canRewind) console.warn(`Claude rewind skipped for ${threadId}: ${result.error ?? 'no checkpoint'}`);
}

/** The transcript entry just before the latest sent message with this text, for `forkAt`; null when unknown or it was the first. */
export async function claudeRewindPoint(threadId: string, text: string) {
  const session = sessions.get(threadId);
  const index = session?.sent.findLastIndex((m) => m.text.includes(text)) ?? -1;
  if (!session?.sessionId || index < 0) return null;
  return forkPoint(session.sent, index, await transcriptUuids(session.account.configDir, session.sessionId));
}

/** Stops one subagent (Agent tool task) of a live session; Claude Code then reports it `stopped`. */
export async function stopClaudeSubagent(threadId: string, subagentId: string) {
  const session = sessions.get(threadId);
  const taskId = session?.mapper.taskOf(subagentId);
  if (!session?.query || !taskId) throw new Error('That subagent is not running in a live Claude session');
  await session.query.stopTask(taskId);
}

export function resolveClaude(requestId: string, decision: AgentDecision) {
  const pending = approvals.get(requestId);
  if (!pending) return false;
  approvals.delete(requestId);
  pending.resolve(permissionResult(pending.toolName, pending.input, decision));
  return true;
}

// Quitting closes every Claude Code process; their transcripts are already on disk, so each thread resumes from its
// persisted session id when the user next sends. Nothing resumes on launch: that would spend the user's usage unasked.
app.on('before-quit', () => {
  for (const threadId of [...sessions.keys()]) stopClaude(threadId);
});

async function schedule(session: Session) {
  const cap = (await config()).concurrencyCap() || DEFAULT_CAP;
  const live = [...sessions.values()].filter((s) => s.query).length;
  if (live >= cap) {
    evictIdle() ? void launch(session) : waiting.push(session);
    return;
  }
  void launch(session);
}

async function launch(session: Session) {
  const { threadId, options } = session;
  const abort = new AbortController();
  const sentBefore = session.sent.length;
  let isForkRefused = false;
  try {
    const { accountEnv, apiKeyFor, defaultModel, userPath } = await config();
    const { configDir = null } = session.account;
    const install = await (await import('../../settings/detect.ts')).detect({ id: session.account.id, provider: 'claude', name: session.account.id, configDir });
    if (!install.path) throw new Error(`Claude Code is not installed. Install it (\`${HARNESSES.claude.install}\`) or set its path in Settings, then send again.`);
    // A consequential Mochi call waits on the user's card; Claude Code's own MCP timeout would cut it short.
    const base = withPlanTools({ ...hooksEnv(accountEnv('claude', configDir)), PATH: await userPath(), MCP_TOOL_TIMEOUT: String(MOCHI_TIMEOUT_MS) });
    // The key moves billing off the account's plan, so it is set only for a thread the user switched to it.
    const key = options.useApiKey ? apiKeyFor('claude') : undefined;
    if (options.useApiKey && !key) throw new Error('No Anthropic API key is stored. Add one in Settings, then try again.');
    const env = key ? { ...base, ANTHROPIC_API_KEY: key } : base;
    if (install.login.state === 'logged-out' && !key) throw new Error(session.account.configDir ? `The Claude account for this profile is logged out. Run \`CLAUDE_CONFIG_DIR=${session.account.configDir} claude auth login\` in a terminal, then send again.` : 'Claude Code is logged out. Run `claude auth login` in a terminal, then send again.');
    if (sessions.get(threadId) !== session) return;
    session.abort = abort;
    const { forkAt, isMissing } = await takeForkAt(session);
    if (isMissing) emit({ threadId, type: 'notice', text: FORK_MISSING_NOTICE });
    const mode = (options.permissionMode as PermissionMode | undefined) ?? 'default';
    const permissions = permissionOptions(mode);
    session.query = query({
      prompt: inbox(session, abort.signal),
      options: {
        pathToClaudeCodeExecutable: install.path,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: MOCHI_INSTRUCTIONS },
        settings: { skillOverrides: HIDDEN_CLAUDE_SKILLS },
        cwd: options.cwd,
        model: options.model ?? defaultModel('claude') ?? DEFAULT_MODEL,
        ...(options.effort && { effort: options.effort as EffortLevel }),
        // The flag layer is also the Agent SDK's opt-in: without `fastMode` there, Claude Code reports `sdk_opt_in_required`.
        ...(options.speed && { settings: { fastMode: true } }),
        ...permissions,
        // Never `continue`: it picks the cwd's latest session, which can belong to another thread.
        ...(session.sessionId && { resume: session.sessionId }),
        // `takeForkAt` gives it to one launch only: init then hands back the fork's own id, and later launches resume that whole.
        ...(forkAt && { resumeSessionAt: forkAt, forkSession: true }),
        env,
        includePartialMessages: true,
        enableFileCheckpointing: true,
        abortController: abort,
        canUseTool: approve(threadId),
        mcpServers: { [SERVER]: claudeServer(threadId) },
        hooks: { ...PR_GUARD, ...compactHooks(threadId) },
        allowedTools: [...AUTO_ALLOWED, ...permissions.allowedTools],
      },
    });
    for await (const message of session.query) {
      if (forkAt && message.type === 'result' && message.subtype !== 'success' && message.errors.some((e) => e.includes(MISSING_FORK_POINT))) {
        isForkRefused = true;
        break;
      }
      if ((message.type === 'assistant' || message.type === 'user') && !message.parent_tool_use_id && message.uuid) session.lastUuid = message.uuid;
      if (message.type === 'system' && message.subtype === 'init') {
        session.sessionId = message.session_id;
        void session.query.supportedCommands().then((list) => emit({ threadId, type: 'info', info: { commands: commandsFrom(list) } }), () => {});
      }
      // Auto mode depends on the plan, the model and fast mode; where Claude Code can't run it, edits fall back to acceptEdits rather than asking every time.
      if (message.type === 'system' && message.subtype === 'init' && mode === 'auto' && message.permissionMode !== 'auto') void session.query.setPermissionMode('acceptEdits').catch(() => {});
      if (message.type === 'rate_limit_event') void recordLimits(session.account.id, 'claude', [claudeEventWindow(message.rate_limit_info)].filter((w) => !!w));
      session.mapper.map(message).forEach(emit);
      if (message.type !== 'result') continue;
      void session.query.mcpServerStatus().then((list) => emit({ threadId, type: 'info', info: { mcpServers: mcpServersFromStatus(list) } }), () => {});
      session.isBusy = session.inbox.length > 0;
      if (!session.isBusy && waiting.length) release(session);
    }
  } catch (error) {
    if (!abort.signal.aborted) emit({ threadId, type: 'turn-end', status: 'failed', error: error instanceof Error ? error.message : String(error) });
  } finally {
    if (session.abort === abort) release(session);
  }
  if (isForkRefused && sessions.get(threadId) === session) await resumeWhole(session, sentBefore);
}

/** Claude Code refused the fork before running anything: the same messages go again on the whole session (its `forkAt` is spent). */
async function resumeWhole(session: Session, sentBefore: number) {
  const unread = session.sent.splice(sentBefore);
  session.lastUuid = unread[0]?.after ?? session.lastUuid;
  session.inbox.unshift(...unread.map(({ text, images }) => ({ text, images })));
  session.isBusy = true;
  emit({ threadId: session.threadId, type: 'notice', text: FORK_REFUSED_NOTICE });
  await schedule(session);
}

/** Ends a session's process and hands its slot to the next waiting thread. The record stays for `send` unless stopped. */
function release(session: Session) {
  const { query: q, abort } = session;
  session.query = undefined;
  session.abort = undefined;
  session.isBusy = false;
  dropApprovals(session.threadId, 'The session ended');
  abort?.abort();
  q?.close();
  if (!q) return;
  const next = waiting.shift();
  if (next) void launch(next);
}

function evictIdle() {
  const idle = [...sessions.values()].find((s) => s.query && !s.isBusy);
  if (idle) release(idle);
  return !!idle;
}

async function* inbox(session: Session, signal: AbortSignal): AsyncGenerator<SDKUserMessage> {
  while (!signal.aborted) {
    const next = session.inbox.shift();
    if (next) {
      const uuid = randomUUID();
      session.sent.push({ uuid, text: next.text, images: next.images, after: session.lastUuid ?? null });
      session.lastUuid = uuid;
      session.mapper.sent(next.text).forEach(emit);
      yield { type: 'user', message: { role: 'user', content: userContent(next.text, next.images) }, parent_tool_use_id: null, uuid };
      continue;
    }
    try {
      await once(session.wake, 'push', { signal });
    } catch {
      return;
    }
  }
}

/**
 * Claude Code appends a callback hook's `systemMessage` to the compaction's custom instructions, for `/compact` and auto-compact
 * alike (read in the 2.1.296 binary: PreCompact output → `newCustomInstructions`). PostCompact hands over the summary.
 */
function compactHooks(threadId: string): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return {
    PreCompact: [{ hooks: [async () => ({ ...(keep.has(threadId) && { systemMessage: keep.get(threadId) }) })] }],
    PostCompact: [
      {
        hooks: [
          async (input) => {
            if (input.hook_event_name === 'PostCompact') emit({ threadId, type: 'compaction', phase: 'summary', summary: input.compact_summary });
            return {};
          },
        ],
      },
    ],
  };
}

function approve(threadId: string): CanUseTool {
  return (toolName, input, { signal, toolUseID, title, description, decisionReason }) =>
    new Promise((resolve) => {
      approvals.set(toolUseID, { threadId, toolName, input, resolve });
      // Claude Code withdrew the prompt (interrupt, its own cancel): the card goes with it rather than taking an answer nobody reads.
      signal.addEventListener('abort', () => approvals.delete(toolUseID) && emit({ threadId, type: 'resolved', requestId: toolUseID }), { once: true });
      emit(approvalEvent(threadId, toolUseID, toolName, input, title ?? toolName, description ?? decisionReason ?? ''));
    });
}

function dropApprovals(threadId: string, message: string) {
  for (const [id, pending] of approvals) {
    if (pending.threadId !== threadId) continue;
    approvals.delete(id);
    pending.resolve({ behavior: 'deny', message, interrupt: true });
    emit({ threadId, type: 'resolved', requestId: id });
  }
}

// Imported lazily: config.ts loads Electron, which the adapters' node tests don't have.
const config = () => import('../config.ts');

const emit = emitAgentEvent;
