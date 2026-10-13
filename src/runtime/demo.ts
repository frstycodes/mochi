import type { AgentEvent, AgentPlanItem } from '../host/types/agent.ts';
import { DEMO_LINKS, FAKE_TOOLS, genericTools, NOW0, type Step, type Thread } from '../model.ts';

/** The prototype's scripted agent: a pure function from a thread snapshot and the clock to what it would report this minute. */
export function demoEvents(thread: Thread, now: number): AgentEvent[] {
  if (thread.status === 'settled') return [];
  const threadId = thread.id;
  const events: AgentEvent[] = [];
  let contextUsed = thread.context.used;
  let isChanged = false;

  const steps = thread.steps.map((s) => {
    if (s.status !== 'running') return s;
    isChanged = true;
    const progress = Math.min(1, s.progress + 1 / (s.size * SPEED));
    if (progress >= 1) return { ...s, status: 'done' as const, progress };
    if (now % 4 === 0) {
      const tools = FAKE_TOOLS[s.id] ?? genericTools(s.title);
      const used = thread.activity.filter((a) => a.kind === 'tool' && a.at >= (s.startedAt ?? 0)).length;
      const id = `demo-${threadId}-${s.id}-${now}`;
      const text = tools[used % tools.length];
      contextUsed = Math.min(Math.round(thread.context.max * CONTEXT_CEILING), contextUsed + TOKENS_PER_TOOL);
      events.push(
        { threadId, type: 'tool', id, phase: 'start', text },
        { threadId, type: 'tool', id, phase: 'end', text, ...(DEMO_LINKS[text] && { links: DEMO_LINKS[text] }) },
        { threadId, type: 'usage', inputTokens: 0, outputTokens: 0, contextUsed, contextMax: thread.context.max },
      );
      // A word between bursts of calls, so a demo turn interleaves work groups with prose like a real agent's.
      if (used % CALLS_PER_NOTE === CALLS_PER_NOTE - 1) events.push({ threadId, type: 'message', text: NOTES[Math.floor(used / CALLS_PER_NOTE) % NOTES.length], isDelta: false });
    }
    return { ...s, progress };
  });

  const isIdle = thread.status !== 'needs-you' && !steps.some((s) => s.status === 'running');
  const next = isIdle ? steps.find((s) => s.status === 'ready') : undefined;
  if (next) {
    isChanged = true;
    steps[steps.indexOf(next)] = { ...next, status: 'running' };
  }

  const items = steps.filter((s) => s.status !== 'dropped').map(planItem);
  const script = scriptAt(thread, now);
  events.push(...script.say.map((text): AgentEvent => ({ threadId, type: 'message', text, isDelta: false })));
  for (const { at, item } of script.add) items.splice(at ?? items.length, 0, item);
  if (isChanged || script.add.length) events.push({ threadId, type: 'plan', items });
  if (thread.id === WEB_APPROVAL.threadId && now === WEB_APPROVAL.at && thread.status === 'running') {
    const id = `demo-web-${now}`;
    events.push(
      { threadId, type: 'tool', id, phase: 'start', text: `Search ${WEB_APPROVAL.query}`, links: DEMO_LINKS[`Search ${WEB_APPROVAL.query}`] },
      { threadId, type: 'approval', requestId: id, kind: 'tool', title: `Search the web for “${WEB_APPROVAL.query}” on ${WEB_APPROVAL.domains}`, detail: 'Looks this up before picking a CSV streaming approach.' },
    );
  }
  if (next?.gate) {
    const after = steps.filter((s) => s.status === 'ready').length;
    events.push({ threadId, type: 'approval', requestId: `gate-${next.id}`, kind: 'tool', title: `Start "${next.title}"`, detail: `You asked to approve this step before it runs. Steps after it: ${after}.` });
  }

  events.push(...agentEvents(thread, now));

  const isFinished = isIdle && !next && thread.status !== 'review' && !steps.some((s) => s.status !== 'done' && s.status !== 'dropped');
  if (isFinished) events.push({ threadId, type: 'turn-end', status: 'done' });
  return events;
}

/** The scripted overlap on its own, for the prototype menu's "trigger overlap". */
export function overlapEvents(thread: Thread): AgentEvent[] {
  const items = thread.steps.filter((s) => s.status !== 'dropped').map(planItem);
  items.splice(OVERLAP.at, 0, OVERLAP.item);
  return [
    { threadId: thread.id, type: 'message', text: OVERLAP.say, isDelta: false },
    { threadId: thread.id, type: 'plan', items },
  ];
}

export const SCRIPT = { overlapAt: NOW0 + 6, scopeAt: NOW0 + 40 };
// A web search that asks first, so the demo's live turn shows an approval asked and answered inside its work log.
const WEB_APPROVAL = { threadId: 'adm', at: NOW0 + 14, query: 'stream large CSV export node fastify backpressure', domains: 'github.com, nodejs.org +3 more' };
const SPEED = 40;
const CALLS_PER_NOTE = 3;
const NOTES = [
  'Read through what is there. The change is smaller than it looked, so I will make it in place.',
  'First pass is in. Running the checks before I go further.',
  'Checks pass. One more pass over the edge cases, then this step is done.',
];
const TOKENS_PER_TOOL = 900;
const CONTEXT_CEILING = 0.97;

