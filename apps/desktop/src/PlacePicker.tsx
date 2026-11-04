import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  ArrowDown,
  ArrowUp,
  Chat,
  Check,
  ChevronDown,
  Download,
  FolderPlus,
  GitBranch,
  Search,
} from '@/icons';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { AddProject } from './AddProject';
import {
  copyBlocker,
  isAway,
  queuedClone,
  useCopyActions,
  useOutbox,
} from './copyActions';
import { isMod } from './keys';
import { MetaChip } from './MetaChip';
import {
  copyFact,
  isOtherRepo,
  projectOf,
  useCopyStatus,
  type ProjectCopy,
  type ProjectWithCopies,
} from './projectCopies';
import { ProjectIcon } from './ProjectIcon';
import { refreshProjects, type Place } from './projects';
import { ComputerAvatar, HereBadge, type Computer } from './remote/computers';
import { ScrollDock } from './ScrollDock';
import { useHarnessSelector } from './store';

interface PickerProps {
  projects: ProjectWithCopies[];
  computers: Computer[];
  place: Place;
  onChoose: (place: Place) => void;
}

/**
 * The place as one chip: the project, then the computer it runs on, named only once you have more than one. Scroll or drag
 * over it to step through the favorites, ending at No project.
 */
export function PlaceChip(props: PickerProps) {
  const { projects, computers, place, onChoose } = props;
  const spaceId = useHarnessSelector((s) => s.spaceId);
  const [isOpen, setOpen] = useState(false);
  const project = projectOf(projects, place.machineId, place.ref);
  const computer = computers.find((c) => c.id === place.machineId);
  const name = project?.name ?? 'No project';
  const isMulti = computers.length > 1;
  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        setOpen(open);
        if (open) refreshProjects(spaceId);
      }}
    >
      <ScrollDock
        label="Project"
        value={project?.key ?? NO_PROJECT}
        onChange={(key) => {
          const next = projects.find((p) => p.key === key);
          onChoose(
            next
              ? placeIn(next, computers)
              : { machineId: place.machineId, ref: null },
          );
        }}
        items={dockStops(projects, project)}
      >
        <PopoverTrigger
          render={
            <MetaChip
              className="max-w-80 gap-1.5"
              aria-label={`Where: ${name}${isMulti && computer ? ` on ${computer.name}` : ''}`}
            />
          }
        >
          {project ? (
            <ProjectIcon name={project.name} icon={project.icon} />
          ) : (
            <Chat />
          )}
          <span className="max-w-32 shrink-0 truncate">{name}</span>
          {isMulti && !!computer && (
            <>
              <span className="text-subtle-foreground">on</span>
              <ComputerAvatar computer={computer} />
              <span className="min-w-0 truncate max-sm:hidden">
                {computer.name}
              </span>
            </>
          )}
          <ChevronDown data-icon="inline-end" />
        </PopoverTrigger>
      </ScrollDock>
      <PopoverContent
        align="start"
        className={cn(
          'max-h-(--available-height) overflow-y-auto p-0',
          isMulti ? 'w-[min(38rem,calc(100vw-2rem))]' : 'w-80',
        )}
      >
        <PlacePicker
          {...props}
          onChoose={(next) => {
            onChoose(next);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Two columns: projects, then the computers that project is on, each with its copy's state in words. ↑/↓ move within a
 * column, →/← switch columns, Enter picks, Mod+1–9 picks a project where it last ran. With one computer there's no second
 * column: picking a project is the whole choice. Add project… adds on this computer.
 */
export function PlacePicker({
  projects,
  computers,
  place,
  onChoose,
}: PickerProps) {
  const [isAdding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const chosen = projectOf(projects, place.machineId, place.ref);
  const [projectKey, setProjectKey] = useState(chosen?.key ?? NO_PROJECT);
  const [column, setColumn] = useState<'project' | 'computer'>('project');
  const [computerId, setComputerId] = useState(place.machineId);
  const rows = [
    ...matching(projects, query),
    ...(query ? [] : [noProjectRow(computers)]),
  ];
  const active = rows.find((r) => r.key === projectKey) ?? rows[0];
  const isMulti = computers.length > 1;
  const pickable = active ? active.copies.filter(isPickable) : [];
  const activeCopy =
    pickable.find((c) => c.machineId === computerId) ??
    (active && defaultCopy(active, computers));

  if (isAdding)
    return (
      <AddProject
        onBack={() => setAdding(false)}
        onAdded={(added) => onChoose({ machineId: null, ref: added.ref })}
      />
    );

  const choose = (row: ProjectWithCopies, copy: ProjectCopy) =>
    onChoose({
      machineId: copy.machineId,
      ref: row.key === NO_PROJECT ? null : copy.ref,
    });
  const point = (row: ProjectWithCopies) => {
    setProjectKey(row.key);
    setComputerId(defaultCopy(row, computers)?.machineId ?? null);
  };
  const moveProject = (step: number) => {
    const next = active && rows[rows.indexOf(active) + step];
    if (next) point(next);
  };
  const moveComputer = (step: number) => {
    const next = activeCopy && pickable[pickable.indexOf(activeCopy) + step];
    if (next) setComputerId(next.machineId);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const step = STEPS[e.key];
    if (step) {
      e.preventDefault();
      return column === 'project' ? moveProject(step) : moveComputer(step);
    }
    if (e.key === 'ArrowRight' && isMulti && column === 'project') {
      e.preventDefault();
      return setColumn('computer');
    }
    if (e.key === 'ArrowLeft' && column === 'computer') {
      e.preventDefault();
      return setColumn('project');
    }
    if (e.key === 'Enter' && active && activeCopy) {
      e.preventDefault();
      return choose(active, activeCopy);
    }
    chooseByNumber(e);
  };
  // Runs before the window's pinned-thread listener, which skips events already prevented.
  const chooseByNumber = (e: KeyboardEvent) => {
    if (!isMod(e) || e.shiftKey || e.altKey || !/^[1-9]$/.test(e.key)) return;
    const row = rows[Number(e.key) - 1];
    const copy = row && defaultCopy(row, computers);
    if (!row || !copy) return;
    e.preventDefault();
    choose(row, copy);
  };

  return (
    // Rows aren't focusable: pressing one leaves focus in the search field, so the keys keep working after a click.
    <div
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        if ((e.target as Element).closest('[role=option]')) e.preventDefault();
      }}
    >
      <label className="flex h-11 items-center gap-2 border-b px-3">
        <Search className="size-4 text-subtle-foreground" aria-hidden />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setColumn('project');
          }}
          placeholder="Search projects"
          aria-label="Search projects"
          className="min-w-0 flex-1 bg-transparent type-body outline-none placeholder:text-subtle-foreground"
        />
      </label>
      <div className={cn('grid', isMulti && 'sm:grid-cols-[1fr_1.15fr]')}>
        <ul
          role="listbox"
          aria-label="Projects"
          className={cn(
            'flex max-h-72 flex-col gap-0.5 overflow-y-auto p-1.5',
            // Stacked on a phone: both columns and the footer fit the screen.
            isMulti && 'max-sm:max-h-36',
          )}
        >
          {rows.length === 0 && (
            <li className="px-2 py-6 text-center type-body text-subtle-foreground">
              No project matches “{query.trim()}”.
            </li>
          )}
          {rows.map((row) => (
            <ProjectOption
              key={row.key}
              project={row}
              computers={computers}
              isActive={row === active}
              isFocused={row === active && column === 'project'}
              onPoint={() => row !== active && point(row)}
              onChoose={() => {
                const copy = defaultCopy(row, computers);
                if (row !== active) point(row);
                if (isMulti) return setColumn('computer');
                if (copy) choose(row, copy);
              }}
            />
          ))}
        </ul>
        {isMulti && !!active && (
          <ul
            role="listbox"
            aria-label={`Computers with ${active.name}`}
            className="flex max-h-72 flex-col gap-0.5 overflow-y-auto border-t p-1.5 max-sm:max-h-36 sm:border-t-0 sm:border-l"
          >
            {computers.map((c) => {
              const copy = active.copies.find((k) => k.machineId === c.id);
              if (!copy)
                return (
                  <MissingCopyOption
                    key={c.id ?? HERE}
                    project={active}
                    computer={c}
                  />
                );
              return (
                <CopyOption
                  key={c.id ?? HERE}
                  project={active}
                  copy={copy}
                  computer={c}
                  isActive={copy === activeCopy}
                  isFocused={copy === activeCopy && column === 'computer'}
                  onChoose={() => choose(active, copy)}
                />
              );
            })}
          </ul>
        )}
      </div>
      <PickerFooter isMulti={isMulti} onAddProject={() => setAdding(true)} />
    </div>
  );
}

