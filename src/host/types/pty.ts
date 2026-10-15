import type { Manifest } from './manifest.ts';

export interface PtySpawnOptions {
  cwd: string;
  cols: number;
  rows: number;
  /** Typed into the shell once it starts, so the shell outlives the command (Ctrl C keeps the tab usable). */
  command?: string;
  /** Exported as `PORT` so parallel worktrees don't fight over one dev-server port. */
  port?: number;
  /** The thread whose pane opened it; settling that thread kills it. */
  threadId: string;
}

export interface PtyData {
  id: string;
  data: string;
}

export interface PtyExit {
  id: string;
  exitCode: number;
}

export interface PtyHost {
  spawn(options: PtySpawnOptions): Promise<{ id: string }>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  kill(id: string): Promise<void>;
  onData(listener: (event: PtyData) => void): () => void;
  onExit(listener: (event: PtyExit) => void): () => void;
}

export const ptyMethods = {
  spawn: 'invoke',
  write: 'invoke',
  resize: 'invoke',
  kill: 'invoke',
  onData: 'event',
  onExit: 'event',
} satisfies Manifest<PtyHost>;
