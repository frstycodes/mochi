export type SortDir = 'asc' | 'desc';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Numbers (with thousands separators, %, $ or a unit suffix) compare by value; everything else by natural text order. */
export function compareCells(a: string, b: string) {
  const x = cellNumber(a);
  const y = cellNumber(b);
  if (x !== null && y !== null) return x - y;
  return collator.compare(a, b);
}

function cellNumber(text: string) {
  const match = text.trim().match(/^[$€£]?\s*(-?[\d,]*\.?\d+)\s*(%|[a-zA-Z]{1,3})?$/);
  if (!match) return null;
  const n = Number(match[1].replaceAll(',', ''));
  return Number.isFinite(n) ? n : null;
}

export function nextSort(current: { col: number; dir: SortDir } | null, col: number): { col: number; dir: SortDir } | null {
  if (current?.col !== col) return { col, dir: 'asc' };
  return current.dir === 'asc' ? { col, dir: 'desc' } : null;
}
