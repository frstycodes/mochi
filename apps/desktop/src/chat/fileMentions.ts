import type { Provider } from '../model.ts';
import { fuzzyMatches } from '@mochi/domain/files/fuzzy';

/** A file or folder picked from `@`: `label` as the composer shows it (`src/a.ts`, `../x/`), `path` as the agent gets it. */
export type FileMention = {
  kind: 'file';
  id: string;
  title: string;
  path: string;
  isDir: boolean;
};

const RECENT_BONUS = 6;
const BROWSE_PREFIX = /^(?:\.\.\/|~\/|\/)/;

/** `../oth` → browse `../`, filter `oth`; `~/dev/` → browse `~/dev/`, filter ''; a plain query (`sid`) → null. */
export function browseQuery(query: string) {
  if (!BROWSE_PREFIX.test(query)) return null;
  const cut = query.lastIndexOf('/') + 1;
  return { dir: query.slice(0, cut), filter: query.slice(cut) };
}

/** The folder a browse `dir` names, for the host to list: `../` from the worktree root, `~/` and `/` as typed. */
export function browseTarget(root: string | null, dir: string) {
  if (!dir.startsWith('../')) return dir;
  return root ? joinPath(root, dir) : null;
}

/** One level up from a browse `dir`, or null at its prefix: `../a/b/` → `../a/`, `../` → null, `/Users/` → `/`. */
export function parentDir(dir: string) {
  const prefix = dir.match(/^(?:(?:\.\.\/)+|~\/|\/)/)![0];
  const rest = dir.slice(prefix.length);
  if (!rest) return null;
  return prefix + rest.replace(/[^/]+\/$/, '');
}

/** Posix `base` + `rel`, `.` and `..` folded; `..` past `/` stays at `/`. A relative base keeps the `..` it can't fold. */
export function joinPath(base: string, rel: string) {
  const isAbsolute = base.startsWith('/') || rel.startsWith('/');
  const parts: string[] = [];
  for (const part of `${rel.startsWith('/') ? '' : base}/${rel}`.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..' && parts.length && parts.at(-1) !== '..') parts.pop();
    else if (part !== '..' || !isAbsolute) parts.push(part);
  }
  return `${isAbsolute ? '/' : ''}${parts.join('/')}`;
}

/** `target` relative to `root` when it sits inside it, else null. */
export function relativeTo(root: string, target: string) {
  const base = root.replace(/\/+$/, '');
  return target.startsWith(`${base}/`) ? target.slice(base.length + 1) : null;
}

/** The mention for `name` in the listed folder `abs` (shown as `dir`): inside the worktree the agent gets the relative path, outside the absolute one. */
export function fileMentionFor(
  root: string | null,
  dir: string,
  abs: string,
  name: string,
  isDir: boolean,
): FileMention {
  const full = joinPath(abs, name);
  const path = (root && relativeTo(root, full)) ?? full;
  return {
    kind: 'file',
    id: `file:${full}`,
    title: `${dir}${name}${isDir ? '/' : ''}`,
    path,
    isDir,
  };
}

/** A worktree file from the fuzzy list. */
export function worktreeMention(path: string): FileMention {
  return { kind: 'file', id: `file:${path}`, title: path, path, isDir: false };
}

/** Worktree files for a fuzzy query, best first; files opened or edited in the thread (`recent`, newest first) rank ahead of equal matches. */
export function rankFiles(
  files: string[],
  query: string,
  recent: string[],
  limit: number,
) {
  if (!query) {
    const listed = new Set(files);
    return [
      ...new Set([...recent.filter((f) => listed.has(f)), ...files]),
    ].slice(0, limit);
  }
  const bonus = new Map(
    recent.map((f, i) => [
      f,
      RECENT_BONUS + (recent.length - i) / recent.length,
    ]),
  );
  return fuzzyMatches(files, query, files.length)
    .map((m) => ({ file: m.file, score: m.score + (bonus.get(m.file) ?? 0) }))
    .sort((a, b) => b.score - a.score || a.file.length - b.file.length)
    .slice(0, limit)
    .map((m) => m.file);
}

/** Names in a listed folder that match `filter`, folders first; dotfiles only once the filter starts with `.`. */
export function browseEntries(
  dirs: string[],
  files: string[],
  filter: string,
  limit: number,
) {
  const visible = (names: string[]) =>
    filter.startsWith('.') ? names : names.filter((n) => !n.startsWith('.'));
  const entries = [
    ...visible(dirs).map((name) => ({ name, isDir: true })),
    ...visible(files).map((name) => ({ name, isDir: false })),
  ];
  if (!filter) return entries.slice(0, limit);
  const order = new Map(entries.map((e) => [e.name, e]));
  return fuzzyMatches([...order.keys()], filter, limit).map((m) =>
    order.get(m.file)!,
  );
}

/** What the composer holds for a file label: `@src/a.ts`, quoted when it has a space (`@"my notes/a.md"`). */
export const tokenText = (label: string) => `@${quoted(label)}`;

/** A mention typed inline: a file as its `tokenText`, a thread as `@` and its title, spaces and all. */
type InlineMention = { kind: 'file' | 'thread'; title: string };
const inlineText = (mention: InlineMention) =>
  mention.kind === 'file' ? tokenText(mention.title) : `@${mention.title}`;

/** Every picked mention typed as whole words, in order: what the composer colours and what sending rewrites. */
export function mentionTokens<T extends InlineMention>(
  text: string,
  mentions: T[],
) {
  const tokens = mentions.flatMap((mention) => {
    const token = inlineText(mention);
    const found: { mention: T; start: number; end: number }[] = [];
    for (
      let at = text.indexOf(token);
      at >= 0;
      at = text.indexOf(token, at + token.length)
    ) {
      const end = at + token.length;
      if (
        (at === 0 || /\s/.test(text[at - 1])) &&
        (end === text.length || /\s/.test(text[end]))
      )
        found.push({ mention, start: at, end });
    }
    return found;
  });
  return tokens
    .sort((a, b) => a.start - b.start)
    .filter((t, i, all) => i === 0 || t.start >= all[i - 1].end);
}

/**
 * The message as the harness reads it. Files: Claude expands `@path` itself (relative to its cwd, absolute, quoted with
 * spaces); Codex has no file input (0.163's `UserInput` is text, image, skill and app mentions), so it gets the bare path and
 * reads it. Threads: the quoted title, naming the digest sent with the message; a bare `@title` would send Claude looking
 * for a file by that name.
 */
export function serializeMentions(
  text: string,
  mentions: (FileMention | { kind: 'thread'; title: string })[],
  provider: Provider,
) {
  let out = '';
  let at = 0;
  for (const { mention, start, end } of mentionTokens(text, mentions)) {
    const path =
      mention.kind === 'file' ? quoted(mention.path) : `"${mention.title}"`;
    out +=
      text.slice(at, start) +
      (mention.kind === 'file' && provider === 'claude' ? `@${path}` : path);
    at = end;
  }
  return out + text.slice(at);
}

const quoted = (path: string) => (/\s/.test(path) ? `"${path}"` : path);

/** A sent `@label` back to what it names: a worktree path, or an absolute/home path for one outside it. */
export function mentionTarget(root: string, label: string) {
  const path = label.replace(/^"|"$/g, '').replace(/\/$/, '');
  if (path.startsWith('../'))
    return { isOutside: true, path: joinPath(root, path) };
  if (path.startsWith('/') || path.startsWith('~/'))
    return { isOutside: true, path };
  return { isOutside: false, path };
}
