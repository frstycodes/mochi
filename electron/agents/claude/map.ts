import path from 'node:path';
import type { McpServerStatus, ModelInfo, PermissionMode, PermissionResult, SDKCompactBoundaryMessage, SDKMessage, SDKStatusMessage, SDKRateLimitInfo, SDKSystemMessage, SDKTaskNotificationMessage, SDKTaskProgressMessage, SDKTaskStartedMessage, SDKTaskUpdatedMessage, SDKUserMessage, SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import type { AgentDecision, AgentEvent, AgentImage, AgentModel, AgentSubagentEvent, AgentTaskEvent, BackgroundTaskKind } from '../../../src/host/types/agent.ts';
import type { AgentInput, AgentOutput, WebFetchOutput, WebSearchOutput } from '@anthropic-ai/claude-agent-sdk/sdk-tools';
import { getToolUiResourceUri } from '@modelcontextprotocol/ext-apps/app-bridge';
import { ACCOUNT_ARGUMENT } from '../../../src/library/connectors.ts';
import type { AgentCommand, AgentInfo, McpCall, McpServer, McpWidgetResult, WebLink } from '../../../src/model.ts';
import { describeApproval } from '../../../src/summary.ts';
import { claudeFast } from '../../../src/runtime/models.ts';
import { IMAGE_TOOL, imageCard } from '../../../src/runtime/imageTool.ts';
import { MOCHI_SERVER } from '../../../src/runtime/toolTable.ts';
import { claudeEventWindow } from '../../../src/usage/limits.ts';
import { posixPath } from '../../platform.ts';
import type { SaveImage } from '../images.ts';

/**
 * Turns one thread's Claude Agent SDK stream into `AgentEvent`s. Stateful: tool inputs and usage totals carry across
 * messages. `saveImage` keeps images a tool returns as files; without it they're dropped.
 */
export function createMapper(threadId: string, cwd: string, saveImage?: SaveImage, effort?: string) {
  const tools = new Map<string, { name: string; input: Record<string, unknown> }>();
  /** Subagents by the Agent tool call that started them, with the task id Claude Code gives them for `stopTask`. */
  const agents = new Map<string, { taskId?: string }>();
  /** Shells, workflows and monitors by task id; `isBackground` false while one still blocks its call (Claude Code may background it later). */
  const tasks = new Map<string, { kind: BackgroundTaskKind; title: string; command?: string; isBackground: boolean }>();
  const reported = { input: 0, output: 0, cached: 0, costUsd: 0 };
  let context = { used: 0, max: 0 };
  let isNewBlock = false;
  let isInterrupting = false;
  /** Windows Claude Code reported `rejected` (it holds the turn until they reopen), and notices already relayed, by window and reset. */
  const blocked = new Set<string>();
  const told = new Set<string>();
  /** MCP server names from init, to read a server back out of `mcp__<server>__<tool>`. */
  let servers: string[] = [];
  /** Skill names from init; until it arrives, skills sent messages open with wait in `typed`. */
  let skills: string[] | undefined;
  const typed: string[] = [];
  /** `mcp__<server>__<tool>` → the MCP App view it declares, from `mcpServerStatus()`; `read`: tool-name prefixes of servers already read while connected. */
  const widgets = new Map<string, { server: string; uri: string }>();
  const read = new Set<string>();

  // A message opening with `/skill` loads it with no event of its own in the stream (2.1.296), so the load is reported here.
  function typedSkills(): AgentEvent[] {
    if (!skills) return [];
    const known = new Set(skills);
    return typed.splice(0).flatMap((name, i) => {
      if (!known.has(name)) return [];
      const call = { threadId, type: 'tool' as const, id: `skill:${Date.now()}:${i}:${name}`, text: `Skill ${name}`, skill: name };
      return [{ ...call, phase: 'start' as const }, { ...call, phase: 'end' as const }];
    });
  }

  const subagent = (id: string, phase: AgentSubagentEvent['phase'], fields: Omit<AgentSubagentEvent, 'threadId' | 'type' | 'id' | 'phase'> = {}): AgentSubagentEvent => ({ threadId, type: 'subagent', id, phase, ...fields });

  function toolStart(id: string, name: string, input: Record<string, unknown>): AgentEvent[] {
    tools.set(id, { name, input });
    if (AGENT_TOOLS.has(name)) {
      agents.set(id, {});
      const { description, prompt, model, run_in_background } = input as Partial<AgentInput>;
      return [subagent(id, 'start', { toolId: id, name: description || 'Agent', ...(prompt && { prompt }), ...(model && { model }), isBackground: run_in_background === true })];
    }
    if (name === IMAGE_CALL) return [{ threadId, type: 'tool', id, phase: 'start', text: 'Generate image', generated: imageCard(input) }];
    const description = callDescription(name, input);
    return [{ threadId, type: 'tool', id, phase: 'start', text: describeTool(name, input, servers, cwd), ...toolKind(name, input, servers), ...(description ? { description } : commandOf(name, input)) }];
  }

  function toolEnd(block: ToolResultBlock, result: unknown): AgentEvent[] {
    const tool = tools.get(block.tool_use_id);
    if (!tool) return [];
    tools.delete(block.tool_use_id);
    if (AGENT_TOOLS.has(tool.name)) return agentEnd(block, result);
    const backgrounded = backgroundOutput(block, result);
    if (tool.name === IMAGE_CALL) return [{ threadId, type: 'tool', id: block.tool_use_id, phase: 'end', text: 'Generate image', generated: imageCard(tool.input, { text: resultText(block), isError: block.is_error }) }];
    const end: Extract<AgentEvent, { type: 'tool' }> = { threadId, type: 'tool', id: block.tool_use_id, phase: 'end', ...toolOutcome(tool, block, result) };
    const links = block.is_error ? undefined : webLinks(tool.name, tool.input, result);
    if (links) end.links = links;
    // A Read of an image returns it too, but the file is already on disk: the work log shows it from its path.
    const images = saveImage && tool.name !== 'Read' ? imageBlocks(block).map((i) => saveImage(i.media_type, i.data)) : [];
    if (images.length) end.images = images;
    const widget = widgets.get(tool.name);
    if (widget && !block.is_error) end.widget = { ...widget, input: tool.input, result: widgetResult(block, result) };
    return backgrounded ? [end, backgrounded] : [end];
  }

  /** A backgrounded Bash call's receipt names the task and the file its output goes to. */
  function backgroundOutput(block: ToolResultBlock, result: unknown): AgentTaskEvent | undefined {
    const id = (result as { backgroundTaskId?: unknown } | undefined)?.backgroundTaskId;
    const outputFile = /Output is being written to: (\S+?)\.(?:\s|$)/.exec(resultText(block))?.[1];
    if (typeof id !== 'string' || !tasks.get(id)?.isBackground || !outputFile) return undefined;
    return { threadId, type: 'task', id, phase: 'progress', outputFile };
  }

  /** Claude Code's non-agent tasks (`local_bash`, `local_workflow`, monitors), from the moment they run in the background; ambient housekeeping is left out. */
  function mapBackgroundTask(message: SDKTaskStartedMessage | SDKTaskUpdatedMessage | SDKTaskProgressMessage | SDKTaskNotificationMessage): AgentEvent[] {
    const task = (fields: Omit<AgentTaskEvent, 'threadId' | 'type' | 'id'>): AgentTaskEvent => ({ threadId, type: 'task', id: message.task_id, ...fields });
    const known = tasks.get(message.task_id);
    if (message.subtype === 'task_started') {
      if (message.ambient || message.task_type === 'local_agent') return [];
      const command = message.tool_use_id && tools.get(message.tool_use_id)?.input.command;
      const entry = { kind: TASK_KINDS[message.task_type ?? ''] ?? 'monitor', title: message.description || message.workflow_name || (typeof command === 'string' ? command : 'Task'), ...(typeof command === 'string' && { command }), isBackground: message.is_backgrounded !== false };
      tasks.set(message.task_id, entry);
      return entry.isBackground ? [taskStart(task, entry)] : [];
    }
    if (!known) return [];
    if (message.subtype === 'task_updated') {
      if (known.isBackground || !message.patch.is_backgrounded) return [];
      known.isBackground = true;
      return [taskStart(task, known)];
    }
    if (message.subtype !== 'task_notification') return [];
    tasks.delete(message.task_id);
    if (!known.isBackground) return [];
    const exit = /exit code (\d+)/i.exec(message.summary)?.[1];
    return [task({ phase: 'end', status: TASK_STATUS[message.status], outputFile: message.output_file, ...(exit !== undefined && { exitCode: Number(exit) }) })];
  }

  /** What a finished call reports, the thread's own or a subagent's: its line, edited files, a command's exit code and output tail, an edit's patch. */
  function toolOutcome(tool: { name: string; input: Record<string, unknown> }, block: ToolResultBlock, result: unknown) {
    const outcome: { text: string; files?: string[]; exitCode?: number; output?: string; patch?: string } = { text: describeTool(tool.name, tool.input, servers, cwd) };
    const file = tool.input.file_path ?? tool.input.notebook_path;
    if (typeof file === 'string' && EDIT_TOOLS.has(tool.name) && !block.is_error) outcome.files = [posixPath(path.relative(cwd, path.resolve(cwd, file)))];
    if (tool.name === 'Bash') Object.assign(outcome, { exitCode: exitCode(block), output: tail(resultText(block)) });
    const patch = !block.is_error && EDIT_TOOLS.has(tool.name) ? patchOf(tool.input, result) : undefined;
    if (patch) outcome.patch = patch;
    return outcome;
  }

  /** The Agent tool's own result: the whole answer for a foreground agent, a launch receipt for a background one (its end comes as `task_notification`). */
  function agentEnd(block: ToolResultBlock, result: unknown): AgentEvent[] {
    const id = block.tool_use_id;
    if (block.is_error) return [subagent(id, 'end', { status: 'failed', error: resultText(block) })];
    const output = result as AgentOutput | undefined;
    if (output?.status === 'async_launched') return [subagent(id, 'progress', { isBackground: true, ...(output.resolvedModel && { model: output.resolvedModel }) })];
    if (output?.status !== 'completed') return [];
    return [subagent(id, 'end', { status: 'done', result: output.content.map((c) => c.text).join('\n'), tokens: output.totalTokens, ...(output.resolvedModel && { model: output.resolvedModel }) })];
  }

  /** A message from inside a subagent (`parent_tool_use_id` is its Agent call): its tool calls and text, as its own steps. */
  function mapSubagent(id: string, message: SDKMessage): AgentEvent[] {
    if (!agents.has(id)) return [];
    if (message.type === 'assistant')
      return message.message.content.flatMap((block): AgentEvent[] => {
        if (block.type === 'text' && block.text) return [subagent(id, 'progress', { message: block.text })];
        if (block.type !== 'tool_use') return [];
        const input = block.input as Record<string, unknown>;
        tools.set(block.id, { name: block.name, input });
        const description = callDescription(block.name, input);
        return [subagent(id, 'progress', { step: { id: block.id, phase: 'start', text: describeTool(block.name, input, servers, cwd), ...(description && { description }) } })];
      });
    if (message.type !== 'user' || typeof message.message.content === 'string') return [];
    return message.message.content.flatMap((block): AgentEvent[] => {
      if (block.type !== 'tool_result') return [];
      const result = block as ToolResultBlock;
      const tool = tools.get(result.tool_use_id);
      if (!tool) return [];
      tools.delete(result.tool_use_id);
      return [subagent(id, 'progress', { step: { id: result.tool_use_id, phase: 'end', ...toolOutcome(tool, result, message.tool_use_result) } })];
    });
  }

  /** Claude Code's task bookends for a subagent (`task_started` … `task_notification`), joined to its Agent call by `tool_use_id`. */
  function mapTask(message: Extract<SDKMessage, { type: 'system' }>): AgentEvent[] {
    if (message.subtype === 'task_updated') {
      if (tasks.has(message.task_id)) return mapBackgroundTask(message);
      const id = [...agents].find(([, a]) => a.taskId === message.task_id)?.[0];
      return id && message.patch.is_backgrounded !== undefined ? [subagent(id, 'progress', { isBackground: message.patch.is_backgrounded })] : [];
    }
    if (message.subtype !== 'task_started' && message.subtype !== 'task_progress' && message.subtype !== 'task_notification') return [];
    if (tasks.has(message.task_id) || (message.subtype === 'task_started' && message.task_type !== 'local_agent')) return mapBackgroundTask(message);
    const id = message.tool_use_id;
    const agent = id && agents.get(id);
    if (!id || !agent) return [];
    if (message.subtype === 'task_started') {
      agent.taskId = message.task_id;
      return [subagent(id, 'progress', { ...(message.is_backgrounded !== undefined && { isBackground: message.is_backgrounded }) })];
    }
    if (message.subtype === 'task_progress') return [subagent(id, 'progress', { activity: message.summary ?? message.description, tokens: message.usage.total_tokens })];
    const status = TASK_STATUS[message.status];
    return [subagent(id, 'end', { status, ...(message.summary && { result: message.summary }), ...(message.usage && { tokens: message.usage.total_tokens }) })];
  }

  /** Claude Code's status turns `compacting`, then the boundary says how big the context was and is; the summary comes from the PostCompact hook. */
  function compaction(message: SDKStatusMessage | SDKCompactBoundaryMessage): AgentEvent[] {
    if (message.subtype === 'status') {
      if (message.status === 'compacting') return [{ threadId, type: 'compaction', phase: 'start' }];
      return message.compact_result === 'failed' ? [{ threadId, type: 'compaction', phase: 'end', error: message.compact_error || 'Compaction failed' }] : [];
    }
    const { trigger, pre_tokens, post_tokens } = message.compact_metadata;
    if (post_tokens !== undefined) context = { ...context, used: post_tokens };
    return [{ threadId, type: 'compaction', phase: 'end', trigger, preTokens: pre_tokens, ...(post_tokens !== undefined && { postTokens: post_tokens }) }];
  }

  function usage(modelUsage: Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; contextWindow: number }>, costUsd: number): AgentEvent {
    // modelUsage and total_cost_usd are running totals per query(); the store adds what it gets, so send the change since the last result.
    const models = Object.values(modelUsage);
    const input = sum(models.map((m) => m.inputTokens + m.cacheReadInputTokens + m.cacheCreationInputTokens));
    const output = sum(models.map((m) => m.outputTokens));
    const cached = sum(models.map((m) => m.cacheReadInputTokens));
    const event: AgentEvent = { threadId, type: 'usage', inputTokens: input - reported.input, outputTokens: output - reported.output, cachedTokens: cached - reported.cached, costUsd: costUsd - reported.costUsd };
    Object.assign(reported, { input, output, cached, costUsd });
    context = { ...context, max: Math.max(...models.map((m) => m.contextWindow), context.max) };
    return context.used ? { ...event, contextUsed: context.used, contextMax: context.max || undefined } : event;
  }

  function map(message: SDKMessage): AgentEvent[] {
    if ('parent_tool_use_id' in message && message.parent_tool_use_id) return mapSubagent(message.parent_tool_use_id, message);
    switch (message.type) {
      case 'system':
        if (message.subtype.startsWith('task_')) return mapTask(message);
        if (message.subtype === 'init') {
          servers = (message.mcp_servers ?? []).map((s) => s.name);
          skills = message.skills ?? [];
          return [{ threadId, type: 'session', provider: 'claude', sessionId: message.session_id }, { threadId, type: 'info', info: { ...infoFromInit(message), ...(effort && { effort }) } }, ...typedSkills()];
        }
        if (message.subtype === 'commands_changed') return [{ threadId, type: 'info', info: { slashCommands: message.commands.map((c) => c.name), commands: commandsFrom(message.commands) } }];
        if (message.subtype === 'status' || message.subtype === 'compact_boundary') return compaction(message);
        return [];
      case 'stream_event': {
        const event = message.event;
        if (event.type === 'content_block_start') isNewBlock = event.content_block.type === 'text';
        if (event.type !== 'content_block_delta' || event.delta.type !== 'text_delta') return [];
        const isDelta = !isNewBlock;
        isNewBlock = false;
        return [{ threadId, type: 'message', text: event.delta.text, isDelta }];
      }
      case 'assistant': {
        const { usage: u } = message.message;
        const used = u ? u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) : context.used;
        // The meter moves with each API call, not only at the turn's result; tokens and cost still wait for the result's totals.
        const meter: AgentEvent[] = used && used !== context.used ? [{ threadId, type: 'usage', inputTokens: 0, outputTokens: 0, contextUsed: used, contextMax: context.max || undefined }] : [];
        context = { ...context, used };
        // Text already arrived as stream_event deltas (includePartialMessages), so only thinking and tool calls are read here.
        return [...meter, ...message.message.content.flatMap((block): AgentEvent[] => {
          if (block.type === 'thinking' && block.thinking) return [{ threadId, type: 'reasoning', text: block.thinking }];
          if (block.type === 'tool_use') return toolStart(block.id, block.name, block.input as Record<string, unknown>);
          return [];
        })];
      }
      case 'user': {
        const { content } = message.message;
        if (typeof content === 'string') return [];
        return content.flatMap((block) => (block.type === 'tool_result' ? toolEnd(block as ToolResultBlock, message.tool_use_result) : []));
      }
      case 'rate_limit_event':
        return limitEvents(message.rate_limit_info);
      case 'result': {
        const status = isInterrupting ? 'interrupted' : message.subtype === 'success' ? 'done' : 'failed';
        isInterrupting = false;
        const error = message.subtype === 'success' ? undefined : message.errors.join('\n') || message.subtype;
        return [usage(message.modelUsage, message.total_cost_usd), { threadId, type: 'turn-end', status, ...(status === 'failed' && { error }) }];
      }
      default:
        return [];
    }
  }

  /**
   * Relays Claude Code's own limit states. `rejected` without extra usage: it holds the turn and continues at the reset (T3 Code's
   * adapter and docs say so; not verified here). With extra usage allowed or in use it keeps running, billed. Warnings and the
   * switch to extra usage are lines in the transcript, once per window and reset.
   */
  function limitEvents(info: SDKRateLimitInfo): AgentEvent[] {
    const type = info.rateLimitType ?? 'unknown';
    const window = claudeEventWindow(info);
    const name = window ? `${window.label.toLowerCase()} ` : '';
    const isOverage = info.overageStatus === 'allowed' || info.overageStatus === 'allowed_warning' || !!info.isUsingOverage || !!info.overageInUse;
    const once = (key: string, event: AgentEvent): AgentEvent[] => (told.has(`${key}:${type}:${info.resetsAt}`) ? [] : (told.add(`${key}:${type}:${info.resetsAt}`), [event]));
    if (info.status === 'rejected' && !isOverage) {
      if (blocked.has(type)) return [];
      blocked.add(type);
      return [{ threadId, type: 'limit', isTurnHeld: true, ...(info.resetsAt !== undefined && { resetsAt: resetTime(info.resetsAt) }), ...(window && { label: window.label }) }];
    }
    const cleared: AgentEvent[] = blocked.delete(type) && !blocked.size ? [{ threadId, type: 'limit-cleared' }] : [];
    if (info.status === 'rejected') return [...cleared, ...once('overage', { threadId, type: 'limit-notice', text: `Claude is past its ${name}limit and using extra usage, billed per use` })];
    if (info.status === 'allowed_warning' && window) return [...cleared, ...once('warning', { threadId, type: 'limit-notice', text: `Claude's ${name}limit is ${Math.round(window.usedPct)}% used` })];
    return cleared;
  }

  const isUnread = (name?: string) => !!name?.startsWith('mcp__') && ![...read].some((p) => name.startsWith(p));

  return {
    map,
    /** A message handed to Claude Code: a leading `/skill` is a skill load, reported once init has listed the skills. */
    sent(text: string): AgentEvent[] {
      const name = /^\/(\S+)/.exec(text)?.[1];
      if (name) typed.push(name);
      return typedSkills();
    },
    /** The task id `query.stopTask` takes: a subagent's once Claude Code has registered it (by its Agent call's id), a shell's own. */
    taskOf: (id: string) => agents.get(id)?.taskId ?? (tasks.has(id) ? id : undefined),
    /** `message` ends a call to an MCP server whose tools haven't been read yet: `learnWidgets` must run before it's mapped. */
    needsWidgets(message: SDKMessage) {
      if (message.type !== 'user' || typeof message.message.content === 'string') return false;
      return message.message.content.some((b) => b.type === 'tool_result' && isUnread(tools.get(b.tool_use_id)?.name));
    },
    /** Records which tools declare an MCP App view. Servers still connecting are read again on their next call. */
    learnWidgets(list: McpServerStatus[]) {
      for (const s of list) {
        if (s.status !== 'connected') continue;
        const prefix = `mcp__${mcpToolPrefix(s.name)}__`;
        read.add(prefix);
        for (const t of s.tools ?? []) {
          const uri = getToolUiResourceUri({ _meta: t._meta });
          if (uri) widgets.set(prefix + t.name, { server: s.name, uri });
        }
      }
    },
    markInterrupting() {
      isInterrupting = true;
    },
  };
}

