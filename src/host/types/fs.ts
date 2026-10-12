import type { Manifest } from './manifest.ts';

// Every path is relative to `root` (posix separators); the main process rejects anything that resolves outside it.
export interface FsHost {
  /** Files under `root`, `.gitignore` honoured, sorted. */
  list(root: string): Promise<string[]>;
  read(root: string, path: string): Promise<FileContent>;
  /** Refuses with `conflict` when the file changed on disk since `baseMtimeMs`, unless `force`. */
  write(root: string, path: string, text: string, options: { baseMtimeMs: number; force?: boolean }): Promise<WriteResult>;
  watch(root: string): Promise<void>;
  unwatch(root: string): Promise<void>;
  onChange(listener: (change: FsChange) => void): () => void;
  editors(): Promise<Editor[]>;
  openIn(editor: Editor, root: string, path: string, line?: number): Promise<void>;
  /** Selects `path` in Finder (Explorer, the file manager); an empty `path` reveals `root` itself. */
  reveal(root: string, path: string): Promise<void>;
}

export type FileContent = { kind: 'text'; text: string; mtimeMs: number } | { kind: 'binary'; bytes: Uint8Array; mtimeMs: number };

export type WriteResult = { status: 'saved'; mtimeMs: number } | { status: 'conflict'; text: string; mtimeMs: number };

export interface FsChange {
  root: string;
  path: string;
}

export const EDITORS = ['vscode', 'cursor', 'zed'] as const;
export type Editor = (typeof EDITORS)[number];

export const fsMethods = {
  list: 'invoke',
  read: 'invoke',
  write: 'invoke',
  watch: 'invoke',
  unwatch: 'invoke',
  onChange: 'event',
  editors: 'invoke',
  openIn: 'invoke',
  reveal: 'invoke',
} satisfies Manifest<FsHost>;
