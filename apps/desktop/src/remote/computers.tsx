import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { DeviceKind, FollowedMachine } from '../host/types/remote';
import { useNow } from '../useNow';
import { DeviceIcon } from './DeviceIcon';
import { PRESENCE_DOT } from './MachinePresence';
import { machineStatus, presenceAge } from './status';
import { useMachines } from './useMachines';
import { THIS_COMPUTER, useThisBackend } from './useThisBackend';

/** A computer a project can have a copy on: this one (`id` null) or one you follow. */
export interface Computer {
  id: string | null;
  name: string;
  kind: DeviceKind | undefined;
  machine?: FollowedMachine;
}

/** This computer, then every computer it follows. */
export function useComputers(): Computer[] {
  const here = useThisBackend();
  const { machines } = useMachines();
  return [
    { id: null, name: here.name, kind: here.kind },
    ...machines.map(({ machine }) => ({
      id: machine.id,
      name: machine.name,
      kind: machine.kind,
      machine,
    })),
  ];
}

/** Why a thread can't start there right now; undefined when it can. */
export function startBlocker(computer: Computer) {
  const { machine } = computer;
  if (!machine) return undefined;
  if (machine.status !== 'online') return `${machine.name} is offline`;
  if (!machine.scopes.includes('manage'))
    return `${machine.name} doesn’t let this computer start threads`;
  return undefined;
}

/**
 * A computer's device icon with its presence as a messenger badge on the corner: a dot while it's online, connecting or
 * refused, how long since it was seen while it's offline. This computer gets no badge. The words are in the tooltip.
 */
export function ComputerAvatar({
  computer,
  size = 'sm',
  surface = 'popover',
  className,
}: {
  computer: Computer;
  size?: keyof typeof AVATAR_SIZES;
  /** What it sits on, so the badge's cut-out matches. */
  surface?: keyof typeof SURFACES;
  className?: string;
}) {
  const now = useNow(15_000);
  const { machine } = computer;
  const icon = (
    <DeviceIcon kind={computer.kind} className={AVATAR_SIZES[size].icon} />
  );
  if (!machine)
    return (
      <span className={cn('inline-flex shrink-0', className)}>{icon}</span>
    );
  const label =
    machine.status === 'online'
      ? 'Online'
      : machineStatus(machine, new Date(now))!;
  // A 16px device has no room for the age beside it; its offline dot says the same, the tooltip the rest.
  const age =
    size !== 'sm' &&
    machine.status === 'offline' &&
    machine.lastSeenAt !== undefined
      ? presenceAge(machine.lastSeenAt, now)
      : undefined;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={`${computer.name}, ${label}`}
            className={cn('relative inline-flex shrink-0', className)}
          />
        }
      >
        {icon}
        {age ? (
          <span
            aria-hidden
            className={cn(
              'absolute -right-2 -bottom-1.5 rounded-full bg-muted px-1 text-[10px] leading-3.5 font-bold text-muted-foreground tabular-nums ring-2',
              HAIRLINE,
              SURFACES[surface].ring,
            )}
          >
            {age}
          </span>
        ) : (
          <span
            aria-hidden
            className={cn(
              'absolute -right-0.5 -bottom-0.5 rounded-full ring-2',
              HAIRLINE,
              AVATAR_SIZES[size].dot,
              SURFACES[surface].ring,
              // The hollow offline dot is filled with the surface, so the device doesn't show through it.
              machine.status === 'offline' && SURFACES[surface].bg,
              PRESENCE_DOT[machine.status],
            )}
          />
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Says which computer is the one in front of you; it outranks every other fact on a computer's line. Nothing for another
 * computer, or while this one's name already says it.
 */
export function HereBadge({ computer }: { computer: Computer }) {
  if (computer.id !== null || computer.name === THIS_COMPUTER) return null;
  return (
    <Badge variant="secondary" className="shrink-0">
      This computer
    </Badge>
  );
}

/** 16px in chips and rows, 20px in menus, 32px in lists of computers. */
const AVATAR_SIZES = {
  sm: { icon: 'size-4', dot: 'size-2' },
  md: { icon: 'size-5', dot: 'size-2' },
  lg: { icon: 'size-8', dot: 'size-2.5' },
} satisfies Record<string, Record<'icon' | 'dot', string>>;

/** The badge's ring is the surface's colour, so it reads as a cut-out of the icon under it. */
const SURFACES = {
  popover: { ring: 'ring-popover', bg: 'bg-popover' },
  card: { ring: 'ring-card', bg: 'bg-card' },
  background: { ring: 'ring-background', bg: 'bg-background' },
} satisfies Record<string, Record<'ring' | 'bg', string>>;

/** A subtle edge, so a faint pill or dot still reads against the device under it. */
const HAIRLINE =
  'shadow-[inset_0_0_0_0.5px_color-mix(in_oklab,var(--foreground)_25%,transparent)]';
