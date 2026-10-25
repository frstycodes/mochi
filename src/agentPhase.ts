import type { AgentPhase } from './agentShape.ts';
import {
  isWorking,
  type ActivityEntry,
  type Thread,
  type WebLink,
} from './model.ts';
import { namesNow } from './library/names.ts';
import { HARNESSES } from './settings/harnesses.ts';
import {
  parseTool,
  toolVerb,
  type ToolCall,
  type ToolVerb,
} from './summary.ts';
import { isTurnCall, mochiCall } from './chat/mochiCalls.ts';
import { isSendTarget } from './chat/threadMessages.ts';

const VERB_PHASE = {
  Read: 'read',
  Edit: 'edit',
  Write: 'edit',
  Run: 'run',
  Browser: 'browse',
  Search: 'browse',
  Fetch: 'browse',
  Skill: 'read',
  Mcp: 'run',
} satisfies Record<ToolVerb, AgentPhase>;

export const PHASE_LABELS = {
  idle: 'Idle',
  start: 'Starting',
  think: 'Thinking',
  read: 'Reading',
  edit: 'Editing',
  run: 'Running',
  browse: 'Browsing',
  wait: 'Waiting on you',
} satisfies Record<AgentPhase, string>;

/** What the agent is doing right now, read from its latest activity. */
export function agentPhase(thread: Thread): AgentPhase {
  if (thread.status === 'needs-you') return 'wait';
  if (!isWorking(thread)) return 'idle';
  const pending = pendingWork(thread);
  if (pending) return pending.phase;
  const last = [...thread.activity]
    .reverse()
    .find((e) => e.kind === 'tool' || e.kind === 'reasoning');
  return entryPhase(last);
}

export function entryPhase(entry?: ActivityEntry): AgentPhase {
  if (!entry || entry.kind === 'reasoning') return 'think';
  return toolPhase(entry.text);
}

/** The pose for a tool call's text ("Run pnpm test" → run). */
export const toolPhase = (text: string): AgentPhase =>
  VERB_PHASE[toolVerb(text)];

export { isWorking } from './model.ts';

export const SETUP_LABEL = 'Setting up worktree…';

/** Between your message and the agent's first output, which would otherwise show nothing: what it's waiting on. */
export function pendingWork(
  thread: Thread,
): { phase: AgentPhase; label: string } | undefined {
  if (!thread.live?.isWorking || thread.status === 'needs-you') return;
  if (thread.setup?.status === 'running')
    return { phase: 'start', label: SETUP_LABEL };
  const last = [...thread.activity].reverse().find((e) => e.kind !== 'event');
  if (last?.who !== 'you') return;
  if (thread.live.starting)
    return {
      phase: 'start',
      label: `Starting ${HARNESSES[thread.live.starting].name}`,
    };
  return { phase: 'think', label: PHASE_LABELS.think };
}

/** What a working thread is doing, for a row or card ("Editing index.ts", "Running pnpm test", "Thinking", "Starting Claude Code"); nothing when it isn't working. */
export function workingLabel(thread: Thread): string | undefined {
  return currentAction(thread)?.label;
}

export interface CurrentAction {
  label: string;
  /** The tool call the label names, for its icon or favicons. */
  call?: ToolCall;
  links?: WebLink[];
  /** Paused on your approval or answer rather than working. */
  isWaiting?: boolean;
}

/** The working thread's current action in plain words, plus the call behind it. */
export function currentAction(thread: Thread): CurrentAction | undefined {
  const isWaiting = thread.status === 'needs-you';
  if (!isWorking(thread) && !isWaiting) return;
  if (thread.setup?.status === 'failed' && isWaiting)
    return { label: 'Worktree setup failed', isWaiting };
  const pending = pendingWork(thread);
  if (pending) return { label: pending.label };
  const last = thread.activity.findLast(
    (e) =>
      (e.kind === 'tool' && !isTurnCall(e)) ||
      e.kind === 'reasoning' ||
      e.kind === 'message' ||
      (isWaiting && isWaitEvent(e)),
  );
  const tool = thread.activity.findLast(
    (e) => e.kind === 'tool' && !isTurnCall(e),
  );
  if (last && isWaitEvent(last)) {
    const call = tool && parseTool(tool.text);
    return {
      label: call ? waitingLabel(call) : PHASE_LABELS.wait,
      call,
      links: tool?.links,
      isWaiting: true,
    };
  }
  // Waiting on something other than an approval (a failed turn, a review): the turn isn't live.
  if (!isWorking(thread)) return;
  if (last?.kind === 'tool') {
    const call = parseTool(last.text);
    return {
      label: (isCommand(last.text) && last.description) || toolLabel(call),
      call,
      links: last.links,
    };
  }
  if (last?.kind === 'message' && last.who !== 'you')
    return { label: 'Replying' };
  return { label: PHASE_LABELS.think };
}

// Only a command's description reads as an action in progress; Grep's and Glob's are past tense. `Run` is also the
// verb of any tool the work log doesn't know, which logs as `Name: target`.
const isCommand = (text: string) =>
  toolVerb(text) === 'Run' && !/^\w+: /.test(text);

const isWaitEvent = (e: ActivityEntry) =>
  e.kind === 'event' && e.text.startsWith('Waiting on you:');

// Claude's AskUserQuestion has no target, so its call reads as a bare tool name.
function waitingLabel(call: ToolCall) {
  if (call.target === 'AskUserQuestion') return 'Waiting for your answer';
  const name = call.target.split('/').pop();
  const action = {
    Read: `read ${name}`,
    Edit: `edit ${name}`,
    Write: `create ${name}`,
    Run: `run ${call.target.split('\n')[0]}`,
    Browser: 'use the browser',
    Search: 'search the web',
    Fetch: `read ${hostname(call.target)}`,
    Skill: `use the ${namesNow().skill(call.target).title} skill`,
    Mcp: `call ${mcpLabel(call.target)}`,
  }[call.verb];
  return `Waiting for your approval to ${action}`;
}

/** One line: a multi-line command keeps its first line and an ellipsis; the width is left to CSS truncation. */
export function toolLabel(call: ToolCall) {
  const name = call.target.split('/').pop();
  const [command, ...more] = call.target.split('\n');
  return {
    Read: `Reading ${name}`,
    Edit: `Editing ${name}`,
    Write: `Writing ${name}`,
    Run: `Running ${command}${more.length ? '…' : ''}`,
    Browser: 'Using the browser',
    Search: `Searching ${call.target}`,
    Fetch: `Reading ${hostname(call.target)}`,
    Skill: `Using the ${namesNow().skill(call.target).title} skill`,
    Mcp: isSendTarget(call)
      ? 'Messaging another thread'
      : (mochiCall(call)?.[0] ?? `Calling ${mcpLabel(call.target)}`),
  }[call.verb];
}

/** `linear: get_issue` → `get issue on Linear`. */
const mcpLabel = (target: string) => {
  const [server, tool] = target.split(': ');
  return tool ? namesNow().call(server, tool) : namesNow().server(server).title;
};

export function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
