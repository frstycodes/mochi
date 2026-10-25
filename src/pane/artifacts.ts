import type { ActivityEntry, Thread } from '../model.ts';
import { parseTool } from '../summary.ts';
import { metaTitle, parseFence, VIZ_LANGUAGES, type VizLanguage } from '../viz/fence.ts';

export interface VisualArtifact {
  language: VizLanguage;
  code: string;
  title: string;
  at: number;
}

export interface FileArtifact {
  /** Absolute. */
  path: string;
  at: number;
}

const FENCE = /^(`{3,})([\w-]+)([^\n]*)\n([\s\S]*?)\n\1[ \t]*$/gm;
// Codex logs a created file as an `Edit` whose patch adds it from /dev/null.
const ADDED = /^--- \/dev\/null\n\+\+\+ b\/(.+)$/gm;
const ABSOLUTE = /^(\/|[a-z]:[\\/])/i;

const LABELS = {
  chart: 'Chart',
  svg: 'SVG',
  html: 'HTML widget',
  'harness-metro': 'Thread map',
  'harness-diff': 'Diff summary',
} satisfies Record<VizLanguage, string>;

export function artifactsOf(thread: Thread, outputRoot: string | null) {
  return { files: fileArtifacts(thread.activity, outputRoot), visuals: visualArtifacts(thread.activity) };
}

/**
 * Files the agent created as deliverables, newest first, each once: outside the working folder (adapters log those absolute), plus
 * saved generated images. `outputRoot`: a folderless chat's own folder, where every file it creates is a deliverable.
 */
export function fileArtifacts(activity: ActivityEntry[], outputRoot: string | null): FileArtifact[] {
  const seen = new Set<string>();
  return activity
    .flatMap((e) => createdPaths(e).map((path) => ({ path: ABSOLUTE.test(path) || !outputRoot ? path : `${outputRoot.replace(/\/$/, '')}/${path}`, at: e.at })))
    .filter((f) => ABSOLUTE.test(f.path))
    .reverse()
    .filter((f) => !seen.has(f.path) && !!seen.add(f.path));
}

function createdPaths(entry: ActivityEntry) {
  if (entry.kind !== 'tool') return [];
  if (entry.generated?.status === 'done' && entry.generated.src) return [entry.generated.src];
  const call = parseTool(entry.text);
  if (call.verb === 'Write' && call.target) return [call.target];
  return [...(entry.patch ?? '').matchAll(ADDED)].map((m) => m[1]);
}

/** Visuals the agent rendered in its replies, newest first. Fences still streaming or that fail to parse are left out. */
export function visualArtifacts(activity: ActivityEntry[]): VisualArtifact[] {
  return activity
    .filter((e) => e.kind === 'message' && e.who !== 'you' && e.who !== 'harness')
    .flatMap((e) => [...e.text.matchAll(FENCE)].flatMap(([, , language, meta, code]) => visual(language, meta, code, e.at)))
    .reverse();
}

function visual(language: string, meta: string, code: string, at: number): VisualArtifact[] {
  if (!isVizLanguage(language)) return [];
  const fence = parseFence(language, code, false);
  if (fence.status !== 'ready') return [];
  const specTitle = typeof fence.spec === 'object' && 'title' in fence.spec ? fence.spec.title : undefined;
  return [{ language, code, title: metaTitle(meta) ?? specTitle ?? LABELS[language], at }];
}

function isVizLanguage(language: string): language is VizLanguage {
  return (VIZ_LANGUAGES as readonly string[]).includes(language);
}
