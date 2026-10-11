import type { Manifest } from './manifest.ts';

export interface ListeningPort {
  port: number;
  pid: number;
  command: string;
  /** Epoch ms the process started, from `ps etime`. */
  startedAt: number;
}

export interface RunTarget {
  name: string;
  command: string;
  source: 'package.json' | 'launch.json';
  port?: number;
}

export interface PortsHost {
  /** Listening TCP ports of processes whose working directory is inside `cwd`. */
  list(cwd: string): Promise<ListeningPort[]>;
  /** Only PIDs returned by the latest `list`; the UI confirms first. */
  kill(pid: number): Promise<void>;
  /** A free port reserved for `key` (a thread id) for the app's lifetime. */
  allocate(key: string): Promise<number>;
  /** Dev-server commands from `cwd`'s package.json scripts and .claude/launch.json. */
  targets(cwd: string): Promise<RunTarget[]>;
}

export const portsMethods = {
  list: 'invoke',
  kill: 'invoke',
  allocate: 'invoke',
  targets: 'invoke',
} satisfies Manifest<PortsHost>;
