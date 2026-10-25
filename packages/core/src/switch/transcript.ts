import { COMMAND_TYPE, type LoggedEvent } from '@mochi/domain';
import type { AgentEvent } from '../../../../apps/desktop/src/host/types/agent.ts';
import type { Action } from '../../../../apps/desktop/src/store/types.ts';

/** One readable thing that happened in a thread, at the log `seq` it began: a message, a tool call with its result, a plan. */
export interface TranscriptItem {
  readonly seq: number;
  readonly kind:
    | 'you'
    | 'agent'
    | 'tool'
    | 'plan'
    | 'compaction'
    | 'switch'
    | 'turn';
  readonly text: string;
  /** A tool's output or patch; a compaction's summary. */
  readonly detail?: string;
  readonly toolCallId?: string;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * A thread's log events as its transcript, oldest first: streamed reply chunks joined into their message, a tool's start and end
 * into one call. Reasoning, usage and bookkeeping events are left out.
 */
export function transcriptOf(
  events: ReadonlyArray<LoggedEvent>,
): TranscriptItem[] {
  const items: Mutable<TranscriptItem>[] = [];
  const tools = new Map<string, Mutable<TranscriptItem>>();
  for (const event of events) {
    const seq = event.sequence;
    const agent = event.payload as AgentEvent;
    if (event.type === COMMAND_TYPE)
      push(items, yourItem(seq, event.payload as Action));
    else if (!event.type.startsWith('agent.')) continue;
    else if (agent.type === 'message') foldMessage(items, seq, agent);
    else if (agent.type === 'tool') foldTool(items, tools, seq, agent);
    else push(items, eventItem(seq, agent));
  }
  return items;
}

const push = (items: TranscriptItem[], item: TranscriptItem | null) =>
  void (item && items.push(item));

/** A delta continues the agent's latest message; anything else starts one. */
function foldMessage(
  items: Mutable<TranscriptItem>[],
  seq: number,
  message: Extract<AgentEvent, { type: 'message' }>,
) {
  const last = items.findLast((i) => i.kind === 'agent');
  if (message.isDelta && last) last.text += message.text;
  else items.push({ seq, kind: 'agent', text: message.text });
}

/** A call's start opens its item; its end adds the files, exit code, patch and output. An end with no start opens one too. */
function foldTool(
  items: Mutable<TranscriptItem>[],
  tools: Map<string, Mutable<TranscriptItem>>,
  seq: number,
  tool: Extract<AgentEvent, { type: 'tool' }>,
) {
  let item = tools.get(tool.id);
  if (tool.phase === 'start' || !item) {
    item = {
      seq,
      kind: 'tool',
      text: tool.description ?? tool.command ?? tool.text,
      toolCallId: tool.id,
    };
    tools.set(tool.id, item);
    items.push(item);
  }
  if (tool.phase !== 'end') return;
  const detail = [
    tool.files?.length && `files: ${tool.files.join(', ')}`,
    tool.exitCode !== undefined && `exit ${tool.exitCode}`,
    tool.patch,
    tool.output,
  ].filter(Boolean);
  if (detail.length) item.detail = detail.join('\n');
}

function eventItem(seq: number, event: AgentEvent): TranscriptItem | null {
  switch (event.type) {
    case 'plan':
      return {
        seq,
        kind: 'plan',
        text: event.items.map((i) => `[${i.status}] ${i.title}`).join('\n'),
      };
    case 'compaction':
      return event.phase === 'summary' && event.summary
        ? {
            seq,
            kind: 'compaction',
            text: 'The agent compacted its context',
            detail: event.summary,
          }
        : null;
    case 'context':
      return {
        seq,
        kind: 'switch',
        text: `Switched from ${event.from} to ${event.to}${event.model ? ` (${event.model})` : ''}`,
      };
    case 'turn-end':
      return event.status === 'done'
        ? null
        : {
            seq,
            kind: 'turn',
            text: `Turn ${event.status}${event.error ? `: ${event.error}` : ''}`,
          };
    default:
      return null;
  }
}

/** What you said: a new thread's first prompt, then each message as the agent got it. */
function yourItem(seq: number, action: Action): TranscriptItem | null {
  if (action.type === 'create' && action.prompt)
    return { seq, kind: 'you', text: action.prompt };
  if (action.type === 'send')
    return { seq, kind: 'you', text: action.prompt ?? action.text };
  return null;
}

/** One item as plain text: the line, then its detail cut to `maxDetail` characters with a pointer to the rest. */
export function itemText(item: TranscriptItem, maxDetail = Infinity) {
  const head = `[${item.seq}] ${LABEL[item.kind]}: ${item.text}`;
  if (!item.detail) return head;
  return `${head}\n${cut(item.detail, maxDetail, item)}`;
}

const LABEL = {
  you: 'User',
  agent: 'Agent',
  tool: 'Tool',
  plan: 'Plan',
  compaction: 'Compaction',
  switch: 'Switch',
  turn: 'Turn',
} satisfies Record<TranscriptItem['kind'], string>;

/** Head and tail kept, the middle replaced with the `thread_history` call that returns it whole. */
function cut(text: string, max: number, item: TranscriptItem) {
  if (text.length <= max) return text;
  const half = Math.max(0, Math.floor((max - 80) / 2));
  const dropped = text.slice(half, text.length - half);
  const lines = dropped.split('\n').length;
  return `${text.slice(0, half)}\n[… ${lines.toLocaleString('en-US')} lines, thread_history get seq=${item.seq}]\n${text.slice(text.length - half)}`;
}
