import type {
  AgentEvent,
  AgentPlanItem,
  AgentTaskEvent,
} from '../host/types/agent.ts';
import {
  DEMO_LINKS,
  FAKE_TOOLS,
  genericTools,
  NOW0,
  type Step,
  type Thread,
} from '../model.ts';

/** The prototype's scripted agent: a pure function from a thread snapshot and the clock to what it would report this minute. */
export function demoEvents(thread: Thread, now: number): AgentEvent[] {
  if (thread.status === 'settled') return [];
  const threadId = thread.id;
  const events: AgentEvent[] = [];
  let contextUsed = thread.context.used;
  let isChanged = false;

  const steps = thread.steps.map((s) => {
    if (s.status !== 'running') return s;
    if (now - (s.startedAt ?? now) >= STEP_MINUTES) {
      isChanged = true;
      return { ...s, status: 'done' as const };
    }
    if (now % 4 === 0) {
      const tools = FAKE_TOOLS[s.id] ?? genericTools(s.title);
      const used = thread.activity.filter(
        (a) => a.kind === 'tool' && a.at >= (s.startedAt ?? 0),
      ).length;
      const id = `demo-${threadId}-${s.id}-${now}`;
      const text = tools[used % tools.length];
      contextUsed = Math.min(
        Math.round(thread.context.max * CONTEXT_CEILING),
        contextUsed + TOKENS_PER_TOOL,
      );
      events.push(
        { threadId, type: 'tool', id, phase: 'start', text },
        {
          threadId,
          type: 'tool',
          id,
          phase: 'end',
          text,
          ...(DEMO_LINKS[text] && { links: DEMO_LINKS[text] }),
        },
        {
          threadId,
          type: 'usage',
          inputTokens: 0,
          outputTokens: 0,
          contextUsed,
          contextMax: thread.context.max,
        },
      );
      // A word between bursts of calls, so a demo turn interleaves work groups with prose like a real agent's.
      if (used % CALLS_PER_NOTE === CALLS_PER_NOTE - 1)
        events.push({
          threadId,
          type: 'message',
          text: NOTES[Math.floor(used / CALLS_PER_NOTE) % NOTES.length],
          isDelta: false,
        });
    }
    return s;
  });

  const isIdle =
    thread.status !== 'needs-you' && !steps.some((s) => s.status === 'running');
  const next = isIdle ? steps.find((s) => s.status === 'ready') : undefined;
  if (next) {
    isChanged = true;
    steps[steps.indexOf(next)] = { ...next, status: 'running' };
  }

  const items = steps.filter((s) => s.status !== 'dropped').map(planItem);
  const script = scriptAt(thread, now);
  events.push(
    ...script.say.map((text): AgentEvent => ({
      threadId,
      type: 'message',
      text,
      isDelta: false,
    })),
  );
  for (const { at, item } of script.add)
    items.splice(at ?? items.length, 0, item);
  if (isChanged || script.add.length)
    events.push({ threadId, type: 'plan', items });
  if (
    thread.id === WEB_APPROVAL.threadId &&
    now === WEB_APPROVAL.at &&
    thread.status === 'running'
  ) {
    const id = `demo-web-${now}`;
    events.push(
      {
        threadId,
        type: 'tool',
        id,
        phase: 'start',
        text: `Search ${WEB_APPROVAL.query}`,
        links: DEMO_LINKS[`Search ${WEB_APPROVAL.query}`],
      },
      {
        threadId,
        type: 'approval',
        requestId: id,
        kind: 'tool',
        title: `Search the web for “${WEB_APPROVAL.query}” on ${WEB_APPROVAL.domains}`,
        detail: 'Looks this up before picking a CSV streaming approach.',
      },
    );
  }
  events.push(...agentEvents(thread, now), ...taskEvents(thread, now));

  const isFinished =
    isIdle &&
    !next &&
    thread.status !== 'review' &&
    !steps.some((s) => s.status !== 'done' && s.status !== 'dropped');
  if (isFinished) events.push({ threadId, type: 'turn-end', status: 'done' });
  return events;
}

export const SCRIPT = { scopeAt: NOW0 + 40 };
// A web search that asks first, so the demo's live turn shows an approval asked and answered inside its work log.
const WEB_APPROVAL = {
  threadId: 'adm',
  at: NOW0 + 14,
  query: 'stream large CSV export node fastify backpressure',
  domains: 'github.com, nodejs.org +3 more',
};
/** How long a demo step runs before it's done. */
const STEP_MINUTES = 40;
const CALLS_PER_NOTE = 3;
const NOTES = [
  'Read through what is there. The change is smaller than it looked, so I will make it in place.',
  'First pass is in. Running the checks before I go further.',
  'Checks pass. One more pass over the edge cases, then this step is done.',
];
const TOKENS_PER_TOOL = 900;
const CONTEXT_CEILING = 0.97;

const SCOPE = {
  threadId: 'rl',
  items: [
    { title: 'Return RateLimit-* headers', status: 'pending' },
    { title: 'Stricter limits for /search', status: 'pending' },
  ],
} satisfies { threadId: string; items: AgentPlanItem[] };

function scriptAt(
  thread: Thread,
  now: number,
): { say: string[]; add: { at?: number; item: AgentPlanItem }[] } {
  const has = (title: string) => thread.steps.some((s) => s.title === title);
  if (
    thread.id === SCOPE.threadId &&
    now === SCRIPT.scopeAt &&
    !has(SCOPE.items[0].title)
  )
    return { say: [], add: SCOPE.items.map((item) => ({ item })) };
  return { say: [], add: [] };
}

