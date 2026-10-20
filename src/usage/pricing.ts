import type { TokenBucket } from '../host/types/usage.ts';

/** US dollars per million tokens. */
interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

// GAP: list prices, not what a subscription bills; kept by hand. Claude input/output and the cache reads marked "listed"
// come from Anthropic's model table (cached 2026-10-06); other cache reads assume 0.1× input, and cache writes 1.25× (5 min)
// and 2× (1 h) input, the multipliers Anthropic has used so far. Haiku 5.5's long-prompt tier (over 100K) is ignored.
// OpenAI's GPT-6 rates are from third-party listings (Luna's conflict); TODO: check developers.openai.com/api/docs/pricing.
const claude = (input: number, output: number, cacheRead = input / 10): Price => ({ input, output, cacheRead, cacheWrite5m: input * 1.25, cacheWrite1h: input * 2 });

/** By model id prefix; the longest match wins, so `claude-opus-5-5` isn't priced as `claude-opus-5`. */
const PRICES: Record<string, Price> = {
  'claude-fable-5-1': claude(10, 50, 0.25), // cache read listed
  'claude-fable-5': claude(10, 50),
  'claude-opus-5-5': claude(4, 20, 0.2), // cache read listed
  'claude-opus-5': claude(5, 25),
  'claude-opus-4-8': claude(5, 25),
  'claude-opus-4-7': claude(5, 25),
  'claude-opus-4-6': claude(5, 25),
  'claude-sonnet-5-5': claude(2, 10, 0.2), // cache read listed
  'claude-sonnet-5': claude(2, 10),
  'claude-sonnet-4-6': claude(3, 15),
  'claude-haiku-5-5': claude(0.1, 0.5),
  'claude-haiku-4-5': claude(1, 5),
  'gpt-6-astra': { input: 10, output: 50, cacheRead: 1, cacheWrite5m: 12.5, cacheWrite1h: 12.5 },
  'gpt-6-luna': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite5m: 0.125, cacheWrite1h: 0.125 },
};

export function priceOf(model: string): Price | null {
  const key = Object.keys(PRICES)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return key ? PRICES[key] : null;
}

/** What each kind of token cost, in dollars; null when the model has no price. */
export function costParts(b: TokenBucket) {
  const p = priceOf(b.model);
  if (!p) return null;
  return {
    input: (b.input * p.input) / 1e6,
    output: (b.output * p.output) / 1e6,
    cacheRead: (b.cacheRead * p.cacheRead) / 1e6,
    cacheWrite: (b.cacheWrite5m * p.cacheWrite5m + b.cacheWrite1h * p.cacheWrite1h) / 1e6,
  };
}

/** The same tokens with no prompt cache: every cached token read or written as fresh input. */
export function uncachedCost(b: TokenBucket) {
  const p = priceOf(b.model);
  if (!p) return null;
  return ((b.input + b.cacheRead + b.cacheWrite5m + b.cacheWrite1h) * p.input + b.output * p.output) / 1e6;
}
