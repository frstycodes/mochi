import { Chat, Filter } from '@/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { ProjectIcon } from './ProjectIcon';
import { useProjectAt } from './projects';
import {
  NO_PROJECT,
  type ProjectFilterOption,
  type useProjectFilter,
} from './projectFilter';
import { TooltipIconButton } from './ui';

const ALL = ':all';

/** The thread list's project filter, on its first label's row; hidden while the profile's threads span fewer than two choices. */
export function ProjectFilterMenu({
  spaceId,
  filter,
  className,
}: {
  spaceId: string;
  filter: ReturnType<typeof useProjectFilter>;
  className?: string;
}) {
  const { options, hasNoProject, selected, select } = filter;
  const choiceCount = options.length + (hasNoProject ? 1 : 0);
  if (choiceCount < 2 && selected === null) return null;
  const current = options.find((o) => o.ref === selected);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <TooltipIconButton
          label="Filter by project"
          hint={
            current?.name ?? (selected === NO_PROJECT ? 'No project' : null)
          }
          size="icon-xs"
          className={cn(
            'text-sidebar-foreground/50 hover:text-sidebar-foreground aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-foreground',
            selected !== null && 'bg-sidebar-accent text-sidebar-foreground',
            className,
          )}
        >
          {!!current && <OptionIcon spaceId={spaceId} option={current} />}
          {selected === NO_PROJECT && <Chat />}
          {selected === null && <Filter />}
        </TooltipIconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Show threads in</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={selected ?? ALL}
          onValueChange={(value) => select(value === ALL ? null : value)}
        >
          <DropdownMenuRadioItem value={ALL}>
            All projects
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.ref} value={o.ref} title={o.path}>
              <OptionIcon spaceId={spaceId} option={o} />
              <span className="truncate">{o.name}</span>
            </DropdownMenuRadioItem>
          ))}
          {hasNoProject && (
            <DropdownMenuRadioItem value={NO_PROJECT}>
              <Chat />
              No project
            </DropdownMenuRadioItem>
          )}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OptionIcon({
  spaceId,
  option,
}: {
  spaceId: string;
  option: ProjectFilterOption;
}) {
  const project = useProjectAt(spaceId, option.path);
  return (
    <ProjectIcon name={option.name} icon={project?.icon} className="size-3.5" />
  );
}
