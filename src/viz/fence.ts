export type ChartKind = 'bar' | 'line' | 'area' | 'pie';

export interface ChartSpec {
  type: ChartKind;
  title?: string;
  x: string;
  series: string[];
  data: Record<string, string | number>[];
}

export interface BurnupSpec {
  thread: string;
}

export interface MetroSpec {
  threads: string[];
}

export interface DiffSpec {
  title?: string;
  files: { path: string; added: number; removed: number }[];
}

export interface VizSpecs {
  chart: ChartSpec;
  svg: string;
  html: string;
  'harness-burnup': BurnupSpec;
  'harness-metro': MetroSpec;
  'harness-diff': DiffSpec;
}

export type VizLanguage = keyof VizSpecs;

export type Fence<L extends VizLanguage = VizLanguage> = { status: 'pending' } | { status: 'ready'; spec: VizSpecs[L] } | { status: 'error'; message: string };

export const VIZ_LANGUAGES = ['chart', 'svg', 'html', 'harness-burnup', 'harness-metro', 'harness-diff'] as const satisfies readonly VizLanguage[];

const MARKUP = new Set<VizLanguage>(['svg', 'html']);

/** Streaming-aware: an unfinished fence stays pending until it parses; a finished one that doesn't parse is an error. */
export function parseFence<L extends VizLanguage>(language: L, code: string, isIncomplete: boolean): Fence<L> {
  // Half-streamed markup still "parses", and a widget mid-write would run its scripts against a partial DOM.
  if (isIncomplete && MARKUP.has(language)) return { status: 'pending' };
  try {
    return { status: 'ready', spec: PARSERS[language](code) as VizSpecs[L] };
  } catch (err) {
    if (isIncomplete) return { status: 'pending' };
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

const PARSERS = {
  chart: (code) => chartSpec(json(code)),
  svg: (code) => {
    const source = code.trim();
    if (!/^(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(source) || !/<\/svg>$/i.test(source)) throw new Error('not a complete <svg> document');
    return source;
  },
  html: (code) => {
    const source = code.trim();
    if (!source) throw new Error('empty widget');
    return source;
  },
  'harness-burnup': (code) => {
    const v = record(json(code));
    return { thread: text(v.thread, 'thread') };
  },
  'harness-metro': (code) => {
    const v = record(json(code));
    if (!Array.isArray(v.threads) || v.threads.length === 0) throw new Error('"threads" must be a non-empty array of thread ids');
    return { threads: v.threads.map((t, i) => text(t, `threads[${i}]`)) };
  },
  'harness-diff': (code) => {
    const v = record(json(code));
    if (!Array.isArray(v.files)) throw new Error('"files" must be an array');
    return {
      title: v.title === undefined ? undefined : text(v.title, 'title'),
      files: v.files.map((f, i) => {
        const file = record(f);
        return { path: text(file.path, `files[${i}].path`), added: count(file.added, `files[${i}].added`), removed: count(file.removed, `files[${i}].removed`) };
      }),
    };
  },
} satisfies { [L in VizLanguage]: (code: string) => VizSpecs[L] };

const CHART_KINDS = ['bar', 'line', 'area', 'pie'] as const satisfies readonly ChartKind[];
const MAX_SERIES = 5;

function chartSpec(value: unknown): ChartSpec {
  const v = record(value);
  const type = v.type ?? 'bar';
  if (!CHART_KINDS.includes(type as ChartKind)) throw new Error(`"type" must be one of ${CHART_KINDS.join(', ')}`);
  if (!Array.isArray(v.data) || v.data.length === 0) throw new Error('"data" must be a non-empty array of rows');
  const data = v.data.map((row) => record(row) as Record<string, string | number>);
  const x = text(v.x, 'x');
  const series = v.series === undefined ? Object.keys(data[0]).filter((k) => k !== x) : (Array.isArray(v.series) ? v.series : [v.series]).map((s, i) => text(s, `series[${i}]`));
  if (series.length === 0) throw new Error('no numeric series besides "x"');
  if (series.length > MAX_SERIES) throw new Error(`at most ${MAX_SERIES} series, one per thread line colour`);
  for (const key of series) if (!data.every((row) => typeof row[key] === 'number')) throw new Error(`series "${key}" must be a number in every row`);
  return { type: type as ChartKind, title: v.title === undefined ? undefined : text(v.title, 'title'), x, series, data };
}

function json(code: string): unknown {
  return JSON.parse(code);
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected a JSON object');
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string) {
  if (typeof value !== 'string' || !value) throw new Error(`"${name}" must be a non-empty string`);
  return value;
}

function count(value: unknown, name: string) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error(`"${name}" must be a whole number`);
  return value;
}

export const MAX_PROMPT_LENGTH = 4000;

export type WidgetMessage = { type: 'size'; height: number } | { type: 'prompt'; text: string };

/** Shape check for messages from a widget iframe; the caller must also check `event.source` is that iframe's window. */
export function readWidgetMessage(data: unknown, widgetId: string): WidgetMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const m = data as Record<string, unknown>;
  if (m.source !== 'harness-widget' || m.id !== widgetId) return null;
  if (m.type === 'size' && typeof m.height === 'number' && Number.isFinite(m.height) && m.height >= 0) return { type: 'size', height: m.height };
  if (m.type !== 'prompt' || typeof m.text !== 'string') return null;
  const text = m.text.trim();
  if (!text || text.length > MAX_PROMPT_LENGTH) return null;
  return { type: 'prompt', text };
}
