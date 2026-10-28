import type { FollowedMachine } from '../host/types/remote.ts';

/**
 * Why this computer can't ask the side chat of a thread running on `machine` right now, or null when it can. The side chat
 * runs there, on its agent and account (`side-chat`, `operate` scope); reading its answers needs only `read`, as the thread
 * itself does, so a blocked side chat still shows its history.
 */
export function remoteSideChatBlocker(
  machine: Pick<FollowedMachine, 'name' | 'status' | 'scopes'>,
): string | null {
  if (machine.status === 'connecting') return `Connecting to ${machine.name}`;
  if (machine.status !== 'online') return `${machine.name} is offline`;
  if (!machine.scopes.includes('operate'))
    return `${machine.name} doesn’t let this computer ask its side chat`;
  return null;
}