export function approvalEvent(threadId: string, requestId: string, toolName: string, input: Record<string, unknown>, title: string, detail: string): AgentEvent {
  if (toolName === 'AskUserQuestion') {
    const questions = (input.questions ?? []) as { question: string; options: { label: string }[]; multiSelect?: boolean }[];
    return { threadId, type: 'question', requestId, questions: questions.map((q) => ({ text: q.question, options: q.options.map((o) => o.label), multiSelect: !!q.multiSelect })) };
  }
  if (toolName === 'Bash') return { threadId, type: 'approval', requestId, kind: 'command', title, detail, code: String(input.command ?? '') };
  const file = input.file_path ?? input.notebook_path;
  if (typeof file === 'string') return { threadId, type: 'approval', requestId, kind: 'edit', title, detail, code: file };
  const sentence = describeApproval(toolName, input);
  if (sentence) return { threadId, type: 'approval', requestId, kind: 'tool', title: sentence.charAt(0).toUpperCase() + sentence.slice(1), detail };
  return { threadId, type: 'approval', requestId, kind: 'tool', title, detail, code: JSON.stringify(input, null, 2).slice(0, 2000) };
}

export function permissionResult(toolName: string, input: Record<string, unknown>, decision: AgentDecision): PermissionResult {
  if (decision.kind === 'deny') return { behavior: 'deny', message: decision.message ?? 'The user declined this.' };
  if (decision.kind !== 'answer' || toolName !== 'AskUserQuestion') return { behavior: 'allow', updatedInput: input };
  const questions = (input.questions ?? []) as { question: string }[];
  // The SDK types each answer as one string; the CLI itself joins multiple picks with ", ".
  const answers = Object.fromEntries(questions.flatMap((q, i) => (decision.answers[i]?.length ? [[q.question, decision.answers[i].join(', ')]] : [])));
  return { behavior: 'allow', updatedInput: { ...input, answers } };
}

