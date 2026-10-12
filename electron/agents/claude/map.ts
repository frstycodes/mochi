import path from 'node:path';
import type { PermissionResult, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentDecision, AgentEvent, AgentPlanItem } from '../../../src/host/types/agent.ts';

/** Turns one thread's Claude Agent SDK stream into `AgentEvent`s. Stateful: tool inputs, tasks and usage totals carry across messages. */
export function createMapper(threadId: string, cwd: string) {
  const tools = new Map<string, { name: string; input: Record<string, unknown> }>();
  const tasks: { id: string; title: string; status: AgentPlanItem['status'] }[] = [];
  const reported = { input: 0, output: 0, costUsd: 0 };
  let context = { used: 0, max: 0 };
  let isNewBlock = false;
  let isInterrupting = false;

  const planFromTasks = (): AgentEvent => ({ threadId, type: 'plan', items: tasks.map(({ title, status }) => ({ title, status })) });

  function toolStart(id: string, name: string, input: Record<string, unknown>): AgentEvent[] {
    tools.set(id, { name, input });
    const start: AgentEvent = { threadId, type: 'tool', id, phase: 'start', text: describeTool(name, input) };
    if (name === 'TodoWrite') return [start, { threadId, type: 'plan', items: planFromTodos(input) }];
    if (name !== 'TaskUpdate') return [start];
    const task = tasks.find((t) => t.id === input.taskId);
    if (!task) return [start];
    if (input.status === 'deleted') tasks.splice(tasks.indexOf(task), 1);
    else if (typeof input.status === 'string') task.status = STATUS[input.status as keyof typeof STATUS] ?? task.status;
    if (typeof input.subject === 'string') task.title = input.subject;
    return [start, planFromTasks()];
  }

  function toolEnd(block: ToolResultBlock, result: unknown): AgentEvent[] {
    const tool = tools.get(block.tool_use_id);
    if (!tool) return [];
    tools.delete(block.tool_use_id);
    const end: AgentEvent = { threadId, type: 'tool', id: block.tool_use_id, phase: 'end', text: describeTool(tool.name, tool.input) };
    const file = tool.input.file_path ?? tool.input.notebook_path;
    if (typeof file === 'string' && EDIT_TOOLS.has(tool.name) && !block.is_error) end.files = [path.relative(cwd, path.resolve(cwd, file))];
    if (tool.name === 'Bash') end.exitCode = exitCode(block);
    const task = (result as { task?: { id?: unknown } } | undefined)?.task;
    if (tool.name !== 'TaskCreate' || typeof task?.id !== 'string') return [end];
    tasks.push({ id: task.id, title: String(tool.input.subject ?? ''), status: 'pending' });
    return [end, planFromTasks()];
  }

  function usage(modelUsage: Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; contextWindow: number }>, costUsd: number): AgentEvent {
    // modelUsage and total_cost_usd are running totals per query(); the store adds what it gets, so send the change since the last result.
    const models = Object.values(modelUsage);
    const input = sum(models.map((m) => m.inputTokens + m.cacheReadInputTokens + m.cacheCreationInputTokens));
    const output = sum(models.map((m) => m.outputTokens));
    const event: AgentEvent = { threadId, type: 'usage', inputTokens: input - reported.input, outputTokens: output - reported.output, costUsd: costUsd - reported.costUsd };
    Object.assign(reported, { input, output, costUsd });
    context = { ...context, max: Math.max(...models.map((m) => m.contextWindow), context.max) };
    return context.used ? { ...event, contextUsed: context.used, contextMax: context.max || undefined } : event;
  }

  function map(message: SDKMessage): AgentEvent[] {
    // ponytail: subagent traffic (parent_tool_use_id set) is skipped; the Task tool's own start/end stands in for it.
    if ('parent_tool_use_id' in message && message.parent_tool_use_id) return [];
    switch (message.type) {
      case 'system':
        return message.subtype === 'init' ? [{ threadId, type: 'session', provider: 'claude', sessionId: message.session_id }] : [];
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
        if (u) context = { ...context, used: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) };
        // Text already arrived as stream_event deltas (includePartialMessages), so only thinking and tool calls are read here.
        return message.message.content.flatMap((block): AgentEvent[] => {
          if (block.type === 'thinking' && block.thinking) return [{ threadId, type: 'reasoning', text: block.thinking }];
          if (block.type === 'tool_use') return toolStart(block.id, block.name, block.input as Record<string, unknown>);
          return [];
        });
      }
      case 'user': {
        const { content } = message.message;
        if (typeof content === 'string') return [];
        return content.flatMap((block) => (block.type === 'tool_result' ? toolEnd(block as ToolResultBlock, message.tool_use_result) : []));
      }
      case 'rate_limit_event': {
        const { status, resetsAt } = message.rate_limit_info;
        if (status !== 'rejected') return [];
        return [{ threadId, type: 'limit', ...(resetsAt !== undefined && { resetsAt: resetTime(resetsAt) }) }];
      }
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

  return {
    map,
    markInterrupting() {
      isInterrupting = true;
    },
  };
}

