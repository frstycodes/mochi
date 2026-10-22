import type { Manifest } from './manifest.ts';

export interface ListeningPort {
  port: number;
  pid: number;
  command: string;
  /** Epoch ms the process started, from `ps etime`. */
  startedAt: number;
}

/** One watched cwd's share of a scan: its ports, or why its cwd was refused. */
export type PortsListing = { ports: ListeningPort[] } | { error: string };

export interface RunTarget {
  name: string;
  command: string;
  source: 'package.json' | 'launch.json';
  port?: number;
}

export interface PortsHost {
  /** Listening TCP ports of processes whose working directory is inside each of `cwds`, from one system-wide scan. */
  list(cwds: string[]): Promise<PortsListing[]>;
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
