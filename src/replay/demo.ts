import type { AgentEvent } from '../host/types/agent.ts';
import type { ActivityEntry, Provider, Thread } from '../model.ts';
import type { Recording, ReplayStep } from './record.ts';

/**
 * A recording for a demo thread, which runs on the tick and is never recorded: its transcript replayed as the agent
 * events that would have written it (messages streamed in word chunks, tool calls started and ended, the plan advancing
 * at each step's times), with one approval you answer and one failed command it re-runs, so every marker kind shows.
 */
export function demoRecording(thread: Thread): Recording | null {
  const [first, ...rest] = thread.activity;
  if (!first) return null;
  const who = thread.providers[0];
  const steps = thread.steps.filter((s) => s.status !== 'dropped');
  const base: Thread = {
    ...thread,
    status: 'running',
    activity: [first],
    steps: steps.map((s) => ({ ...s, status: 'ready', progress: 0, startedAt: undefined, doneAt: undefined, note: undefined })),
    live: { isWorking: true },
  };

  const moments: { at: number; events: ReplayStep['action'][] }[] = [];
  const agent = (event: DistributiveOmit<AgentEvent, 'threadId'>): ReplayStep['action'] => ({ type: 'agent', event: { ...event, threadId: thread.id } as AgentEvent });
  const plan = (at: number) =>
    agent({ type: 'plan', items: steps.map((s) => ({ title: s.title, status: s.doneAt !== undefined && s.doneAt <= at ? 'done' : s.startedAt !== undefined && s.startedAt <= at ? 'running' : 'pending' })) });
  for (const at of new Set(steps.flatMap((s) => [s.startedAt, s.doneAt]).filter((t): t is number => t !== undefined))) moments.push({ at, events: [plan(at)] });

  let hasApproval = false;
  let hasFailure = false;
  rest.forEach((entry, i) => {
    const events = entryEvents(entry, who, `${thread.id}-${i}`, agent, thread.id);
    if (entry.kind === 'tool' && /^Run\b/.test(entry.text)) {
      if (!hasApproval) {
        hasApproval = true;
        events.unshift(agent({ type: 'approval', requestId: 'demo-approval', kind: 'command', title: entry.text, detail: entry.text.replace(/^Run\s+/, ''), code: entry.text.replace(/^Run\s+/, '') }), { type: 'answer', queueId: 'q-demo-approval' });
      } else if (!hasFailure) {
        hasFailure = true;
        events.unshift(agent({ type: 'tool', id: `${thread.id}-${i}-fail`, phase: 'start', text: entry.text }), agent({ type: 'tool', id: `${thread.id}-${i}-fail`, phase: 'end', text: entry.text, exitCode: 1 }));
      }
    }
    moments.push({ at: entry.at, events });
  });
  moments.push({ at: Math.max(...moments.map((m) => m.at), first.at), events: [agent({ type: 'usage', inputTokens: 48_000, outputTokens: 6_200, contextUsed: thread.context.used, contextMax: thread.context.max }), agent({ type: 'turn-end', status: 'done' })] });
  moments.sort((a, b) => a.at - b.at);

  // Seconds apart within a minute, a pause per app minute between them, so "Skip idle gaps" has gaps to skip.
  const t0 = 1_700_000_000_000;
  let t = t0;
  let previousAt = first.at;
  let k = 0;
  const out: ReplayStep[] = [];
  for (const { at, events } of moments) {
    t += Math.min(at - previousAt, 6) * 4_000;
    previousAt = at;
    for (const action of events) {
      t += action.type === 'agent' && action.event.type === 'message' && action.event.isDelta ? 90 : 400 + (k++ % 5) * 220;
      out.push({ t, now: at, action });
    }
  }
  return { base: { t: t0, now: first.at, base: { thread: base, queue: [] } }, steps: out, isCapped: false };
}

function entryEvents(entry: ActivityEntry, who: Provider, id: string, agent: (event: DistributiveOmit<AgentEvent, 'threadId'>) => ReplayStep['action'], threadId: string): ReplayStep['action'][] {
  if (entry.who === 'you') return [{ type: 'send', threadId, text: entry.text, reason: '', drift: 'on-goal' }];
  if (entry.who === 'harness' || entry.kind === 'event') return [{ type: 'say', threadId, entry: { who: entry.who, kind: entry.kind, text: entry.text, detail: entry.detail } }];
  if (entry.kind === 'reasoning') return [agent({ type: 'reasoning', text: entry.text })];
  if (entry.kind === 'tool') {
    const file = /^(Write|Edit)\s+(\S+)/.exec(entry.text)?.[2];
    return [agent({ type: 'tool', id, phase: 'start', text: entry.text }), agent({ type: 'tool', id, phase: 'end', text: entry.text, exitCode: /^Run\b/.test(entry.text) ? 0 : undefined, files: file ? [file] : undefined })];
  }
  if (entry.kind !== 'message' || who !== entry.who) return [];
  const words = entry.text.match(/\S+\s*/g) ?? [entry.text];
  const chunks = Array.from({ length: Math.ceil(words.length / 3) }, (_, n) => words.slice(n * 3, n * 3 + 3).join(''));
  return chunks.map((text, n) => agent({ type: 'message', text, isDelta: n > 0 }));
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
