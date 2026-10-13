import type { ActivityEntry } from './model.ts';

export type ToolVerb = 'Read' | 'Edit' | 'Write' | 'Run' | 'Browser' | 'Search' | 'Fetch';

export interface ThreadSummary {
  tools: { verb: ToolVerb; count: number }[];
  toolTotal: number;
  added: number;
  removed: number;
  files: FileChange[];
}

export interface FileChange {
  path: string;
  added: number;
  removed: number;
}

const VERBS = ['Read', 'Edit', 'Write', 'Run', 'Browser', 'Search', 'Fetch'] satisfies ToolVerb[];

export function toolVerb(text: string): ToolVerb {
  const first = text.split(' ')[0];
  return (VERBS as string[]).includes(first) ? (first as ToolVerb) : 'Run';
}

export interface ToolCall {
  verb: ToolVerb;
  target: string;
  added?: number;
  removed?: number;
}

export function parseTool(text: string): ToolCall {
  const verb = toolVerb(text);
  const rest = text.startsWith(verb) ? text.slice(verb.length).trim() : text;
  const diff = /\s+\+(\d+)\s+[−-](\d+)$/.exec(rest);
  if (!diff) return { verb, target: rest };
  return { verb, target: rest.slice(0, diff.index), added: Number(diff[1]), removed: Number(diff[2]) };
}

/** A logged tool call, its diff stats read from the edit's patch when the agent sent one. */
export function toolCall(entry: Pick<ActivityEntry, 'text' | 'patch'>): ToolCall {
  const call = parseTool(entry.text);
  if (!entry.patch) return call;
  const lines = entry.patch.split('\n').filter((l) => !l.startsWith('+++') && !l.startsWith('---'));
  return { ...call, added: lines.filter((l) => l.startsWith('+')).length, removed: lines.filter((l) => l.startsWith('-')).length };
}

export function summarize(activity: ActivityEntry[]): ThreadSummary {
  const counts = new Map<ToolVerb, number>();
  const files = new Map<string, FileChange>();
  let added = 0;
  let removed = 0;

  for (const entry of activity) {
    if (entry.kind !== 'tool') continue;
    const call = toolCall(entry);
    counts.set(call.verb, (counts.get(call.verb) ?? 0) + 1);
    if (call.verb !== 'Edit' && call.verb !== 'Write') continue;
    const file = files.get(call.target) ?? { path: call.target, added: 0, removed: 0 };
    files.set(call.target, file);
    file.added += call.added ?? 0;
    file.removed += call.removed ?? 0;
    added += call.added ?? 0;
    removed += call.removed ?? 0;
  }

  const tools = VERBS.filter((v) => counts.has(v)).map((verb) => ({ verb, count: counts.get(verb)! }));
  return { tools, toolTotal: tools.reduce((n, t) => n + t.count, 0), added, removed, files: [...files.values()] };
}

const PLURAL = new Intl.PluralRules('en');

// Ordered by importance: what changed the repo, then what ran, then what was looked up.
// `two` is English's "twice", which plural rules don't have; only phrases that read better with it set it.
const TURN_PHRASES: { key: string; matches: (c: ToolCall) => boolean; forms: { one: string; two?: string; other: string } }[] = [
  { key: 'edit', matches: (c) => c.verb === 'Edit', forms: { one: 'edited # file', other: 'edited # files' } },
  { key: 'write', matches: (c) => c.verb === 'Write', forms: { one: 'created # file', other: 'created # files' } },
  { key: 'run', matches: (c) => c.verb === 'Run', forms: { one: 'ran # command', other: 'ran # commands' } },
  { key: 'search', matches: (c) => c.verb === 'Search', forms: { one: 'searched the web', two: 'searched the web twice', other: 'searched the web # times' } },
  { key: 'fetch', matches: (c) => c.verb === 'Fetch', forms: { one: 'read # page', other: 'read # pages' } },
  { key: 'read', matches: (c) => c.verb === 'Read', forms: { one: 'read # file', other: 'read # files' } },
  { key: 'browser', matches: (c) => c.verb === 'Browser', forms: { one: 'used the browser', other: 'used the browser # times' } },
];

/** A finished work group in one line, like Claude's: "Edited 2 files, ran 1 command, searched the web twice". Files count once however often they were edited. */
export function turnSummary(entries: ActivityEntry[]) {
  const calls = entries.filter((e) => e.kind === 'tool').map(toolCall);
  const phrases = TURN_PHRASES.flatMap(({ matches, forms, key }) => {
    const hits = calls.filter(matches);
    const count = key === 'edit' || key === 'write' ? new Set(hits.map((c) => c.target)).size : hits.length;
    if (!count) return [];
    const form = count === 2 && forms.two ? forms.two : PLURAL.select(count) === 'one' ? forms.one : forms.other;
    return [form.replace('#', String(count))];
  });
  const text = phrases.join(', ') || (entries.some((e) => e.kind === 'reasoning') ? 'thought it through' : 'worked');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

const DOMAINS_SHOWN = 2;

/** What a read-only tool asks to do, as the end of a sentence ("search the web for “X” on a.com, b.com +5 more"); undefined for tools without one. */
export function describeApproval(tool: string, input: Record<string, unknown>): string | undefined {
  if (tool === 'WebSearch' && typeof input.query === 'string') {
    const domains = Array.isArray(input.allowed_domains) ? input.allowed_domains.filter((d): d is string => typeof d === 'string') : [];
    const more = domains.length > DOMAINS_SHOWN ? ` +${domains.length - DOMAINS_SHOWN} more` : '';
    return `search the web for “${input.query}”${domains.length ? ` on ${domains.slice(0, DOMAINS_SHOWN).join(', ')}${more}` : ''}`;
  }
  if (tool === 'WebFetch' && typeof input.url === 'string') return `read ${input.url.replace(/^https?:\/\/(www\.)?/, '')}`;
  return undefined;
}

/** An approval asked or granted: noise in a finished log, where the call's own row already shows it ran. */
export const isApprovalChatter = (text: string) => /^(Waiting on you|Approved):/.test(text);

/** A harness event as a sentence. "Approved: {json}" from before approvals were described reads from its input instead. */
export function eventLine(text: string) {
  const match = /^(Approved|Denied|Waiting on you): ([\s\S]*)$/.exec(text);
  if (!match) return text;
  const [, verdict, rest] = match;
  const sentence = rest.trim().startsWith('{') ? fromJson(rest) : lowerFirst(rest);
  return `${verdict}: ${sentence}`;
}

function fromJson(json: string) {
  try {
    const input = JSON.parse(json) as Record<string, unknown>;
    return describeApproval(typeof input.url === 'string' ? 'WebFetch' : 'WebSearch', input) ?? 'a tool call';
  } catch {
    return 'a tool call';
  }
}

// "Search the web…" → "search the web…", but an acronym or a name like "WebSearch" keeps its case.
const lowerFirst = (s: string) => (/^[A-Z][a-z ]/.test(s) && !/^[A-Z]\w*[A-Z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