const HERE = 'here';
const STEPS: Partial<Record<string, number>> = { ArrowDown: 1, ArrowUp: -1 };

function ProjectOption({
  project,
  computers,
  isActive,
  isFocused,
  onPoint,
  onChoose,
}: {
  project: ProjectWithCopies;
  computers: Computer[];
  isActive: boolean;
  isFocused: boolean;
  onPoint: () => void;
  onChoose: () => void;
}) {
  const ref = useActiveIntoView<HTMLLIElement>(isActive);
  const isNone = project.key === NO_PROJECT;
  const holders = computers.filter((c) =>
    project.copies.some((k) => k.machineId === c.id),
  );
  return (
    <li
      ref={ref}
      role="option"
      aria-selected={isActive}
      onPointerMove={onPoint}
      onClick={onChoose}
      className={cn(
        'flex h-9 shrink-0 cursor-default items-center gap-2.5 rounded-md px-2 type-body',
        optionTone(isActive, isFocused),
      )}
    >
      {isNone ? (
        <Chat className="size-4 text-subtle-foreground" />
      ) : (
        <ProjectIcon name={project.name} icon={project.icon} />
      )}
      <span className="min-w-0 flex-1 truncate">{project.name}</span>
      {/* Where it lives, at a glance: one device per computer that has it. */}
      {!isNone && computers.length > 1 && (
        <span
          className="flex shrink-0 items-center gap-1"
          aria-label={`On ${holders.map((c) => c.name).join(', ')}`}
        >
          {holders.map((c) => (
            <ComputerAvatar
              key={c.id ?? HERE}
              computer={c}
              className={cn(
                c.machine && c.machine.status !== 'online' && 'opacity-50',
              )}
            />
          ))}
        </span>
      )}
    </li>
  );
}

