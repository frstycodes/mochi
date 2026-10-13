import type { ActivityEntry, Space, Thread } from '../model.ts';

// GAP: only live threads carry reported usage (`Thread.session.usage`, from `host.agent` usage events); demo threads are
// estimated from the activity log. Cost is only ever what the harness reported (Claude's `total_cost_usd`); Codex reports
// tokens alone, so its threads have none. Plan limits are the account's real windows (`usage/limits.ts`), not counted here.

/** Rough per-entry token cost: each tool call re-reads part of the context and writes a short call. */
const ENTRY_TOKENS = {
  tool: { input: 6_000, output: 350 },
  message: { input: 4_000, output: 600 },
  reasoning: { input: 0, output: 0 },
  event: { input: 0, output: 0 },
  // A subagent's tokens arrive as usage events of their own.
  subagent: { input: 0, output: 0 },
} satisfies Record<ActivityEntry['kind'], { input: number; output: number }>;
const REASONING_TOKENS_PER_SECOND = 45;

export interface Usage {
  input: number;
  output: number;
  /** Read from the prompt cache, part of `input`; only where the harness reported it. */
  cached?: number;
  /** null when the harness reported no spend (Codex, demo threads): show the tokens instead. */
  costUsd: number | null;
}

export function threadUsage(thread: Thread): Usage {
  const reported = thread.session?.usage;
  if (reported) return { input: reported.input, output: reported.output, ...(reported.cached !== undefined && { cached: reported.cached }), costUsd: reported.costUsd ?? null };
  const tokens = agentEntries(thread).reduce((sum, e) => add(sum, entryTokens(e)), { input: 0, output: 0 });
  return { ...tokens, costUsd: null };
}

/** `costUsd` sums the threads that reported one; null when none did. */
export function spaceUsage(threads: Thread[], space: Space) {
  const own = threads.filter((t) => t.spaceId === space.id);
  const total = own.map(threadUsage).reduce<Usage>(
    (sum, u) => ({ input: sum.input + u.input, output: sum.output + u.output, costUsd: u.costUsd === null ? sum.costUsd : (sum.costUsd ?? 0) + u.costUsd }),
    { input: 0, output: 0, costUsd: null },
  );
  return total;
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
