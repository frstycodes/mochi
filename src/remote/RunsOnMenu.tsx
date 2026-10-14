import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { DeviceIcon, THIS_DEVICE } from './DeviceIcon';
import { MachinePresence } from './MachinePresence';
import { useMachines } from './useMachines';

const HERE = '';

/**
 * Where a new thread runs: this computer, or another of yours, which then owns its worktree and agents for good. Shown only
 * once you've paired with another computer. `value`: a machine id, or null for this one.
 */
export function RunsOnMenu({ value, onChange }: { value: string | null; onChange: (machineId: string | null) => void }) {
  const { machines } = useMachines();
  if (machines.length === 0) return null;
  const picked = machines.find((m) => m.machine.id === value)?.machine;
  const label = picked?.name ?? 'This computer';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="xs" className="min-w-0 text-subtle-foreground hover:text-foreground" aria-label={`Runs on ${label}`}>
          <DeviceIcon kind={picked ? picked.kind : THIS_DEVICE} />
          <span className="truncate max-sm:hidden">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Runs on</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value ?? HERE} onValueChange={(id) => onChange(id === HERE ? null : id)}>
          <DropdownMenuRadioItem value={HERE}>
            <DeviceIcon kind={THIS_DEVICE} />
            This computer
          </DropdownMenuRadioItem>
          {machines.map(({ machine }) => {
            const reason = machine.status === 'online' && !machine.scopes.includes('manage') ? 'Can’t start threads from here' : undefined;
            return (
              <DropdownMenuRadioItem key={machine.id} value={machine.id} disabled={machine.status !== 'online' || !!reason}>
                <DeviceIcon kind={machine.kind} className="self-start mt-0.5" />
                <span className="flex min-w-0 flex-col">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">{machine.name}</span>
                    <MachinePresence machine={machine} />
                  </span>
                  {!!reason && <span className="truncate type-caption text-muted-foreground">{reason}</span>}
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
