import { randomUUID } from 'node:crypto';
import { goalNudge } from './goalNudge.ts';
import { saveImage } from '../images.ts';
import { EventEmitter, once } from 'node:events';
import {
  query,
  type CanUseTool,
  type EffortLevel,
  type HookCallbackMatcher,
  type HookEvent,
  type McpServerConfig,
  type PermissionMode,
  type PermissionResult,
  type Query,
  type SDKUserMessage,
  type SDKUserMessageReplay,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentDecision,
  AgentImage,
  AgentRunOptions,
  AgentSendInput,
  ContextUsage,
} from '../../../../../apps/desktop/src/host/types/agent.ts';
import type { HarnessAdapter } from '../adapter.ts';
import type { McpWidgetResource } from '../../../../../apps/desktop/src/model.ts';
import { accountFor, type ClaudeAccount } from './account.ts';
import { HARNESSES } from '../../../../../apps/desktop/src/settings/harnesses.ts';
import { toClaude } from '../../../../../apps/desktop/src/settings/agentConfig.ts';
import { claudePermissions } from '@mochi/domain/library/connectorTools';
import {
  claudeNativeSettings,
  offItems,
} from '../../../../../apps/desktop/src/library/nativeOverrides.ts';
import {
  accountInstructionsPath,
  readProfileConfig,
} from '../profileConfig.ts';
import { warmClaude } from './oneshot.ts';
import {
  approvalEvent,
  commandsFrom,
  createMapper,
  HIDDEN_PLAN_TOOLS,
  isPreApproved,
  mcpServersFromStatus,
  PERMISSION_MODES,
  permissionOptions,
  permissionResult,
  setMode,
  userContent,
} from './map.ts';
import { AUTO_ALLOWED, claudeServer, SERVER } from '../mochiTools.ts';
import { emitAgentEvent } from '../events.ts';
import { main } from '../main.ts';
import {
  accountEnv,
  apiKeyFor,
  concurrencyCap,
  defaultModel,
  userPath,
} from '../config.ts';
import { detect } from '../../../../../apps/desktop/electron/settings/detect.ts';
import { exitEvent } from './exit.ts';
import { spawnThroughRun } from './spawn.ts';
import { CLAUDE_SKILLS_OFF, mochiInstructions } from '../instructions.ts';
import {
  accountInstructionsUsed,
  profileInstructions,
} from '../profileFolder.ts';
import { recordLimits } from '../limits.ts';
import { claudeEventWindow } from '../../../../../apps/desktop/src/usage/limits.ts';
import { MOCHI_TIMEOUT_MS } from '@mochi/domain/runtime/toolTable';
import { recordClaudeAiConnectors } from './claudeAiConnectors.ts';
import {
  FORK_MISSING_NOTICE,
  FORK_REFUSED_NOTICE,
  forkPoint,
  MISSING_FORK_POINT,
  takeForkAt,
  transcriptUuids,
} from './fork.ts';
import { FRESH_SESSION_NOTICE, MISSING_SESSION } from './move.ts';

/**
 * One `query()` per thread, fed by a streaming-input inbox. A live session holds a Claude Code child process; at most
 * the concurrency cap are live, the rest wait in `waiting`. A session whose turn ended gives its process up when someone is
 * waiting and comes back with `resume` on its next message.
 */