export function infoFromInit(init: SDKSystemMessage): AgentInfo {
  const tools = init.tools ?? [];
  return {
    model: init.model,
    cwd: init.cwd,
    permissionMode: init.permissionMode,
    version: init.claude_code_version,
    tools: tools.filter((t) => !t.startsWith('mcp__')),
    mcpServers: (init.mcp_servers ?? []).map((s) => ({ name: s.name, status: mcpStatus(s.status), toolCount: tools.filter((t) => t.startsWith(`mcp__${mcpToolPrefix(s.name)}__`)).length })),
    skills: init.skills ?? [],
    plugins: (init.plugins ?? []).map((p) => ({ name: p.name, ...(p.version && { version: p.version }) })),
    slashCommands: init.slash_commands ?? [],
  };
}

/** `supportedCommands()` and `commands_changed`: the skills and custom, plugin and MCP commands, not Claude Code's own. */
export function commandsFrom(list: SlashCommand[]): AgentCommand[] {
  return list.filter((c) => !c.builtin).map((c) => ({ name: c.name, description: c.description, ...(c.argumentHint && { argumentHint: c.argumentHint }) }));
}

/** `query.mcpServerStatus()` after a turn: init reports servers still connecting as pending. */
export function mcpServersFromStatus(list: McpServerStatus[]): McpServer[] {
  return list.map((s) => ({ name: s.name, status: mcpStatus(s.status), ...(s.tools && { toolCount: s.tools.length }), ...(isRemote(s.config) && { url: s.config.url }) }));
}