/** One computer's copy of the active project: which computer, then its branch and state in words. */
function CopyOption({
  project,
  copy,
  computer,
  isActive,
  isFocused,
  onChoose,
}: {
  project: ProjectWithCopies;
  copy: ProjectCopy;
  computer: Computer;
  isActive: boolean;
  isFocused: boolean;
  onChoose: () => void;
}) {
  const ref = useActiveIntoView<HTMLLIElement>(isActive);
  const isMissing = !!copy.local?.isMissing;
  return (
    <li
      ref={ref}
      role="option"
      aria-selected={isActive}
      aria-disabled={isMissing || undefined}
      onClick={() => !isMissing && onChoose()}
      className={cn(
        'flex min-h-12 shrink-0 cursor-default items-center gap-2.5 rounded-md px-2 py-1.5',
        optionTone(isActive, isFocused),
        isMissing && 'opacity-60',
      )}
    >
      <ComputerAvatar computer={computer} size="md" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5 type-body">
          <span className="truncate text-foreground">{computer.name}</span>
          <HereBadge computer={computer} />
        </span>
        {project.key === NO_PROJECT ? (
          <span className="truncate type-caption text-subtle-foreground">
            No folder, branch or files
          </span>
        ) : (
          <CopyFactLine copy={copy} project={project} />
        )}
      </span>
      {isActive && <Check className="size-4 shrink-0 text-foreground" />}
    </li>
  );
}

/**
 * A computer without a copy: listed so the column always reads the same, never picked. A project with a remote offers
 * Clone here, which clones into that computer's projects folder; it then lists as a copy.
 */
function MissingCopyOption({
  project,
  computer,
}: {
  project: ProjectWithCopies;
  computer: Computer;
}) {
  const { clone } = useCopyActions();
  const { outbox } = useOutbox();
  const [isCloning, setCloning] = useState(false);
  const blocker = copyBlocker(computer);
  const isQueued = !!queuedClone(outbox, project, computer);
  const canClone = !!project.origin && project.key !== NO_PROJECT && !isQueued;
  return (
    <li className="flex min-h-12 shrink-0 items-center gap-2.5 rounded-md px-2 py-1.5">
      <ComputerAvatar computer={computer} size="md" className="opacity-40" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate type-body text-subtle-foreground">
          {computer.name}
        </span>
        <span className="truncate type-caption text-subtle-foreground">
          {missingCopyText(isCloning, isQueued)}
        </span>
      </span>
      {canClone && (
        <Tooltip>
          {/* A span keeps the tooltip when the button is disabled. */}
          <TooltipTrigger render={<span className="shrink-0" />}>
            <Button
              size="xs"
              variant="outline"
              disabled={!!blocker || isCloning}
              onClick={() => {
                setCloning(true);
                void clone(project, computer).finally(() => setCloning(false));
              }}
            >
              <Download />
              Clone here
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {blocker ??
              (isAway(computer)
                ? `${computer.name} is offline: it clones ${project.origin} when it’s back`
                : `Clones ${project.origin} into ${computer.name}’s projects folder`)}
          </TooltipContent>
        </Tooltip>
      )}
    </li>
  );
}

function missingCopyText(isCloning: boolean, isQueued: boolean) {
  if (isCloning) return 'Cloning…';
  if (isQueued) return 'Clones when it’s back online';
  return 'Not on this computer';
}

