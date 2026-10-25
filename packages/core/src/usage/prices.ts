import { readFile, writeFile } from 'node:fs/promises';
import type { CostParts } from '../../../../apps/desktop/src/host/types/usage.ts';
import type { UsageRecord } from './records.ts';

/** Dollars per token. A tier replaces every rate for a whole request whose prompt is over `above` tokens. */
export interface Rates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  tiers: (Omit<Rates, 'tiers'> & { above: number })[];
}

export type PriceBook = (model: string) => Rates | null;

/** LiteLLM's public table, the one ccusage prices with: kept current by its maintainers as models launch or change price. */
export const LITELLM_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

let loaded: { book: PriceBook; at: number } | null = null;

/**
 * Today's prices: LiteLLM's table, re-fetched at most daily and kept in `cacheFile` for offline launches, then the built-in
 * table for models it lacks (or for everything when there's no copy at all).
 */
export async function priceBook(cacheFile: string): Promise<PriceBook> {
  if (loaded && Date.now() - loaded.at < MAX_AGE_MS) return loaded.book;
  const saved = await readFile(cacheFile, 'utf8')
    .then(
      (text) => JSON.parse(text) as { fetchedAt: number; table: LiteLlmTable },
    )
    .catch(() => null);
  let table = saved?.table ?? null;
  if (!saved || Date.now() - saved.fetchedAt > MAX_AGE_MS) {
    const fresh = await fetch(LITELLM_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
      .then((res) => (res.ok ? (res.json() as Promise<LiteLlmTable>) : null))
      .catch(() => null);
    if (fresh) {
      table = fresh;
      await writeFile(
        cacheFile,
        JSON.stringify({ fetchedAt: Date.now(), table: fresh }),
      ).catch(() => {});
    }
  }
  const fromTable = table ? liteLlmBook(table) : () => null;
  const book: PriceBook = (model) => fromTable(model) ?? builtInRates(model);
  loaded = { book, at: Date.now() };
  return book;
}

type LiteLlmTable = Record<string, Record<string, unknown>>;

/** Rates for a model from LiteLLM's table: by its id, its provider-prefixed id, or its id without a date suffix. */
export function liteLlmBook(table: LiteLlmTable): PriceBook {
  const cache = new Map<string, Rates | null>();
  return (model) => {
    if (cache.has(model)) return cache.get(model)!;
    const bare = model.replace(/^\[[^\]]*\]\s*/, '');
    const ids = [bare, bare.replace(/-\d{8}$/, '')].flatMap((id) => [
      id,
      `anthropic/${id}`,
      `openai/${id}`,
    ]);
    const entry = ids
      .map((id) => table[id])
      .find((e) => e && typeof e.input_cost_per_token === 'number');
    const rates = entry ? ratesFrom(entry) : null;
    cache.set(model, rates);
    return rates;
  };
}

function ratesFrom(e: Record<string, unknown>): Rates {
  const num = (key: string) =>
    typeof e[key] === 'number' ? (e[key] as number) : undefined;
  const base = (suffix: string, fallback?: Omit<Rates, 'tiers'>) => {
    const input = num(`input_cost_per_token${suffix}`) ?? fallback?.input ?? 0;
    const write5m =
      num(`cache_creation_input_token_cost${suffix}`) ??
      fallback?.cacheWrite5m ??
      input;
    return {
      input,
      output: num(`output_cost_per_token${suffix}`) ?? fallback?.output ?? 0,
      // GAP: a model with no cache-read price is charged its input rate for them; Claude and GPT models all list one.
      cacheRead:
        num(`cache_read_input_token_cost${suffix}`) ??
        fallback?.cacheRead ??
        input,
      cacheWrite5m: write5m,
      cacheWrite1h:
        num(`cache_creation_input_token_cost_above_1hr${suffix}`) ??
        fallback?.cacheWrite1h ??
        write5m,
    };
  };
  const flat = base('');
  const thresholds = [
    ...new Set(
      Object.keys(e).flatMap(
        (k) => /^input_cost_per_token_above_(\d+)k_tokens$/.exec(k)?.[1] ?? [],
      ),
    ),
  ]
    .map(Number)
    .sort((a, b) => a - b);
  return {
    ...flat,
    tiers: thresholds.map((k) => ({
      above: k * 1000,
      ...base(`_above_${k}k_tokens`, flat),
    })),
  };
}