// GAP: claude.ai connectors ('claudeai-proxy') carry Anthropic's proxy URL, not the service's, so they keep the plain glyph.
const isRemote = (config: McpServerStatus['config']): config is { type: 'http' | 'sse'; url: string } => (config?.type === 'http' || config?.type === 'sse') && typeof config.url === 'string';

const MCP_STATUSES = new Set<string>(['connected', 'pending', 'needs-auth', 'failed', 'disabled'] satisfies McpServer['status'][]);
const mcpStatus = (status: string) => (MCP_STATUSES.has(status) ? status : 'failed') as McpServer['status'];
// Claude Code names an MCP tool `mcp__<server>__<tool>`, with characters outside [A-Za-z0-9_-] in the server name replaced by `_`.
const mcpToolPrefix = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, '_');

type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; is_error?: boolean; content?: string | { type: string; text?: string; source?: { type: string; media_type?: string; data?: string } }[] };

/** What an MCP App view gets of a call's result: its text blocks, and `structuredContent` from `tool_use_result` (an MCP tool's raw result in 2.1.296). */
function widgetResult(block: ToolResultBlock, result: unknown): McpWidgetResult {
  const content = typeof block.content === 'string' ? [{ type: 'text' as const, text: block.content }] : (block.content ?? []).flatMap((c) => (c.type === 'text' && typeof c.text === 'string' ? [{ type: 'text' as const, text: c.text }] : []));
  const structured = (result as { structuredContent?: unknown } | undefined)?.structuredContent;
  return structured && typeof structured === 'object' ? { content, structuredContent: structured as Record<string, unknown> } : { content };
}

