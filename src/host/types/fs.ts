import type { Manifest } from './manifest.ts';

// Every path is relative to `root` (posix separators); the main process rejects anything that resolves outside it.
export interface FsHost {
  /** Files under `root`, `.gitignore` honoured, sorted. */
  list(root: string): Promise<string[]>;
  read(root: string, path: string): Promise<FileContent>;
  /** Refuses with `conflict` when the file changed on disk since `baseMtimeMs`, unless `force`. */
  write(root: string, path: string, text: string, options: { baseMtimeMs: number; force?: boolean }): Promise<WriteResult>;
  /** Searches file contents under `root` (`.gitignore` honoured), pushing each file's hits through `onSearchHits` under `id`; resolves when done or cancelled. */
  search(root: string, id: string, pattern: string, options: SearchOptions): Promise<SearchSummary>;
  cancelSearch(id: string): Promise<void>;
  onSearchHits(listener: (hits: SearchHits) => void): () => void;
  editors(): Promise<Editor[]>;
  openIn(editor: Editor, root: string, path: string, line?: number): Promise<void>;
  /** Selects `path` in Finder (Explorer, the file manager); an empty `path` reveals `root` itself. */
  reveal(root: string, path: string): Promise<void>;
  /** The OS folder picker, opened at `defaultPath` (`~` allowed); null when dismissed. The web build only learns the folder's name. */
  pickFolder(defaultPath?: string): Promise<string | null>;
  /** The folder at `path` (`~` allowed) as an absolute path with its subfolders' names, hidden ones left out; null when it isn't a folder. */
  folders(path: string): Promise<{ path: string; names: string[] } | null>;
  /** The folder at `path` (`~` allowed) as an absolute path with its subfolders and files by name, hidden ones included; null when it isn't a folder. */
  entries(path: string): Promise<{ path: string; dirs: string[]; files: string[] } | null>;
}

/** A file on disk as the fs host takes it: a folder (`~` allowed) and a path inside it, '' for the folder itself. */
export interface DiskFile {
  root: string;
  path: string;
}

export type FileContent = { kind: 'text'; text: string; mtimeMs: number } | { kind: 'binary'; bytes: Uint8Array; mtimeMs: number };

export type WriteResult = { status: 'saved'; mtimeMs: number } | { status: 'conflict'; text: string; mtimeMs: number };

export interface SearchOptions {
  isCaseSensitive: boolean;
  isRegex: boolean;
  isWholeWord: boolean;
}

export interface SearchLine {
  line: number;
  /** A one-row preview of the line, leading indent dropped; `isCut` when text before it was dropped too. */
  text: string;
  isCut: boolean;
  /** Match ranges inside `text`. */
  ranges: [number, number][];
  /** The first match's columns in the original line, for selecting it in the editor. */
  column: [number, number];
}

export interface SearchHits {
  id: string;
  path: string;
  lines: SearchLine[];
}

export interface SearchSummary {
  /** Stopped at the match cap before every file was read. */
  isTruncated: boolean;
}

export const EDITORS = ['vscode', 'cursor', 'zed'] as const;
export type Editor = (typeof EDITORS)[number];

export const fsMethods = {
  list: 'invoke',
  read: 'invoke',
  write: 'invoke',
  search: 'invoke',
  cancelSearch: 'invoke',
  onSearchHits: 'event',
  editors: 'invoke',
  openIn: 'invoke',
  reveal: 'invoke',
  pickFolder: 'invoke',
  folders: 'invoke',
  entries: 'invoke',
} satisfies Manifest<FsHost>;
