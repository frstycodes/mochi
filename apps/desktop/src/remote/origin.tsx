import { createContext, useContext } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { FollowedMachine, Scope } from '../host/types/remote';
import { DeviceIcon } from './DeviceIcon';

/** Where the thread on screen runs: this computer, or another one it follows (`RemoteThreadScope`). */
export type ThreadOrigin =
  | { kind: 'local' }
  | { kind: 'remote'; machine: FollowedMachine };

const LOCAL: ThreadOrigin = { kind: 'local' };

export const ThreadOriginContext = createContext<ThreadOrigin>(LOCAL);

export function useThreadOrigin() {
  return useContext(ThreadOriginContext);
}

/** The computer the thread on screen runs on; null for this one. */
export function useRemoteMachine() {
  const origin = useThreadOrigin();
  return origin.kind === 'remote' ? origin.machine : null;
}

/** Why something can't run on another computer's thread yet: it would otherwise act on this one. */
export const elsewhereReason = (machine: Pick<FollowedMachine, 'name'>) =>
  `Do this on ${machine.name} itself for now`;

/** Why another computer's thread can't do something that needs `scope` here; undefined once that computer gave it. */
export const missingScopeReason = (
  machine: Pick<FollowedMachine, 'name' | 'scopes'>,
  scope: Scope,
) =>
  machine.scopes.includes(scope)
    ? undefined
    : `${machine.name} hasn’t given this computer the ${scope} scope`;

/** The owning computer's icon beside a remote thread's title, with what that means. */
export function DeviceIndicator({
  machine,
}: {
  machine: Pick<FollowedMachine, 'name' | 'kind'>;
}) {
  const label = `Runs on ${machine.name}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={label}
          className="-mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground"
        >
          <DeviceIcon kind={machine.kind} className="size-4" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="flex-col items-start gap-0.5">
        <span className="block font-medium">{label}</span>
        <span className="block opacity-80">
          The agent works in this thread's folder on {machine.name}; this
          computer steers it
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
