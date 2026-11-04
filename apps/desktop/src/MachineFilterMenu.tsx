import { Devices, Window } from '@/icons';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  filteredWindowRoute,
  isShown,
  useMachineFilter,
} from './backends/machineFilter';
import { host } from './host';
import { DeviceIcon } from './remote/DeviceIcon';
import { TooltipIconButton } from './ui';

/** Which computers' threads this window lists, beside the project filter; hidden until another computer is paired. */
export function MachineFilterMenu({
  filter,
}: {
  filter: ReturnType<typeof useMachineFilter>;
}) {
  const { options, selected, toggle, clear } = filter;
  if (options.length < 2) return null;
  const only =
    selected.length === 1
      ? options.find((o) => o.id === selected[0])
      : undefined;
  const isFiltered = selected.length > 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <TooltipIconButton
            label="Filter by computer"
            hint={isFiltered ? shownNames(options, selected) : null}
            size="icon-xs"
            className={cn(
              'text-sidebar-foreground/50 hover:text-sidebar-foreground aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-foreground',
              isFiltered && 'bg-sidebar-accent text-sidebar-foreground',
            )}
          />
        }
      >
        {only ? (
          <DeviceIcon kind={only.kind} className="size-3.5" />
        ) : (
          <Devices />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Show threads from</DropdownMenuLabel>
          {options.map((o) => (
            <DropdownMenuCheckboxItem
              closeOnClick={false}
              key={o.id}
              checked={isShown(selected, o.id)}
              disabled={selected.length === 1 && selected[0] === o.id}
              onCheckedChange={() => toggle(o.id)}
            >
              <DeviceIcon kind={o.kind} className="size-3.5" />
              <span className="truncate">{o.name}</span>
              {o.status === 'offline' && (
                <span className="ml-auto type-caption text-subtle-foreground">
                  Offline
                </span>
              )}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        {isFiltered && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={clear}>
              Show all computers
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                void host.windows.open(filteredWindowRoute(selected))
              }
            >
              <Window />
              Open in new window
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const shownNames = (
  options: ReturnType<typeof useMachineFilter>['options'],
  selected: readonly string[],
) =>
  new Intl.ListFormat(undefined, { type: 'conjunction' }).format(
    options.filter((o) => selected.includes(o.id)).map((o) => o.name),
  );