/** The base64 image blocks in a tool's result (a screenshot); URL-sourced ones aren't Claude Code's to return. */
function imageBlocks(block: ToolResultBlock) {
  if (typeof block.content === 'string') return [];
  return (block.content ?? []).flatMap((c) => (c.type === 'image' && c.source?.type === 'base64' && c.source.media_type && c.source.data ? [{ media_type: c.source.media_type, data: c.source.data }] : []));
}

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
// `Task` is the Agent tool's name in Claude Code before 2.1.
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const TASK_STATUS = { completed: 'done', failed: 'failed', stopped: 'stopped' } as const;
// ponytail: task types other than these two (monitors, backgrounded MCP calls) all read as a monitor; name them once a run shows their task_type.
const TASK_KINDS: Record<string, BackgroundTaskKind> = { local_bash: 'shell', local_workflow: 'workflow' };

const taskStart = (task: (fields: Omit<AgentTaskEvent, 'threadId' | 'type' | 'id'>) => AgentTaskEvent, { kind, title, command }: { kind: BackgroundTaskKind; title: string; command?: string }) =>
  task({ phase: 'start', kind, title, ...(command && { command }) });

/** Mochi's update_plan is the plan; Claude Code's own task list would be a second one nobody sees. */
export const HIDDEN_PLAN_TOOLS = ['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TodoWrite'];