/** Scripted subagents: two background agents on Claude's thread, one foreground subagent on Codex's. */
const AGENTS = [
  {
    threadId: 'rl',
    id: 'demo-agent-load',
    name: 'Load test the limiter',
    prompt:
      'Run k6 against the rate limiter at 2× the Pro tier for 2 minutes and report p95 latency and 429 rates per tier.',
    model: 'claude-haiku-5-5',
    isBackground: true,
    at: NOW0 + 3,
    ticks: 45,
    steps: [
      'Read apps/api/middleware/ratelimit.ts',
      'Write scripts/load/ratelimit.k6.js',
      'Run k6 run scripts/load/ratelimit.k6.js --vus 200 --duration 2m',
      'Read apps/api/middleware/__tests__/ratelimit.test.ts',
      'Run pnpm --filter api test ratelimit',
    ],
    result:
      'p95 stays at 11ms under 1,200 rps. Free keys get 429s at 60/min as expected; Pro at 600/min. One gap: /search shares the global bucket, so a burst there starves other routes for the same key.',
  },
  {
    threadId: 'rl',
    id: 'demo-agent-docs',
    name: 'Draft the limits doc',
    prompt:
      'Write docs/api/limits.md: the tiers, the RateLimit-* headers and how to ask for an override.',
    model: 'claude-haiku-5-5',
    isBackground: true,
    at: NOW0 + 6,
    ticks: 10,
    steps: ['Read docs/api/limits.md', 'Edit docs/api/limits.md  +42 −3'],
    result:
      '**Drafted** `docs/api/limits.md`: tiers table, the three RateLimit-* headers with examples, and an [override request](https://example.com/overrides) section.',
  },
  {
    threadId: 'rl',
    id: 'demo-agent-redis',
    name: 'Profile the Redis calls',
    prompt: 'Measure how many Redis round trips one limited request makes.',
    model: 'claude-haiku-5-5',
    isBackground: true,
    at: NOW0 + 4,
    ticks: 4,
    steps: ['Run redis-cli --latency'],
    error: 'redis-cli: command not found',
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
    steps: [
      'Run rg -n getDailyUsage apps packages',
      'Read apps/api/routes/admin/usage.ts',
      'Read apps/web/routes/admin/usage.tsx',
    ],
    result:
      'Two callers: the admin usage route (cursor paginated) and the CSV export (streams all rows, unpaginated by design).',
  },
];

const TOKENS_PER_AGENT_STEP = 3_400;

function agentEvents(thread: Thread, now: number): AgentEvent[] {
  return AGENTS.filter((a) => a.threadId === thread.id).flatMap(
    (a): AgentEvent[] => {
      const t = now - a.at;
      const subagent = thread.subagents?.find((s) => s.id === a.id);
      const base = { threadId: thread.id, type: 'subagent', id: a.id } as const;
      if (t === 0 && !subagent)
        return [
          {
            ...base,
            phase: 'start',
            toolId: `${a.id}-call`,
            name: a.name,
            prompt: a.prompt,
            model: a.model,
            isBackground: a.isBackground,
          },
        ];
      if (subagent?.status !== 'running' || t <= 0) return [];
      if (t >= a.ticks)
        return [
          {
            ...base,
            phase: 'end',
            tokens: subagent.tokens + TOKENS_PER_AGENT_STEP,
            ...('error' in a
              ? { status: 'failed', error: a.error }
              : { status: 'done', result: a.result }),
          },
        ];
      const n = Math.floor((t - 1) / 2);
      const text = a.steps[n % a.steps.length];
      const step = {
        id: `${a.id}-${n}`,
        phase: t % 2 ? 'start' : 'end',
        text,
        ...(t % 2 === 0 && text.startsWith('Run') && { exitCode: 0 }),
      } as const;
      return [
        {
          ...base,
          phase: 'progress',
          step,
          tokens: subagent.tokens + TOKENS_PER_AGENT_STEP,
        },
      ];
    },
  );
}

/** Scripted background commands on Claude's thread: one that keeps running, one that passes, one that fails, and a workflow. */
const TASKS = [
  {
    id: 'demo-task-watch',
    kind: 'shell',
    title: 'Watch the limiter tests',
    command: 'pnpm --filter api test --watch ratelimit',
    at: NOW0 + 1,
    ticks: Infinity,
  },
  {
    id: 'demo-task-build',
    kind: 'shell',
    title: 'Build the API',
    command: 'pnpm --filter api build',
    at: NOW0 + 2,
    ticks: 6,
    exitCode: 0,
  },
  {
    id: 'demo-task-lint',
    kind: 'shell',
    title: 'pnpm lint --max-warnings 0',
    command: 'pnpm lint --max-warnings 0',
    at: NOW0 + 4,
    ticks: 3,
    exitCode: 1,
  },
  {
    id: 'demo-task-spec',
    kind: 'workflow',
    title: 'Check the spec against the routes',
    at: NOW0 + 5,
    ticks: Infinity,
  },
] satisfies (Pick<
  AgentTaskEvent,
  'id' | 'kind' | 'title' | 'command' | 'exitCode'
> & { at: number; ticks: number })[];

function taskEvents(thread: Thread, now: number): AgentEvent[] {
  if (thread.id !== 'rl') return [];
  return TASKS.flatMap(({ at, ticks, exitCode, ...task }): AgentEvent[] => {
    const base = { threadId: thread.id, type: 'task', id: task.id } as const;
    if (now === at) return [{ ...base, ...task, phase: 'start' }];
    if (now !== at + ticks) return [];
    return [
      {
        ...base,
        phase: 'end',
        status: exitCode ? 'failed' : 'done',
        ...(exitCode !== undefined && { exitCode }),
      },
    ];
  });
}

function planItem(s: Step): AgentPlanItem {
  if (s.status === 'done') return { title: s.title, status: 'done' };
  if (s.status === 'running') return { title: s.title, status: 'running' };
  return { title: s.title, status: 'pending' };
}