/**
 * What one response cost, by kind of token. Long-context pricing applies to the whole request once its prompt (fresh input
 * plus cache reads and writes) passes the tier, the way Anthropic and OpenAI bill it.
 */
export function responseCost(r: UsageRecord, rates: Rates): CostParts {
  const prompt = r.input + r.cacheRead + r.cacheWrite5m + r.cacheWrite1h;
  const p = rates.tiers.findLast((t) => prompt > t.above) ?? rates;
  return {
    input: r.input * p.input,
    output: r.output * p.output,
    cacheRead: r.cacheRead * p.cacheRead,
    cacheWrite:
      r.cacheWrite5m * p.cacheWrite5m + r.cacheWrite1h * p.cacheWrite1h,
  };
}

/** The same response with no prompt cache: every cached token read or written as fresh input. */
export function uncachedCost(r: UsageRecord, rates: Rates) {
  const prompt = r.input + r.cacheRead + r.cacheWrite5m + r.cacheWrite1h;
  const p = rates.tiers.findLast((t) => prompt > t.above) ?? rates;
  return prompt * p.input + r.output * p.output;
}

const perMillion = (
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite5m = input * 1.25,
  cacheWrite1h = input * 2,
): Rates => ({
  input: input / 1e6,
  output: output / 1e6,
  cacheRead: cacheRead / 1e6,
  cacheWrite5m: cacheWrite5m / 1e6,
  cacheWrite1h: cacheWrite1h / 1e6,
  tiers: [],
});

/**
 * For when LiteLLM can't be reached and there's no saved copy: its rates for the models Mochi runs, as of 2026-10-21.
 * GAP: no long-context tiers here, and models launched since aren't priced until the table loads.
 */
const BUILT_IN_RATES: Record<string, Rates> = {
  'claude-fable-5-1': perMillion(10, 50, 0.25),
  'claude-fable-5': perMillion(10, 50, 1),
  'claude-opus-5-5': perMillion(4, 20, 0.2),
  'claude-opus-5': perMillion(5, 25, 0.5),
  'claude-opus-4-8': perMillion(5, 25, 0.5),
  'claude-opus-4-7': perMillion(5, 25, 0.5),
  'claude-opus-4-6': perMillion(5, 25, 0.5),
  'claude-sonnet-5-5': perMillion(2, 10, 0.2),
  'claude-sonnet-5': perMillion(2, 10, 0.2),
  'claude-sonnet-4-6': perMillion(3, 15, 0.3),
  'claude-haiku-5-5': perMillion(0.1, 0.5, 0.01),
  'claude-haiku-4-5': perMillion(1, 5, 0.1),
  'gpt-6-astra': perMillion(10, 50, 1, 12.5, 12.5),
  'gpt-6.1-sol': perMillion(2, 10, 0.1, 2.5, 2.5),
  'gpt-6-sol': perMillion(2, 10, 0.2, 2.5, 2.5),
  'gpt-6-luna': perMillion(0.1, 0.5, 0.01, 0.125, 0.125),
  'gpt-5.6-sol': perMillion(4, 20, 0.4, 5, 5),
  'gpt-5.6-terra': perMillion(2, 12, 0.2, 2.5, 2.5),
  'gpt-5.5': perMillion(5, 30, 0.5, 5, 5),
};

/** The longest built-in id the model starts with, so a dated id (`claude-haiku-4-5-20251001`) finds its family. */
export function builtInRates(model: string): Rates | null {
  const key = Object.keys(BUILT_IN_RATES)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return key ? BUILT_IN_RATES[key] : null;
}
