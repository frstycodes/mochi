import { runPrAction } from '../git/prAction.ts';
import { useWorktreePath } from '../git/worktrees.ts';
import { threadCwd } from '../host/cwd.ts';
import { host } from '../host/index.ts';
import type { PrInfo, PrReview, SyncResult } from '../host/types/git.ts';
import type {
  FollowedMachine,
  PrAction,
  RemoteCommand,
  Scope,
} from '../host/types/remote.ts';
import type { PortsListing } from '@mochi/domain/host/types/ports';
import type { Thread } from '../model.ts';
import { useProfiles } from '../profiles.ts';
import { parseRemoteThreadId } from './ids.ts';
import { askMachine } from './threadIo.ts';

/**
 * What a thread's PR tab, worktree menu, rewind preview and dev servers call: this computer's host in the thread's folder for
 * its own thread, the owning computer's commands for another's. Nothing here hands this computer's host another's path.
 */
export interface ThreadCalls {
  /** Where the calls go, for query keys: the folder here, the machine-aware thread id for another computer's. */
  key: string;
  pr(): Promise<PrInfo | null>;
  prReview(number: number): Promise<PrReview | null>;
  prAct(number: number, action: PrAction): Promise<void>;
  sync(): Promise<SyncResult>;
  diskUsage(): Promise<number>;
  ports(): Promise<PortsListing>;
  killPort(pid: number): Promise<void>;
}

export function localCalls(
  cwd: string,
  base: string | undefined,
  githubUser: string | undefined,
): ThreadCalls {
  return {
    key: cwd,
    pr: () => host.git.pr(cwd, githubUser),
    prReview: (number) => host.git.prReview(cwd, number, githubUser),
    prAct: (number, action) => runPrAction(cwd, number, action, githubUser),
    sync: () => host.git.sync(cwd, base),
    diskUsage: () => host.git.diskUsage(cwd),
    ports: async () => (await host.ports.list([cwd]))[0] ?? { ports: [] },
    killPort: (pid) => host.ports.kill(pid),
  };
}

type Ask = typeof askMachine;

export function remoteCalls(
  machineId: string,
  threadId: string,
  ask: Ask,
): ThreadCalls {
  const run = async (command: RemoteCommand) => {
    await ask(machineId, command);
  };
  return {
    key: threadId,
    pr: async () =>
      (await ask(machineId, { type: 'pr-status', threadId })) ?? null,
    prReview: (number) =>
      ask(machineId, { type: 'pr-review', threadId, number }),
    prAct: (number, action) => run({ type: 'pr', threadId, number, action }),
    sync: () => ask(machineId, { type: 'sync', threadId }),
    diskUsage: async () =>
      (await ask(machineId, { type: 'disk-usage', threadId })).bytes,
    ports: () => ask(machineId, { type: 'ports', threadId }),
    killPort: (pid) => run({ type: 'port-kill', threadId, pid }),
  };
}

/** Why another computer won't take a call that needs `scope`; undefined when it will. */
export const missingScope = (
  machine: Pick<FollowedMachine, 'name' | 'scopes'>,
  scope: Scope,
) =>
  machine.scopes.includes(scope)
    ? undefined
    : `${machine.name} hasn’t given this computer the ${scope} scope`;

/**
 * The thread's calls, by the computer its id names; null while it has no folder to run them in. Reads no machines context: PR
 * hover cards call it on every row, and a stream event must not re-render them.
 */
export function useThreadCalls(thread: Thread): ThreadCalls | null {
  const worktree = useWorktreePath(thread.id);
  const githubUser =
    useProfiles().find((p) => p.id === thread.spaceId)?.github || undefined;
  const remote = parseRemoteThreadId(thread.id);
  if (remote)
    return thread.repo || thread.live?.cwd
      ? remoteCalls(remote.machineId, thread.id, askMachine)
      : null;
  const cwd = worktree ?? threadCwd(thread);
  return cwd ? localCalls(cwd, thread.repo?.base, githubUser) : null;
}
