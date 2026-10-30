import { useNow } from '../useNow';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { FollowedMachine } from '../host/types/remote';
import { machineStatus, presenceAge } from './status';

/**
 * Whether another computer is there, like a messenger's badge: a dot while it's online (amber when it refused this one,
 * dim while connecting), how long since it was last seen while it's offline. The words are in the tooltip, online ones
 * naming the route: direct (LAN or Tailscale) or via relay.
 */
export function MachinePresence({
  machine,
  className,
}: {
  machine: FollowedMachine;
  className?: string;
}) {
  const now = useNow(15_000);
  const label =
    machine.status === 'online'
      ? `Online · ${machine.route === 'lan' ? 'direct' : 'via relay'}`
      : machineStatus(machine, new Date(now))!;
  const age =
    machine.status === 'offline' && machine.lastSeenAt !== undefined
      ? presenceAge(machine.lastSeenAt, now)
      : undefined;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={label}
          className={cn('inline-flex shrink-0 items-center', className)}
        >
          {age ? (
            <span className="tabular type-caption font-normal text-subtle-foreground">
              {age}
            </span>
          ) : (
            <span
              aria-hidden
              className={cn(
                'size-2 rounded-full',
                PRESENCE_DOT[machine.status],
              )}
            />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** The presence dot by status, also on a row's device icon (`Sidebar.tsx`). */
export const PRESENCE_DOT = {
  online: 'bg-success',
  connecting: 'bg-subtle-foreground/60 motion-safe:animate-pulse',
  offline: 'border border-subtle-foreground',
  refused: 'bg-warning',
} satisfies Record<FollowedMachine['status'], string>;
