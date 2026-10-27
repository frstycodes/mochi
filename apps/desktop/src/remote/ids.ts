import type { RemoteCommand } from '../host/types/remote.ts';

/** Ids of another computer's threads as this one holds them (`remote/mirror.ts`), and back for the wire. */

const SEPARATOR = '~';

/** A thread on another computer as this one addresses it: `machineId~threadId`. */
export const remoteThreadId = (machineId: string, threadId: string) =>
  `${machineId}${SEPARATOR}${threadId}`;

/** The machine and its own id for a machine-aware id; null for this computer's own. */
export function parseRemoteThreadId(
  id: string,
): { machineId: string; threadId: string } | null {
  const at = id.indexOf(SEPARATOR);
  if (at <= 0) return null;
  return { machineId: id.slice(0, at), threadId: id.slice(at + 1) };
}

/** A thread or queue id as its machine knows it: what goes out in a command or a URL. */
export const wireId = (id: string) => parseRemoteThreadId(id)?.threadId ?? id;

/** The command as its machine reads it (`useMachines` run and ask): the machine-aware ids the mirror hands out, back to that machine's own. */
export function toWire<C extends RemoteCommand>(command: C): C {
  const wire = { ...command };
  if ('threadId' in wire && wire.threadId !== undefined)
    wire.threadId = wireId(wire.threadId);
  if ('queueId' in wire) wire.queueId = wireId(wire.queueId);
  if ('queueIds' in wire && wire.queueIds)
    wire.queueIds = wire.queueIds.map(wireId);
  return wire;
}
