import { cn } from '@/lib/utils';
import { DeviceIcon } from './DeviceIcon';
import { parseRemoteThreadId } from './ids';
import { PRESENCE_DOT } from './MachinePresence';
import { useFollowedMachine } from './useMachines';

/**
 * Where a thread runs, on its row (sidebar, switcher): another computer's device icon, with that computer's presence dot in
 * the corner while it isn't online. Nothing for this computer's own.
 */
export function ThreadMachineMark({
  threadId,
  surfaceClass = 'bg-sidebar ring-sidebar',
}: {
  threadId: string;
  /** The background the mark sits on, for the presence dot's cut-out. */
  surfaceClass?: string;
}) {
  const machine = useFollowedMachine(parseRemoteThreadId(threadId)?.machineId);
  if (!machine) return null;
  const isOnline = machine.status === 'online';
  return (
    <span className="relative inline-flex shrink-0">
      <DeviceIcon
        kind={machine.kind}
        className={cn('size-3.5', !isOnline && 'opacity-60')}
      />
      {!isOnline && (
        <span
          aria-hidden
          className={cn(
            'absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-1',
            surfaceClass,
            PRESENCE_DOT[machine.status],
          )}
        />
      )}
      <span className="sr-only">
        On {machine.name}
        {isOnline ? '' : `, ${machine.status}`}
      </span>
    </span>
  );
}