const OVERLAP = {
  threadId: 'adm',
  at: 2,
  say: 'Usage queries take 1.8s at 10k keys. I will add a Redis client and cache them.',
  item: { title: 'Add Redis client', status: 'pending', size: 2, files: ['packages/cache/redis.ts', 'apps/web/server/cache.ts'] },
} satisfies { threadId: string; at: number; say: string; item: AgentPlanItem };

const SCOPE = {
  threadId: 'rl',
  items: [
    { title: 'Return RateLimit-* headers', status: 'pending', size: 1, files: ['apps/api/middleware/ratelimit.ts'] },
    { title: 'Stricter limits for /search', status: 'pending', size: 2, files: ['apps/api/routes/search.ts'] },
  ],
} satisfies { threadId: string; items: AgentPlanItem[] };

function scriptAt(thread: Thread, now: number): { say: string[]; add: { at?: number; item: AgentPlanItem }[] } {
  const has = (title: string) => thread.steps.some((s) => s.title === title);
  if (thread.id === OVERLAP.threadId && now === SCRIPT.overlapAt && !has(OVERLAP.item.title)) return { say: [OVERLAP.say], add: [{ at: OVERLAP.at, item: OVERLAP.item }] };
  if (thread.id === SCOPE.threadId && now === SCRIPT.scopeAt && !has(SCOPE.items[0].title)) return { say: [], add: SCOPE.items.map((item) => ({ item })) };
  return { say: [], add: [] };
}

/** Scripted subagents: two background agents on Claude's thread, one foreground subagent on Codex's. */
const AGENTS = [
  {
    threadId: 'rl',
    id: 'demo-agent-load',
    name: 'Load test the limiter',
    prompt: 'Run k6 against the rate limiter at 2× the Pro tier for 2 minutes and report p95 latency and 429 rates per tier.',
    model: 'claude-haiku-5-5',
    isBackground: true,
    at: NOW0 + 3,
    ticks: 45,
    steps: ['Read apps/api/middleware/ratelimit.ts', 'Write scripts/load/ratelimit.k6.js', 'Run k6 run scripts/load/ratelimit.k6.js --vus 200 --duration 2m', 'Read apps/api/middleware/__tests__/ratelimit.test.ts', 'Run pnpm --filter api test ratelimit'],
    result: 'p95 stays at 11ms under 1,200 rps. Free keys get 429s at 60/min as expected; Pro at 600/min. One gap: /search shares the global bucket, so a burst there starves other routes for the same key.',
  },
  {
    threadId: 'rl',
    id: 'demo-agent-docs',
    name: 'Draft the limits doc',
    prompt: 'Write docs/api/limits.md: the tiers, the RateLimit-* headers and how to ask for an override.',
    model: 'claude-haiku-5-5',
    isBackground: true,
    at: NOW0 + 6,
    ticks: 10,
    steps: ['Read docs/api/limits.md', 'Edit docs/api/limits.md  +42 −3'],
    result: '**Drafted** `docs/api/limits.md`: tiers table, the three RateLimit-* headers with examples, and an [override request](https://example.com/overrides) section.',
  },
  {
    threadId: 'adm',
    id: 'demo-agent-callers',
    name: 'Find usage query callers',
    prompt: 'List every caller of getDailyUsage and whether it paginates.',
    model: 'gpt-6-luna',
    isBackground: false,
    at: NOW0 + 2,
    ticks: 8,
    steps: ['Run rg -n getDailyUsage apps packages', 'Read apps/api/routes/admin/usage.ts', 'Read apps/web/routes/admin/usage.tsx'],
    result: 'Two callers: the admin usage route (cursor paginated) and the CSV export (streams all rows, unpaginated by design).',
  },
];

const TOKENS_PER_AGENT_STEP = 3_400;

function agentEvents(thread: Thread, now: number): AgentEvent[] {
  return AGENTS.filter((a) => a.threadId === thread.id).flatMap((a): AgentEvent[] => {
    const t = now - a.at;
    const subagent = thread.subagents?.find((s) => s.id === a.id);
    const base = { threadId: thread.id, type: 'subagent', id: a.id } as const;
    if (t === 0 && !subagent) return [{ ...base, phase: 'start', toolId: `${a.id}-call`, name: a.name, prompt: a.prompt, model: a.model, isBackground: a.isBackground }];
    if (subagent?.status !== 'running' || t <= 0) return [];
    if (t >= a.ticks) return [{ ...base, phase: 'end', status: 'done', result: a.result, tokens: subagent.tokens + TOKENS_PER_AGENT_STEP }];
    const n = Math.floor((t - 1) / 2);
    const text = a.steps[n % a.steps.length];
    const step = { id: `${a.id}-${n}`, phase: t % 2 ? 'start' : 'end', text, ...(t % 2 === 0 && text.startsWith('Run') && { exitCode: 0 }) } as const;
    return [{ ...base, phase: 'progress', step, tokens: subagent.tokens + TOKENS_PER_AGENT_STEP }];
  });
}

function planItem(s: Step): AgentPlanItem {
  if (s.status === 'done') return { title: s.title, status: 'done' };
  if (s.status === 'running') return { title: s.title, status: 'running', progress: s.progress };
  return { title: s.title, status: 'pending' };
}