/**
 * One line for the work log: the command for Bash, the path for file tools (relative to `cwd` when inside it), the tool name otherwise.
 * Tools the work log knows get its verb ("Run pnpm test", "Skill ui", "Mcp linear: list_issues").
 */
export function describeTool(name: string, input: Record<string, unknown>, servers: string[] = [], cwd?: string) {
  const kind = toolKind(name, input, servers);
  if (kind.skill) return `Skill ${kind.skill}`;
  if (kind.mcp) return `Mcp ${kind.mcp.server}: ${kind.mcp.tool}`;
  const file = input.file_path ?? input.notebook_path;
  const inside = typeof file === 'string' && cwd ? posixPath(path.relative(cwd, path.resolve(cwd, file))) : undefined;
  const target = input.command ?? (inside && !inside.startsWith('..') ? inside : file) ?? input.pattern ?? input.url ?? input.query ?? input.subject ?? input.description;
  if (typeof target !== 'string') return name;
  const verb = VERBS[name as keyof typeof VERBS];
  return verb ? `${verb} ${target}` : `${name}: ${target.split('\n')[0].slice(0, 200)}`;
}

/** A Bash call's command, for main to describe when Claude sent no `description` (the field is optional). */
function commandOf(name: string, input: Record<string, unknown>) {
  return name === 'Bash' && typeof input.command === 'string' ? { command: input.command } : {};
}