export function approvalEvent(threadId: string, requestId: string, toolName: string, input: Record<string, unknown>, title: string, detail: string): AgentEvent {
  if (toolName === 'AskUserQuestion') {
    const questions = (input.questions ?? []) as { question: string; options: { label: string }[] }[];
    return { threadId, type: 'question', requestId, questions: questions.map((q) => ({ text: q.question, options: q.options.map((o) => o.label) })) };
  }
  if (toolName === 'Bash') return { threadId, type: 'approval', requestId, kind: 'command', title, detail, code: String(input.command ?? '') };
  const file = input.file_path ?? input.notebook_path;
  if (typeof file === 'string') return { threadId, type: 'approval', requestId, kind: 'edit', title, detail, code: file };
  return { threadId, type: 'approval', requestId, kind: 'tool', title, detail, code: JSON.stringify(input, null, 2).slice(0, 2000) };
}

export function permissionResult(toolName: string, input: Record<string, unknown>, decision: AgentDecision): PermissionResult {
  if (decision.kind === 'deny') return { behavior: 'deny', message: decision.message ?? 'The user declined this.' };
  if (decision.kind !== 'answer' || toolName !== 'AskUserQuestion') return { behavior: 'allow', updatedInput: input };
  const questions = (input.questions ?? []) as { question: string }[];
  const answers = Object.fromEntries(questions.flatMap((q, i) => (decision.answers[i] === undefined ? [] : [[q.question, decision.answers[i]]])));
  return { behavior: 'allow', updatedInput: { ...input, answers } };
}

type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; is_error?: boolean; content?: string | { type: string; text?: string }[] };

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const STATUS = { pending: 'pending', in_progress: 'running', completed: 'done' } as const;

export function planFromTodos(input: Record<string, unknown>): AgentPlanItem[] {
  const todos = Array.isArray(input.todos) ? (input.todos as { content?: unknown; status?: unknown }[]) : [];
  return todos.flatMap((t) => (typeof t.content === 'string' ? [{ title: t.content, status: STATUS[t.status as keyof typeof STATUS] ?? 'pending' }] : []));
}

/** One line for the work log: the command for Bash, the path for file tools, the tool name otherwise. */
export function describeTool(name: string, input: Record<string, unknown>) {
  const target = input.command ?? input.file_path ?? input.notebook_path ?? input.pattern ?? input.url ?? input.query ?? input.subject ?? input.description;
  return typeof target === 'string' ? `${name}: ${target.split('\n')[0].slice(0, 200)}` : name;
}

// BashOutput carries no exit code; Claude Code marks a failed command `is_error` and puts "Exit code N" in the result text.
function exitCode(block: ToolResultBlock) {
  if (!block.is_error) return 0;
  const text = typeof block.content === 'string' ? block.content : (block.content ?? []).map((c) => c.text ?? '').join('\n');
  const match = /Exit code (\d+)/.exec(text);
  return match ? Number(match[1]) : 1;
}

// GAP: the SDK types `resetsAt` as a number without a unit; read as epoch seconds unless it is large enough to be milliseconds.
const resetTime = (value: number) => new Date(value < 1e12 ? value * 1000 : value).toISOString();

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