/** A copy's state with its branch as a branch, not as the words "On main"; nothing while it's read. */
export function CopyFactLine({
  copy,
  project,
  className = 'type-caption',
}: {
  copy: ProjectCopy;
  project: ProjectWithCopies;
  className?: string;
}) {
  const status = useCopyStatus(copy);
  const { origin } = project;
  if (copy.local?.isMissing)
    return (
      <span className={cn('truncate', WARNING_TEXT, className)}>
        Folder not found; relocate it in Projects
      </span>
    );
  if (isOtherRepo(copy, project))
    return (
      <span className={cn('truncate', WARNING_TEXT, className)}>
        Different repo: {copy.origin}
      </span>
    );
  if (status === undefined)
    return <span className={cn('h-4', className)} aria-hidden />;
  return (
    <span className={cn('truncate text-muted-foreground', className)}>
      {!!status && (
        <>
          <GitBranch
            aria-label="branch"
            className="mr-0.5 inline size-3.5 align-[-0.15em]"
          />
          <span className="text-foreground/85">{status.branch}</span>
          {' · '}
        </>
      )}
      {copyFact(status, origin)}
    </span>
  );
}

/** Warning text mixed toward the foreground, so it keeps AA contrast in both themes. */
export const WARNING_TEXT =
  'text-[color-mix(in_oklab,var(--color-warning)_75%,var(--color-foreground))]';

function PickerFooter({
  isMulti,
  onAddProject,
}: {
  isMulti: boolean;
  onAddProject: () => void;
}) {
  return (
    <div className="flex items-center gap-1 border-t px-2 py-1.5">
      <Button
        size="sm"
        variant="ghost"
        className="h-7 font-normal text-muted-foreground"
        onClick={onAddProject}
      >
        <FolderPlus />
        Add project…
      </Button>
      <span className="flex-1" />
      <span className="flex items-center gap-1.5 type-caption text-subtle-foreground max-sm:hidden">
        <KeyHint
          keys={
            <>
              <ArrowUp />
              <ArrowDown />
            </>
          }
          label={isMulti ? 'move' : 'project'}
        />
        {isMulti && <KeyHint keys="→" label="computer" />}
        <KeyHint keys="Enter" label="pick" />
      </span>
    </div>
  );
}

function KeyHint({ keys, label }: { keys: ReactNode; label: string }) {
  return (
    <>
      <Kbd>{keys}</Kbd>
      {label}
    </>
  );
}

/** Keeps the keyboard's row in view as it moves past the list's edge. */
function useActiveIntoView<T extends HTMLElement>(isActive: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (isActive) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [isActive]);
  return ref;
}

/** The row under the keyboard is set apart from the active row of the other column. */
function optionTone(isActive: boolean, isFocused: boolean) {
  if (isFocused) return 'bg-accent text-foreground';
  if (isActive) return 'bg-foreground/5 text-foreground';
  return 'text-foreground/80';
}

// ScrollDock values are strings; a project key is never empty.
const NO_PROJECT = '';

/** A folderless chat can start on any computer. */
function noProjectRow(computers: Computer[]): ProjectWithCopies {
  return {
    key: NO_PROJECT,
    name: 'No project',
    origin: null,
    icon: null,
    copies: computers.map((c) => ({
      machineId: c.id,
      ref: '',
      name: '',
      origin: null,
      icon: null,
    })),
  };
}

function isPickable(copy: ProjectCopy) {
  return !copy.local?.isMissing;
}

/** This computer's copy, else one on a computer that's online, else any. */
export function defaultCopy(
  project: ProjectWithCopies,
  computers: Computer[],
): ProjectCopy | undefined {
  const pickable = project.copies.filter(isPickable);
  const isOnline = (copy: ProjectCopy) =>
    computers.find((c) => c.id === copy.machineId)?.machine?.status ===
    'online';
  return (
    pickable.find((c) => c.machineId === null) ??
    pickable.find(isOnline) ??
    pickable[0]
  );
}

/** A project at its default copy; no folder on this computer when it has none to pick. */
export function placeIn(
  project: ProjectWithCopies,
  computers: Computer[],
): Place {
  const copy = defaultCopy(project, computers);
  return copy
    ? { machineId: copy.machineId, ref: copy.ref }
    : { machineId: null, ref: null };
}

function matching(projects: ProjectWithCopies[], query: string) {
  const q = query.trim().toLowerCase();
  return q
    ? projects.filter((p) =>
        `${p.name} ${p.origin ?? ''}`.toLowerCase().includes(q),
      )
    : projects;
}

/** What the dock steps through: the favorites, the chosen project if it isn't one, and No project always last. */
function dockStops(projects: ProjectWithCopies[], chosen?: ProjectWithCopies) {
  const stops = projects.filter(
    (p) =>
      p === chosen ||
      p.copies.some((c) => !!c.local && c.local.favoriteOrder !== null),
  );
  return [
    ...stops.map((p) => ({
      value: p.key,
      label: p.name,
      icon: <ProjectIcon name={p.name} icon={p.icon} className="size-5" />,
    })),
    { value: NO_PROJECT, label: 'No project', icon: <Chat /> },
  ];
}
