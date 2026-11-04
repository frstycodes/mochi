import { defaultFilter } from 'cmdk';

/** cmdk's score ties on a shared prefix ("set" → Settled threads, Settings) and then keeps list order; the shorter, more exact title wins. The nudge (≤0.001 under 1000 chars) only reorders ties. */
export function rankShorterFirst(
  value: string,
  search: string,
  keywords?: string[],
) {
  const score = defaultFilter(value, search, keywords);
  return score > 0 ? score - value.length * 1e-6 : 0;
}