interface Session {
  threadId: string;
  options: AgentRunOptions;
  inbox: {
    text: string;
    images?: AgentImage[];
    priority?: 'next';
    steerId?: string;
  }[];
  /** Messages sent into a running turn, by the renderer's id, until Claude Code echoes that it took them (`readSteer`). */
  steered: Map<
    string,
    {
      uuid: string;
      text: string;
      after: string | null;
      hasSeenResult?: boolean;
    }
  >;
  /** Every message handed to Claude Code, with the uuid `rewindFiles` takes and the chain entry before it (`rewindPoint`). */
  sent: {
    uuid: string;
    text: string;
    images?: AgentImage[];
    after: string | null;
  }[];
  /** The newest entry of the main conversation chain; undefined while a resumed session hasn't shown one yet. */
  lastUuid?: string | null;
  wake: EventEmitter;
  mapper: ReturnType<typeof createMapper>;
  query?: Query;
  /** Claude Code's process, spawned through Core's `run`; killing it takes its tree down. */
  child?: ReturnType<typeof spawnThroughRun>;
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
const approvals = new Map<
  string,
  {
    threadId: string;
    toolName: string;
    input: Record<string, unknown>;
    resolve: (result: PermissionResult) => void;
  }
>();

/** Core's same-provider switch: the run a fresh session starts with, handed the thread so far. */
type FreshRun = (
  threadId: string,
  run: AgentRunOptions,
) => Promise<AgentRunOptions>;
let freshRun: FreshRun = async (_threadId, run) => run;

export function setClaudeFreshRun(run: FreshRun) {
  freshRun = run;
}

export const DEFAULT_MODEL = 'claude-opus-5-5';
const DEFAULT_CAP = 6;
const EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export const claude = {
  has: (threadId) => sessions.has(threadId),
  threadIds: () => [...sessions.keys()],
  start: startClaude,
  send: sendClaude,
  unsteer: unsteerClaude,
  compact: compactClaude,
  interrupt: interruptClaude,
  stop: async (threadId) => stopClaude(threadId),
  stopTask: stopClaudeTask,
  respond: async (requestId, decision) => resolveClaude(requestId, decision),
  rewindPoint: claudeRewindPoint,
  rewindFiles: rewindClaude,
  runOptions: (threadId) => sessions.get(threadId)?.options,
} satisfies HarnessAdapter;

async function startClaude(threadId: string, options: AgentRunOptions) {
  if (options.permissionMode && !(options.permissionMode in PERMISSION_MODES))
    throw new TypeError(
      `permissionMode must be one of ${Object.keys(PERMISSION_MODES).join(', ')}`,
    );
  if (options.effort && !EFFORTS.includes(options.effort as EffortLevel))
    throw new TypeError(`effort must be one of ${EFFORTS.join(', ')}`);
  if (options.speed && options.speed !== 'fast')
    throw new TypeError('speed must be fast');
  const account = await accountFor(options.spaceId, 'claude');
  stopClaude(threadId);
  const session: Session = {
    threadId,
    options,
    account,
    inbox: [{ text: options.prompt, images: options.images }],
    sent: [],
    steered: new Map(),
    wake: new EventEmitter(),
    mapper: createMapper(threadId, options.cwd, saveImage, options.effort),
    sessionId: options.resume,
    lastUuid: options.resume ? undefined : null,
    isBusy: true,
  };
  sessions.set(threadId, session);
  void warmClaude(options.spaceId).catch(() => {});
  await schedule(session);
}

/**
 * A live process switches `policy` before reading the message; a relaunch starts in it. `steer`: the turn in flight folds the
 * message in at its next step instead of answering it after (the queue's Send now). `steerId`: reported back as `steer-read`
 * once Claude Code takes the message, and what `unsteerClaude` takes back before then.
 */
async function sendClaude(
  threadId: string,
  { text, images, steer, steerId, policy = {} }: AgentSendInput,
) {
  const session = sessions.get(threadId);
  if (!session)
    throw new Error(
      'No Claude session for this thread in this run of Harness; start it again with resume',
    );
  const { speed, permissionMode } = policy;
  if (speed !== undefined && speed !== (session.options.speed ?? '')) {
    session.options = { ...session.options, speed: speed || undefined };
    await session.query?.applyFlagSettings({ fastMode: !!speed });
  }
  if (
    permissionMode !== undefined &&
    permissionMode !== session.options.permissionMode
  ) {
    if (!(permissionMode in PERMISSION_MODES))
      throw new TypeError(
        `permissionMode must be one of ${Object.keys(PERMISSION_MODES).join(', ')}`,
      );
    session.options = { ...session.options, permissionMode };
    if (session.query)
      await setMode(session.query, permissionMode as PermissionMode);
  }
  session.inbox.push({
    text,
    images,
    ...(steer && { priority: 'next' as const }),
    ...(steerId && { steerId }),
  });
  session.isBusy = true;
  if (session.query) session.wake.emit('push');
  else if (!waiting.includes(session)) await schedule(session);
}

/**
 * Takes back a message sent into the running turn before Claude Code reads it. False once it can't: Claude Code already took it
 * (its `steer-read` follows), or it is being folded in right now.
 */
async function unsteerClaude(threadId: string, steerId: string) {
  const session = sessions.get(threadId);
  if (!session) return true;
  const queued = session.inbox.findIndex((m) => m.steerId === steerId);
  if (queued >= 0) return (session.inbox.splice(queued, 1), true);
  const steer = session.steered.get(steerId);
  if (!steer || !session.query) return false;
  // `cancelAsyncMessage` is in sdk.mjs 0.3.296 (control request `cancel_async_message`) but missing from the typed `Query`; a run on
  // 0.3.296 confirmed a cancelled message never reaches the model.
  const cancellable = session.query as Query & {
    cancelAsyncMessage(uuid: string): Promise<boolean>;
  };
  if (!(await cancellable.cancelAsyncMessage(steer.uuid).catch(() => false)))
    return false;
  session.steered.delete(steerId);
  session.sent = session.sent.filter((m) => m.uuid !== steer.uuid);
  if (session.lastUuid === steer.uuid) session.lastUuid = steer.after;
  return true;
}

/** `/compact` is Claude Code's own command, taken as a message; the PreCompact hook adds Mochi's instructions to `focus`. */
function compactClaude(threadId: string, focus: string) {
  return sendClaude(threadId, {
    text: focus ? `/compact ${focus}` : '/compact',
  });
}

export function setClaudeCompactInstructions(
  threadId: string,
  instructions: string,
) {
  if (instructions) keep.set(threadId, instructions);
  else keep.delete(threadId);
}

async function interruptClaude(threadId: string) {
  const session = sessions.get(threadId);
  if (!session) return;
  dropApprovals(threadId, 'Interrupted by the user');
  const queued = waiting.indexOf(session);
  if (queued >= 0) waiting.splice(queued, 1);
  if (!session.query || !session.isBusy)
    return emit({ threadId, type: 'turn-end', status: 'interrupted' });
  session.mapper.markInterrupting();
  await session.query.interrupt();
}

function stopClaude(threadId: string) {
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
async function rewindClaude(threadId: string, text: string) {
  const session = sessions.get(threadId);
  const uuid = session?.sent.findLast((m) => m.text.includes(text))?.uuid;
  if (!session?.query || !uuid) return;
  const result = await session.query.rewindFiles(uuid);
  if (!result.canRewind)
    console.warn(
      `Claude rewind skipped for ${threadId}: ${result.error ?? 'no checkpoint'}`,
    );
}

/** The transcript entry just before the latest sent message with this text, for `forkAt`; null when unknown or it was the first. */
async function claudeRewindPoint(threadId: string, text: string) {
  const session = sessions.get(threadId);
  const index = session?.sent.findLastIndex((m) => m.text.includes(text)) ?? -1;
  if (!session?.sessionId || index < 0) return null;
  return forkPoint(
    session.sent,
    index,
    await transcriptUuids(session.account.configDir, session.sessionId),
  );
}

/** Stops one background task of a live session: a subagent (by its Agent call's id) or a shell, workflow or monitor (by its task id); Claude Code then reports it `stopped`. */
async function stopClaudeTask(threadId: string, id: string) {
  const session = sessions.get(threadId);
  const taskId = session?.mapper.taskOf(id);
  if (!session?.query || !taskId)
    throw new Error('That task is not running in a live Claude session');
  await session.query.stopTask(taskId);
}

function resolveClaude(requestId: string, decision: AgentDecision) {
  const pending = approvals.get(requestId);
  if (!pending) return false;
  approvals.delete(requestId);
  pending.resolve(permissionResult(pending.toolName, pending.input, decision));
  return true;
}

/**
 * Claude Code has no transcript of the session under this folder (a moved thread whose copy it didn't find): the same messages
 * start a fresh session instead, so the thread never breaks. Its run comes from Core's same-provider switch.
 */
async function startFresh(session: Session, sentBefore: number) {
  const unread = session.sent.splice(sentBefore);
  session.sent = [];
  session.sessionId = undefined;
  session.lastUuid = null;
  session.inbox.unshift(
    ...unread.map(({ text, images }) => ({ text, images })),
  );
  session.isBusy = true;
  emit({
    threadId: session.threadId,
    type: 'notice',
    text: FRESH_SESSION_NOTICE,
  });
  const { resume: _, ...options } = session.options;
  const run = {
    ...options,
    prompt: session.inbox[0]?.text ?? options.prompt,
  };
  session.options = await freshRun(session.threadId, run).catch(() => run);
  if (sessions.get(session.threadId) === session) await schedule(session);
}

/**
 * Core is stopping: every Claude Code process closes. Their transcripts are already on disk, so each thread resumes from its
 * persisted session id when the user next sends. Nothing resumes on launch: that would spend the user's usage unasked.
 */
export function stopAllClaude() {
  for (const threadId of [...sessions.keys()]) stopClaude(threadId);
}

/** The profile's turned-off native items as flag-layer settings, read from the account's config (the thread's project included, for its `.mcp.json`). */
async function nativeOffSettings(options: AgentRunOptions) {
  if (!options.nativeOff?.length) return {};
  const config = await readProfileConfig(options.spaceId, options.cwd);
  return claudeNativeSettings(offItems(config.claude, options.nativeOff));
}

async function schedule(session: Session) {
  const cap = concurrencyCap() || DEFAULT_CAP;
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
  let isSessionMissing = false;
  try {
    const { configDir = null } = session.account;
    const install = await detect({
      id: session.account.id,
      provider: 'claude',
      name: session.account.id,
      configDir,
    });
    if (!install.path)
      throw new Error(
        `Claude Code is not installed. Install it (\`${HARNESSES.claude.install}\`) or set its path in Settings, then send again.`,
      );
    // A consequential Mochi call waits on the user's card; Claude Code's own MCP timeout would cut it short.
    const base = {
      ...accountEnv('claude', configDir),
      PATH: await userPath(),
      MCP_TOOL_TIMEOUT: String(MOCHI_TIMEOUT_MS),
    };
    // The key moves billing off the account's plan, so it is set only for a thread the user switched to it.
    const key = options.useApiKey ? await apiKeyFor('claude') : undefined;
    if (options.useApiKey && !key)
      throw new Error(
        'No Anthropic API key is stored. Add one in Settings, then try again.',
      );
    const env = key ? { ...base, ANTHROPIC_API_KEY: key } : base;
    if (install.login.state === 'logged-out' && !key)
      throw new Error(
        session.account.configDir
          ? `The Claude account for this profile is logged out. Run \`CLAUDE_CONFIG_DIR=${session.account.configDir} claude auth login\` in a terminal, then send again.`
          : 'Claude Code is logged out. Run `claude auth login` in a terminal, then send again.',
      );
    const [library, native, profileText, isAccountFileUsed] = await Promise.all(
      [
        main.library(options.spaceId, 'claude'),
        nativeOffSettings(options),
        profileInstructions(options.spaceId, 'claude'),
        accountInstructionsUsed(options.spaceId, 'claude'),
      ],
    );
    const { connectors, rules: toolRules } = library;
    if (sessions.get(threadId) !== session) return;
    session.abort = abort;
    const { forkAt, isMissing } = await takeForkAt(session);
    if (isMissing)
      emit({ threadId, type: 'notice', text: FORK_MISSING_NOTICE });
    const mode =
      (options.permissionMode as PermissionMode | undefined) ?? 'default';
    const permissions = permissionOptions(mode);
    const connectorRules = claudePermissions(toolRules);
    const deniedConnectors = (native.deniedMcpServers ?? []).flatMap((d) =>
      'serverName' in d ? [d.serverName] : [],
    );
    session.query = query({
      prompt: inbox(session, abort.signal),
      options: {
        pathToClaudeCodeExecutable: install.path,
        // Through Core's `run`, so stopping the session kills Claude Code's whole process tree (its MCP servers and shells too).
        spawnClaudeCodeProcess: (spawn) =>
          (session.child = spawnThroughRun(spawn)),
        // A settings chat isn't Claude Code: no coding preset, no built-in tools, none of the profile's plugins or servers.
        // The profile's own instructions (its folder's mochi.md and claude.md) follow Mochi's; the account's CLAUDE.md loads as usual.
        systemPrompt: options.isSettingsChat
          ? mochiInstructions(options)
          : {
              type: 'preset',
              preset: 'claude_code',
              append: [mochiInstructions(options), profileText, options.context]
                .filter(Boolean)
                .join('\n\n'),
            },
        ...(options.isSettingsChat && { tools: [] }),
        // The flag layer is also the Agent SDK's opt-in for fast mode: without `fastMode` there, Claude Code reports `sdk_opt_in_required`.
        // The profile's turned-off native items join the flag layer here; nothing is written to the account's own files.
        settings: {
          ...native,
          skillOverrides: { ...CLAUDE_SKILLS_OFF, ...native.skillOverrides },
          permissions: connectorRules,
          // The user's own CLAUDE.md, when this profile turned it off; project and local ones still load.
          ...(!isAccountFileUsed && {
            claudeMdExcludes: [
              accountInstructionsPath('claude', {
                configDir: session.account.configDir ?? null,
              }),
            ],
          }),
          ...(options.speed && { fastMode: true }),
        },
        // Claude in Chrome would otherwise wire itself when CLAUDE_CODE_ENABLE_CFC=1 is in the user's environment.
        // `replay-user-messages` echoes each message as Claude Code takes it, which marks a steered message read (`readSteer`).
        extraArgs: { 'no-chrome': null, 'replay-user-messages': null },
        cwd: options.cwd,
        model: options.model ?? defaultModel('claude') ?? DEFAULT_MODEL,
        ...(options.effort && { effort: options.effort as EffortLevel }),
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
        plugins: options.isSettingsChat
          ? []
          : library.pluginDirs.map((path) => ({
              type: 'local' as const,
              path,
            })),
        mcpServers: {
          ...(!options.isSettingsChat &&
            Object.fromEntries(
              library.servers.map((def) => [
                def.name,
                toClaude(def) as McpServerConfig,
              ]),
            )),
          ...(!options.isSettingsChat &&
            Object.fromEntries(
              connectors.map(([name, url]) => [
                name,
                { type: 'http' as const, url },
              ]),
            )),
          [SERVER]: claudeServer(
            threadId,
            options.spaceId,
            options.cwd,
            main.mochiTool,
            options,
          ),
        },
        hooks: {
          ...compactHooks(threadId),
          PreToolUse: options.isGoalsOff ? [] : [goalNudge(threadId)],
        },
        allowedTools: [...AUTO_ALLOWED, ...permissions.allowedTools],
        // Deny rules alone only refuse a call; disallowedTools also takes an Off tool out of the model's context (sdk.d.ts).
        disallowedTools: [...HIDDEN_PLAN_TOOLS, ...connectorRules.deny],
      },
    });
    for await (const message of session.query) {
      if (
        forkAt &&
        message.type === 'result' &&
        message.subtype !== 'success' &&
        message.errors.some((e) => e.includes(MISSING_FORK_POINT))
      ) {
        isForkRefused = true;
        break;
      }
      // A side session (`<thread>--handoff`) reports it as a failed turn, which its caller handles.
      if (
        session.sessionId &&
        !threadId.includes('--') &&
        message.type === 'result' &&
        message.subtype !== 'success' &&
        message.errors.some((e) => e.includes(MISSING_SESSION))
      ) {
        isSessionMissing = true;
        break;
      }
      if (
        message.type === 'user' &&
        'isReplay' in message &&
        message.isReplay
      ) {
        readSteer(session, message);
        continue;
      }
      if (
        (message.type === 'assistant' || message.type === 'user') &&
        !message.parent_tool_use_id &&
        message.uuid
      )
        session.lastUuid = message.uuid;
      if (message.type === 'system' && message.subtype === 'init') {
        session.sessionId = message.session_id;
        void session.query.supportedCommands().then(
          (list) =>
            emit({
              threadId,
              type: 'info',
              info: { commands: commandsFrom(list) },
            }),
          () => {},
        );
      }
      // `setMode`'s fallback, for a session that started in Auto: init reports the mode it actually runs.
      if (
        message.type === 'system' &&
        message.subtype === 'init' &&
        mode === 'auto' &&
        message.permissionMode !== 'auto'
      )
        void session.query.setPermissionMode('acceptEdits').catch(() => {});
      if (message.type === 'rate_limit_event')
        void recordLimits(
          session.account.id,
          'claude',
          [claudeEventWindow(message.rate_limit_info)].filter((w) => !!w),
        );
      // A server's tools load on its first call (deferred behind tool search), so which ones declare a view is read then.
      if (session.mapper.needsWidgets(message))
        session.mapper.learnWidgets(
          await session.query.mcpServerStatus().catch(() => []),
        );
      session.mapper.map(message).forEach(emit);
      if (message.type !== 'result') continue;
      unreadAfterTwoTurns(session);
      void session.query.mcpServerStatus().then(
        (list) => {
          emit({
            threadId,
            type: 'info',
            info: { mcpServers: mcpServersFromStatus(list) },
          });
          void recordClaudeAiConnectors(
            session.account.id,
            list,
            deniedConnectors,
          );
        },
        () => {},
      );
      session.isBusy = session.inbox.length > 0;
      if (!session.isBusy && waiting.length) release(session);
    }
  } catch (error) {
    const ended = exitEvent(threadId, session.isBusy, error);
    if (!abort.signal.aborted && ended) emit(ended);
  } finally {
    if (session.abort === abort) release(session);
  }
  if (isForkRefused && sessions.get(threadId) === session)
    await resumeWhole(session, sentBefore);
  if (isSessionMissing && sessions.get(threadId) === session)
    await startFresh(session, sentBefore);
}

/** Claude Code refused the fork before running anything: the same messages go again on the whole session (its `forkAt` is spent). */
async function resumeWhole(session: Session, sentBefore: number) {
  const unread = session.sent.splice(sentBefore);
  session.lastUuid = unread[0]?.after ?? session.lastUuid;
  session.inbox.unshift(
    ...unread.map(({ text, images }) => ({ text, images })),
  );
  session.isBusy = true;
  emit({
    threadId: session.threadId,
    type: 'notice',
    text: FORK_REFUSED_NOTICE,
  });
  await schedule(session);
}

/**
 * A tool's MCP App view, read through the Claude Code process that dialed `server`: the thread's own, or another live one on
 * the same account (its connectors are the account's). Throws when none is live.
 */
export async function readClaudeWidget(
  threadId: string,
  server: string,
  uri: string,
): Promise<McpWidgetResource> {
  const account = sessions.get(threadId)?.account.id;
  const live =
    sessions.get(threadId)?.query ??
    [...sessions.values()].find((s) => s.query && s.account.id === account)
      ?.query;
  if (!live)
    throw new Error('No Claude session is running to read this view from.');
  const { contents } = await live.readMcpResource(server, uri);
  const item = contents.find((c) => c.uri === uri) ?? contents[0];
  const html =
    item?.text ??
    (item?.blob && Buffer.from(item.blob, 'base64').toString('utf8'));
  if (!html) throw new Error(`${server} returned no HTML for ${uri}.`);
  return { html, ...(item._meta && { meta: item._meta }) };
}

/** `summary` answers from the last response's usage and local estimates, skipping a token-count API call per category. */
export async function claudeContextUsage(
  threadId: string,
): Promise<ContextUsage | null> {
  const live = sessions.get(threadId)?.query;
  if (!live) return null;
  const { categories, totalTokens } = await live.getContextUsage({
    detail: 'summary',
  });
  return {
    categories: categories.map(({ name, tokens, kind }) => ({
      name,
      tokens,
      kind,
    })),
    totalTokens,
  };
}

/** Ends a session's process and hands its slot to the next waiting thread. The record stays for `send` unless stopped. */
function release(session: Session) {
  const { query: q, abort } = session;
  const child = session.child;
  session.query = undefined;
  session.abort = undefined;
  session.child = undefined;
  session.isBusy = false;
  dropApprovals(session.threadId, 'The session ended');
  abort?.abort();
  q?.close();
  // The SDK closes stdin and kills only after a grace period; SIGTERM to the group now still lets Claude Code flush its transcript.
  child?.kill('SIGTERM');
  if (!q) return;
  const next = waiting.shift();
  if (next) void launch(next);
}

function evictIdle() {
  const idle = [...sessions.values()].find((s) => s.query && !s.isBusy);
  if (idle) release(idle);
  return !!idle;
}

async function* inbox(
  session: Session,
  signal: AbortSignal,
): AsyncGenerator<SDKUserMessage> {
  while (!signal.aborted) {
    const next = session.inbox.shift();
    if (next) {
      const uuid = randomUUID();
      if (next.steerId)
        session.steered.set(next.steerId, {
          uuid,
          text: next.text,
          after: session.lastUuid ?? null,
        });
      session.sent.push({
        uuid,
        text: next.text,
        images: next.images,
        after: session.lastUuid ?? null,
      });
      session.lastUuid = uuid;
      session.mapper.sent(next.text).forEach(emit);
      // `priority: 'next'` is read from the 0.3.296 binary: 'next' folds into the running turn, 'now' cuts it, 'later' waits for it to end.
      yield {
        type: 'user',
        message: { role: 'user', content: userContent(next.text, next.images) },
        parent_tool_use_id: null,
        uuid,
        ...(next.priority && { priority: next.priority }),
      };
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
 * Claude Code echoes each user message as it takes it (`--replay-user-messages`), a mid-turn fold right after the tool results it
 * followed, under the uuid Mochi sent (run on 0.3.296). That echo is where the renderer places a steered message, marked read.
 */
function readSteer(session: Session, message: SDKUserMessageReplay) {
  const hit = [...session.steered].find(([, s]) => s.uuid === message.uuid);
  if (!hit) return;
  session.steered.delete(hit[0]);
  emit({ threadId: session.threadId, type: 'steer-read', id: hit[0] });
}

/** A steer still unread after two turn ends was taken without an echo Mochi saw: it counts as read, so it stops waiting. */
function unreadAfterTwoTurns(session: Session) {
  for (const [id, steer] of session.steered) {
    if (!steer.hasSeenResult) {
      steer.hasSeenResult = true;
      continue;
    }
    session.steered.delete(id);
    emit({ threadId: session.threadId, type: 'steer-read', id });
  }
}

/**
 * Claude Code appends a callback hook's `systemMessage` to the compaction's custom instructions, for `/compact` and auto-compact
 * alike (read in the 2.1.296 binary: PreCompact output → `newCustomInstructions`). PostCompact hands over the summary.
 */
function compactHooks(
  threadId: string,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return {
    PreCompact: [
      {
        hooks: [
          async () => ({
            ...(keep.has(threadId) && { systemMessage: keep.get(threadId) }),
          }),
        ],
      },
    ],
    PostCompact: [
      {
        hooks: [
          async (input) => {
            if (input.hook_event_name === 'PostCompact')
              emit({
                threadId,
                type: 'compaction',
                phase: 'summary',
                summary: input.compact_summary,
              });
            return {};
          },
        ],
      },
    ],
  };
}

function approve(threadId: string): CanUseTool {
  return (
    toolName,
    input,
    { signal, toolUseID, title, description, decisionReason },
  ) =>
    new Promise((resolve) => {
      if (
        isPreApproved(sessions.get(threadId)?.options.permissionMode, toolName)
      )
        return resolve({ behavior: 'allow', updatedInput: input });
      approvals.set(toolUseID, { threadId, toolName, input, resolve });
      // Claude Code withdrew the prompt (interrupt, its own cancel): the card goes with it rather than taking an answer nobody reads.
      signal.addEventListener(
        'abort',
        () =>
          approvals.delete(toolUseID) &&
          emit({ threadId, type: 'resolved', requestId: toolUseID }),
        { once: true },
      );
      emit(
        approvalEvent(
          threadId,
          toolUseID,
          toolName,
          input,
          title ?? toolName,
          description ?? decisionReason ?? '',
        ),
      );
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

const emit = emitAgentEvent;
