import type { AgentPhase } from './agentShape.ts';
import type { ActivityEntry, Thread } from './model.ts';
import { HARNESSES } from './settings/harnesses.ts';
import { parseTool, toolVerb, type ToolCall, type ToolVerb } from './summary.ts';

const VERB_PHASE = { Read: 'read', Edit: 'edit', Write: 'edit', Run: 'run', Browser: 'browse' } satisfies Record<ToolVerb, AgentPhase>;

export const PHASE_LABELS = { idle: 'Idle', start: 'Starting', think: 'Thinking', read: 'Reading', edit: 'Editing', run: 'Running', browse: 'Browsing', wait: 'Waiting on you' } satisfies Record<AgentPhase, string>;

/** What the agent is doing right now, read from its latest activity. */
export function agentPhase(thread: Thread): AgentPhase {
  if (thread.status === 'needs-you') return 'wait';
  if (!isWorking(thread)) return 'idle';
  const pending = pendingWork(thread);
  if (pending) return pending.phase;
  const last = [...thread.activity].reverse().find((e) => e.kind === 'tool' || e.kind === 'reasoning');
  return entryPhase(last);
}

export function entryPhase(entry?: ActivityEntry): AgentPhase {
  if (!entry || entry.kind === 'reasoning') return 'think';
  return VERB_PHASE[toolVerb(entry.text)];
}

/** A live thread keeps `running` between turns; only its agent knows whether it's working. Demo threads run while their status says so. */
export function isWorking(thread: Thread) {
  return thread.live ? thread.live.isWorking : thread.status === 'running';
}

/** Between your message and the agent's first output, which would otherwise show nothing: what it's waiting on. */
export function pendingWork(thread: Thread): { phase: AgentPhase; label: string } | undefined {
  if (!thread.live?.isWorking || thread.status === 'needs-you') return;
  const last = [...thread.activity].reverse().find((e) => e.kind !== 'event');
  if (last?.who !== 'you') return;
  if (thread.live.starting) return { phase: 'start', label: `Starting ${HARNESSES[thread.live.starting].name}` };
  return { phase: 'think', label: PHASE_LABELS.think };
}

/** What a working thread is doing, for a row or card ("Editing index.ts", "Running pnpm test", "Thinking", "Starting Claude Code"); nothing when it isn't working. */
export function workingLabel(thread: Thread): string | undefined {
  if (!isWorking(thread)) return;
  const pending = pendingWork(thread);
  if (pending) return pending.label;
  const last = [...thread.activity].reverse().find((e) => e.kind === 'tool' || e.kind === 'reasoning' || e.kind === 'message');
  if (last?.kind === 'tool') return toolLabel(parseTool(last.text));
  if (last?.kind === 'message' && last.who !== 'you') return 'Replying';
  return PHASE_LABELS.think;
}

export function toolLabel(call: ToolCall) {
  const name = call.target.split('/').pop();
  return { Read: `Reading ${name}`, Edit: `Editing ${name}`, Write: `Writing ${name}`, Run: `Running ${call.target}`, Browser: 'Using the browser' }[call.verb];
}