/** The plain-language line a work-group row shows: Bash's own `description`; Grep and Glob in words. Other tools read fine from their verb and target. */
export function callDescription(name: string, input: Record<string, unknown>) {
  const where = typeof input.path === 'string' ? ` in ${input.path.split('/').pop()}` : '';
  if (name === 'Bash' && typeof input.description === 'string' && input.description.trim()) return input.description.trim();
  if (name === 'Grep' && typeof input.pattern === 'string') return `Searched for “${input.pattern}”${where}`;
  if (name === 'Glob' && typeof input.pattern === 'string') return `Found files matching ${input.pattern}${where}`;
  return undefined;
}

const OUTPUT_MAX = 4000;

/** The end of a command's output: where the result or the error is, and capped so a chatty command can't bloat the saved thread. */
function tail(text: string) {
  return text.length > OUTPUT_MAX ? `…${text.slice(-OUTPUT_MAX)}` : text;
}

/** An Edit/Write result's `structuredPatch` as a unified diff `@pierre/diffs` can render. A created file comes with no hunks, so its whole `content` is the one hunk. */
export function patchOf(input: Record<string, unknown>, result: unknown) {
  const output = result as { type?: string; content?: unknown; structuredPatch?: { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }[] } | undefined;
  const file = input.file_path ?? input.notebook_path;
  if (typeof file !== 'string') return undefined;
  const name = path.basename(file);
  const hunks = output?.type === 'create' && !output.structuredPatch?.length && typeof output.content === 'string' ? createdHunks(output.content) : output?.structuredPatch;
  if (!Array.isArray(hunks) || !hunks.length) return undefined;
  const old = output?.type === 'create' ? '/dev/null' : `a/${name}`;
  return [`diff --git a/${name} b/${name}`, `--- ${old}`, `+++ b/${name}`, ...hunks.flatMap((h) => [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines])].join('\n');
}

function createdHunks(content: string) {
  if (!content) return [];
  const lines = content.replace(/\n$/, '').split('\n');
  return [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length, lines: lines.map((l) => `+${l}`) }];
}

