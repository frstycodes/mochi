import { fuzzyMatches } from './fuzzy.ts';

// Enough to show every plausible hit; a query matching more than this is too loose to read as a tree anyway.
const FILTER_LIMIT = 500;

export interface TreeNode {
  name: string;
  path: string;
  children?: TreeNode[];
}

export interface TreeRow {
  node: TreeNode;
  depth: number;
}

/** The query's best fuzzy matches, with the matched characters of every row's name (files and their folders) keyed by path. */
export function filterFiles(files: string[], query: string) {
  const matches = fuzzyMatches(files, query, FILTER_LIMIT);
  const highlights = new Map<string, number[]>();
  for (const { file, indices } of matches) {
    let start = 0;
    for (const end of [...segmentEnds(file), file.length]) {
      const inName = indices.filter((i) => i >= start && i < end).map((i) => i - start);
      if (inName.length) highlights.set(file.slice(0, end), [...new Set([...(highlights.get(file.slice(0, end)) ?? []), ...inName])].sort((a, b) => a - b));
      start = end + 1;
    }
  }
  return { files: matches.map((m) => m.file), highlights, best: matches[0]?.file ?? null };
}

function segmentEnds(file: string) {
  return [...file.matchAll(/\//g)].map((m) => m.index);
}

export function buildTree(files: string[]) {
  const root: TreeNode = { name: '', path: '', children: [] };
  const index = new Map([['', root]]);
  for (const file of files) {
    const parts = file.split('/');
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join('/');
      if (index.has(path)) return;
      const node: TreeNode = i === parts.length - 1 ? { name, path } : { name, path, children: [] };
      index.get(parts.slice(0, i).join('/'))!.children!.push(node);
      index.set(path, node);
    });
  }
  return sortTree(root.children!);
}

function sortTree(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .map((n) => (n.children ? { ...n, children: sortTree(n.children) } : n))
    .sort((a, b) => Number(!a.children) - Number(!b.children) || a.name.localeCompare(b.name));
}

/** The rows on screen, top to bottom: every folder open when `expanded` is `'all'`. */
export function visibleRows(nodes: TreeNode[], expanded: Set<string> | 'all', depth = 0): TreeRow[] {
  return nodes.flatMap((node) => [{ node, depth }, ...(node.children && (expanded === 'all' || expanded.has(node.path)) ? visibleRows(node.children, expanded, depth + 1) : [])]);
}

export function ancestors(path: string) {
  const parts = path.split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}

/** Sorted indices as `[from, to)` runs, for wrapping matched characters. */
export function toRanges(indices: number[]) {
  const ranges: [number, number][] = [];
  for (const i of indices) {
    const last = ranges.at(-1);
    if (last && last[1] === i) last[1]++;
    else ranges.push([i, i + 1]);
  }
  return ranges;
}
