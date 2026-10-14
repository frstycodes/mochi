import type { FollowedMachine } from '../host/types/remote.ts';

/** What's wrong with the connection, for a caption beside the machine's name; nothing while it's online. */
export function machineStatus(machine: FollowedMachine, now = new Date()): string | undefined {
  if (machine.status === 'online') return undefined;
  if (machine.status === 'connecting') return 'Connecting…';
  if (machine.status === 'refused') return machine.error ?? 'It refused this computer; pair again';
  if (!machine.lastSeenAt) return 'Offline';
  const seen = new Date(machine.lastSeenAt);
  const isToday = seen.toDateString() === now.toDateString();
  return `Offline since ${new Intl.DateTimeFormat(undefined, isToday ? { timeStyle: 'short' } : { dateStyle: 'medium', timeStyle: 'short' }).format(seen)}`;
}

/** How long ago it was last seen, as a messenger badge says it: 1m at least ("now" would read as online), 5m, 3h, 2d. */
export function presenceAge(lastSeenAt: number, now = Date.now()) {
  const minutes = Math.max(1, Math.floor((now - lastSeenAt) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / (24 * 60))}d`;
}