/** The skill a Skill call loads (its `skill` input, a leading `/` allowed) or the MCP server and tool an `mcp__` call runs. */
export function toolKind(name: string, input: Record<string, unknown>, servers: string[] = []): { skill?: string; mcp?: McpCall } {
  if (name === 'Skill' && typeof input.skill === 'string' && input.skill.trim()) return { skill: input.skill.trim().replace(/^\//, '') };
  if (!name.startsWith('mcp__')) return {};
  const rest = name.slice('mcp__'.length);
  // Longest first: a server whose name runs into another's (`git`, `github`) matches by its own full prefix.
  const server = [...servers].sort((a, b) => b.length - a.length).find((s) => rest.startsWith(`${mcpToolPrefix(s)}__`));
  const account = typeof input[ACCOUNT_ARGUMENT] === 'string' ? { account: input[ACCOUNT_ARGUMENT] } : {};
  if (server) return { mcp: { server, tool: rest.slice(mcpToolPrefix(server).length + 2), ...account } };
  const split = rest.indexOf('__');
  return split > 0 ? { mcp: { server: rest.slice(0, split), tool: rest.slice(split + 2), ...account } } : {};
}

/** Mochi's `generate_image`, shown as the same image card a Codex image gets rather than an MCP row. */
const IMAGE_CALL = `mcp__${MOCHI_SERVER}__${IMAGE_TOOL}`;

const VERBS = { Bash: 'Run', Read: 'Read', Edit: 'Edit', MultiEdit: 'Edit', Write: 'Write', NotebookEdit: 'Edit', WebSearch: 'Search', WebFetch: 'Fetch' } as const;

/** WebSearch's hits (`WebSearchOutput.results`: hit groups mixed with the model's commentary strings) or the page WebFetch read. */
export function webLinks(name: string, input: Record<string, unknown>, result: unknown): WebLink[] | undefined {
  const output = (result ?? {}) as Partial<WebSearchOutput & WebFetchOutput>;
  if (name === 'WebFetch') {
    const url = typeof output.url === 'string' ? output.url : input.url;
    return typeof url === 'string' ? [{ url }] : undefined;
  }
  if (name !== 'WebSearch' || !Array.isArray(output.results)) return;
  const hits = output.results.flatMap((r) => (typeof r === 'object' && Array.isArray(r?.content) ? r.content : []));
  return hits.filter((h) => typeof h?.url === 'string').map((h) => ({ url: h.url, ...(typeof h.title === 'string' && h.title && { title: h.title }) }));
}

function resultText(block: ToolResultBlock) {
  return typeof block.content === 'string' ? block.content : (block.content ?? []).map((c) => c.text ?? '').join('\n');
}

// BashOutput carries no exit code; Claude Code marks a failed command `is_error` and puts "Exit code N" in the result text.
function exitCode(block: ToolResultBlock) {
  if (!block.is_error) return 0;
  const match = /Exit code (\d+)/.exec(resultText(block));
  return match ? Number(match[1]) : 1;
}

// GAP: the SDK types `resetsAt` as a number without a unit; read as epoch seconds unless it is large enough to be milliseconds.
const resetTime = (value: number) => new Date(value < 1e12 ? value * 1000 : value).toISOString();

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/**
 * `supportedModels()` as the picker lists it: by the wire id each row resolves to, so an alias row (`opus`) and a saved
 * explicit id are the same model. The `default` row only marks which model is the account's default.
 */
export function claudeModels(infos: ModelInfo[]): AgentModel[] {
  const idOf = (m: ModelInfo) => m.resolvedModel ?? m.value;
  const defaultRow = infos.find((m) => m.value === 'default');
  const rows = infos.filter((m) => m !== defaultRow);
  const defaultId = defaultRow ? idOf(defaultRow) : rows[0] && idOf(rows[0]);
  const models = new Map<string, AgentModel>();
  for (const m of rows) if (!models.has(idOf(m))) models.set(idOf(m), { id: idOf(m), name: m.displayName, description: m.description, efforts: m.supportedEffortLevels ?? [], speeds: m.supportsFastMode ? [claudeFast(idOf(m))] : [], isDefault: idOf(m) === defaultId });
  return [...models.values()];
}

/**
 * The modes a thread may start in, with the tools each pre-approves. Claude Code asks before WebSearch and WebFetch in
 * every mode short of bypass (acceptEdits only covers file edits), so a search in Auto stopped the turn for approval.
 */
export const PERMISSION_MODES = {
  default: ['WebSearch'],
  acceptEdits: ['WebSearch', 'WebFetch'],
  auto: ['WebSearch', 'WebFetch'],
  plan: ['WebSearch'],
  dontAsk: [],
  bypassPermissions: [],
} satisfies Record<PermissionMode, string[]>;

/** The `query()` options for a mode; the caller adds its own `allowedTools` (Mochi's) to these. */
export function permissionOptions(mode: PermissionMode) {
  // The SDK refuses bypassPermissions without this opt-in; Full access is the user's explicit, confirmed choice in the composer.
  return { permissionMode: mode, allowDangerouslySkipPermissions: mode === 'bypassPermissions', allowedTools: PERMISSION_MODES[mode] };
}

/** A message for Claude Code: image blocks ahead of the text, or the text alone. */
export function userContent(text: string, images?: AgentImage[]): SDKUserMessage['message']['content'] {
  if (!images?.length) return text;
  return [...images.map((i) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: i.mediaType, data: i.data } })), { type: 'text' as const, text }];
}
