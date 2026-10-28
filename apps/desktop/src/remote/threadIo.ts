import { queryOptions } from '@tanstack/react-query';
import { useWorktreePath } from '../git/worktrees.ts';
import { threadCwd } from '../host/cwd.ts';
import { host } from '../host/index.ts';
import type {
  CommandData,
  FollowedMachine,
  RemoteCommand,
  Scope,
} from '../host/types/remote.ts';
import type { Thread } from '../model.ts';
import { queryKeys } from '../queryKeys.ts';
import { toWire } from './ids.ts';
import {
  missingScopeReason,
  useThreadOrigin,
  type ThreadOrigin,
} from './origin.tsx';

/**
 * Where a thread's panes read and write: a folder on this computer, or the computer that owns the thread, through its
 * commands. A pane never hands another computer's path to this one's file or git host.
 */
export type ThreadIo = LocalIo | RemoteIo;
export type LocalIo = { kind: 'local'; root: string };
export type RemoteIo = {
  kind: 'remote';
  machine: FollowedMachine;
  threadId: string;
};

/** A pane's io, or why that computer doesn't let this one in (`denied`); null when the thread has no folder. */
export type ThreadIoChoice =
  | ThreadIo
  | { kind: 'denied'; reason: string }
  | null;

/** The owning computer for a remote origin, if it gave this one `scope`; local origins get null. */
export function remoteIo(
  origin: ThreadOrigin,
  threadId: string,
  scope: Scope,
): RemoteIo | { kind: 'denied'; reason: string } | null {
  if (origin.kind === 'local') return null;
  const { machine } = origin;
  const reason = missingScopeReason(machine, scope);
  if (reason) return { kind: 'denied', reason };
  return { kind: 'remote', machine, threadId };
}

/** `localRoot` on this computer; the owner on another computer's thread, when the thread has a folder there. */
export function chooseThreadIo(
  thread: Pick<Thread, 'id' | 'repo' | 'live'>,
  origin: ThreadOrigin,
  localRoot: string | null,
  scope: Scope = 'code',
): ThreadIoChoice {
  if (origin.kind === 'local')
    return localRoot ? { kind: 'local', root: localRoot } : null;
  if (!thread.repo && !thread.live?.cwd) return null;
  return remoteIo(origin, thread.id, scope);
}

/** The thread's io for a pane needing `scope` on its owner: its worktree (else folder) here, or that computer. */
export function useThreadIo(
  thread: Pick<Thread, 'id' | 'repo' | 'live'>,
  scope: Scope = 'code',
) {
  const origin = useThreadOrigin();
  const worktree = useWorktreePath(thread.id);
  const localRoot =
    origin.kind === 'local' ? (worktree ?? threadCwd(thread)) : null;
  return chooseThreadIo(thread, origin, localRoot, scope);
}

/** What `command` answers with on its machine. */
export type DataOf<T extends RemoteCommand['type']> =
  T extends keyof CommandData ? CommandData[T] : undefined;

/** Runs `command` on that machine without a toast; rejects with the machine's reason. Needs no `MachinesProvider`. */
export async function askMachine<T extends RemoteCommand['type']>(
  machineId: string,
  command: Extract<RemoteCommand, { type: T }>,
): Promise<DataOf<T>> {
  const result = await host.remote.command(machineId, toWire(command));
  if (!result.isOk) throw new Error(result.error);
  return result.data as DataOf<T>;
}

/**
 * A read from the thread's owner, cached per machine and thread and polled every `pollMs` while it's online. Off for a local
 * io or an offline machine, which keeps the last answer on screen.
 */
export function remoteQuery<T>(
  io: ThreadIo | null,
  key: readonly unknown[],
  load: (io: RemoteIo) => Promise<T>,
  pollMs?: number,
) {
  const remote = io?.kind === 'remote' ? io : null;
  return queryOptions({
    queryKey: queryKeys.remote.read(remote?.machine.id ?? '', [
      remote?.threadId,
      ...key,
    ]),
    queryFn: () => load(remote!),
    enabled: !!remote && remote.machine.status === 'online',
    refetchInterval: pollMs ?? false,
  });
}

/** A decoded `read-image` answer, as the transcript's object URLs take it. */
export function base64Blob(base64: string, mediaType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mediaType });
}
