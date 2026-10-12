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

export function summarize(activity: ActivityEntry[]): ThreadSummary {
  const counts = new Map<ToolVerb, number>();
  const files = new Map<string, FileChange>();
  let added = 0;
  let removed = 0;

  for (const entry of activity) {
    if (entry.kind !== 'tool') continue;
    const call = parseTool(entry.text);
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
