import type { ActivityEntry, Provider, Space, Thread } from '../model.ts';

// GAP: only live threads carry reported usage (`Thread.session.usage` and `Thread.live.usage`, from `host.agent` usage events);
// demo threads are estimated from the activity log. The plan window counts in simulation minutes, which live samples share.

export type ModelId = 'opus-5.5' | 'sonnet-5.5' | 'gpt-5.5-codex';

/** USD per million tokens. TODO(notify): unverified placeholders from earlier generations' list prices; check against the providers' published pricing before showing $ as real. */
export const MODEL_PRICES = {
  'opus-5.5': { input: 5, output: 25 },
  'sonnet-5.5': { input: 3, output: 15 },
  'gpt-5.5-codex': { input: 1.25, output: 10 },
} satisfies Record<ModelId, { input: number; output: number }>;

/** Priced stand-in for a model without a price, by provider. */
export const DEFAULT_MODEL = { claude: 'opus-5.5', codex: 'gpt-5.5-codex' } satisfies Record<Provider, ModelId>;

/** Tokens per rolling window by plan name (`Space.plans`). TODO(notify): made up; neither provider publishes token budgets, the real remaining figure comes from rate-limit headers via `host.agent`. */
export const PLAN_LIMITS: Record<string, number> = {
  Plus: 600_000,
  Max: 3_000_000,
  Team: 360_000,
  Business: 1_200_000,
};

/** Rolling usage window in simulation minutes (one tick is one minute). */
export const WINDOW_MINUTES = 300;
const RATE_SAMPLE_MINUTES = 15;
const WARN_MINUTES = 45;
const WARN_SHARE = 0.85;

/** Rough per-entry token cost: each tool call re-reads part of the context and writes a short call. */
const ENTRY_TOKENS = {
  tool: { input: 6_000, output: 350 },
  message: { input: 4_000, output: 600 },
  reasoning: { input: 0, output: 0 },
  event: { input: 0, output: 0 },
} satisfies Record<ActivityEntry['kind'], { input: number; output: number }>;
const REASONING_TOKENS_PER_SECOND = 45;

export interface Usage {
  input: number;
  output: number;
  costUsd: number;
}

export interface PlanUsage {
  provider: Provider;
  plan: string;
  used: number;
  limit: number;
  remaining: number;
  perMinute: number;
  /** Minutes until the window runs dry at the current pace; null while idle. */
  minutesLeft: number | null;
  isWarning: boolean;
}

export function threadUsage(thread: Thread): Usage {
  const reported = thread.session?.usage;
  if (reported) return { ...reported, costUsd: reported.costUsd ?? cost(reported, pricedModel(thread, thread.session!.provider)) };
  const tokens = agentEntries(thread).reduce((sum, e) => add(sum, entryTokens(e)), { input: 0, output: 0 });
  return { ...tokens, costUsd: cost(tokens, pricedModel(thread, thread.providers[0])) };
}

export function spaceUsage(threads: Thread[], space: Space, now: number) {
  const own = threads.filter((t) => t.spaceId === space.id);
  const total = own.map(threadUsage).reduce((sum, u) => ({ input: sum.input + u.input, output: sum.output + u.output, costUsd: sum.costUsd + u.costUsd }), { input: 0, output: 0, costUsd: 0 });
  const plans = (['claude', 'codex'] as const).filter((p) => isKnownPlan(space.plans[p])).map((p) => planUsage(own, p, space.plans[p], now));
  return { ...total, plans };
}

/** GAP: plans are demo names until usage reads the linked account's detected plan, so a profile with none shows no plan meters or limit forecasts. */
export function isKnownPlan(plan: string) {
  return plan in PLAN_LIMITS;
}

export function planUsage(threads: Thread[], provider: Provider, plan: string, now: number): PlanUsage {
  const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.Plus;
  const samples = threads.flatMap((t) => (t.live ? t.live.usage : agentEntries(t).map((e) => ({ at: e.at, provider: e.who, tokens: total(entryTokens(e)) }))));
  const own = samples.filter((u) => u.provider === provider);
  const since = (minutes: number) => own.filter((u) => u.at > now - minutes).reduce((sum, u) => sum + u.tokens, 0);
  const used = since(WINDOW_MINUTES);
  const remaining = Math.max(0, limit - used);
  const perMinute = since(RATE_SAMPLE_MINUTES) / RATE_SAMPLE_MINUTES;
  const minutesLeft = perMinute > 0 ? remaining / perMinute : null;
  const isWarning = used / limit >= WARN_SHARE || (minutesLeft !== null && minutesLeft < WARN_MINUTES);
  return { provider, plan, used, limit, remaining, perMinute, minutesLeft, isWarning };
}

export function cost(tokens: { input: number; output: number }, model: ModelId) {
  const price = MODEL_PRICES[model];
  return (tokens.input * price.input + tokens.output * price.output) / 1_000_000;
}

function pricedModel(thread: Thread, provider: Provider): ModelId {
  const model = thread.controls?.model;
  return model && model in MODEL_PRICES ? (model as ModelId) : DEFAULT_MODEL[provider];
}

function agentEntries(thread: Thread) {
  return thread.activity.filter((e) => e.who === 'claude' || e.who === 'codex');
}

function entryTokens(e: ActivityEntry) {
  if (e.kind === 'reasoning') return { input: 0, output: (e.seconds ?? 0) * REASONING_TOKENS_PER_SECOND };
  return ENTRY_TOKENS[e.kind];
}

function add(a: { input: number; output: number }, b: { input: number; output: number }) {
  return { input: a.input + b.input, output: a.output + b.output };
}

function total(t: { input: number; output: number }) {
  return t.input + t.output;
}
