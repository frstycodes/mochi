import { useState, type KeyboardEvent } from 'react';
import { Chat, Check, ChevronDown, Folder, FolderPlus, Star } from '@/icons';
import type { Project } from '@mochi/domain/host/types/projects';
import { ProjectIcon } from './ProjectIcon';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { FollowedMachine } from './host/types/remote';
import { MetaChip } from './MetaChip';
import { ScrollDock } from './ScrollDock';
import { cn } from '@/lib/utils';
import { AddProject, type AddedProject } from './AddProject';
import { useHarnessSelector, useSpaceThreads } from './store';
import { refreshProjects, useProjects } from './projects';
import { isMod } from './keys';
import { Shortcut } from './Shortcut';
import { toggleFavorite } from './toggleFavorite';

/** A row in the picker: `ref` is what the composer starts the thread with (a folder here, a project id on another computer). */
export interface PickerProject {
  ref: string;
  name: string;
  detail?: string;
  isMissing?: boolean;
  icon?: Project['icon'];
  /** This computer's projects only: their registry id and place among the favorites (null when not one). */
  id?: string;
  favoriteOrder?: number | null;
}

/**
 * Where a new thread runs: one of the chosen computer's projects, or no folder at all, with Add project… at the bottom.
 * Scroll or drag over the chip to step through the favorites, ending at No project.
 * `machine` is another computer the list and Add project belong to; unset, this one.
 */
export function ProjectPicker({
  value,
  projects,
  machine,
  onChange,
  onAdded,
}: {
  value: string | null;
  projects: PickerProject[];
  machine?: FollowedMachine;
  onChange: (project: string | null) => void;
  onAdded?: () => void;
}) {
  const spaceId = useHarnessSelector((s) => s.spaceId);
  const [isOpen, setOpen] = useState(false);
  const chosen = projects.find((p) => p.ref === value);
  const name = value && (chosen?.name ?? value);

  const choose = (project: string | null) => {
    onChange(project);
    setOpen(false);
  };
  const stops = dockStops(projects, chosen);

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        setOpen(open);
        if (open && !machine) refreshProjects(spaceId);
      }}
    >
      <ScrollDock
        label="Project"
        value={value ?? NO_PROJECT}
        onChange={(ref) => onChange(ref === NO_PROJECT ? null : ref)}
        items={stops}
      >
        <PopoverTrigger asChild>
          <MetaChip aria-label={`Project: ${name ?? 'No project'}`}>
            {!value && <Chat />}
            {!!value &&
              (chosen?.icon ? (
                <ProjectIcon name={chosen.name} icon={chosen.icon} />
              ) : (
                <Folder />
              ))}
            <span className="truncate">{name ?? 'No project'}</span>
            <ChevronDown data-icon="inline-end" />
          </MetaChip>
        </PopoverTrigger>
      </ScrollDock>
      <PopoverContent align="start" className="w-80 p-0">
        <ProjectChooser
          value={value}
          projects={projects}
          machine={machine}
          onChoose={choose}
          onAdded={onAdded}
        />
      </PopoverContent>
    </Popover>
  );
}

// ScrollDock values are strings; a path is never empty.
const NO_PROJECT = '';

/** What the dock steps through: the favorites, the chosen project if it isn't one, and No project always last. */
function dockStops(projects: PickerProject[], chosen?: PickerProject) {
  const stops = projects.filter(
    (p) => !p.isMissing && (p.favoriteOrder != null || p === chosen),
  );
  return [
    ...stops.map((p) => ({
      value: p.ref,
      label: p.name,
      icon: <ProjectIcon name={p.name} icon={p.icon} className="size-5" />,
    })),
    { value: NO_PROJECT, label: 'No project', icon: <Chat /> },
  ];
}

const NO_ROWS: PickerProject[] = [];

/** This computer's projects as the picker lists them: by folder, which is what a thread here starts in. */
export function useProjectRows(spaceId: string): PickerProject[] {
  const projects = useProjects(spaceId, useSpaceThreads());
  return (
    projects?.map((p) => ({
      ref: p.path,
      name: p.name,
      ...(p.path !== p.name && { detail: p.path }),
      isMissing: p.isMissing,
      icon: p.icon,
      id: p.id,
      favoriteOrder: p.favoriteOrder,
    })) ?? NO_ROWS
  );
}

/** The searchable list with Add project… in place: the picker's popover, the new-thread page's first step, and a folderless chat's Add to project. */
export function ProjectChooser({
  value,
  projects,
  machine,
  placeholder = 'Search projects',
  isProjectRequired,
  onChoose,
  onAdded,
}: {
  value: string | null;
  projects: PickerProject[];
  machine?: FollowedMachine;
  placeholder?: string;
  /** No "No project" row: the choice is which project. */
  isProjectRequired?: boolean;
  onChoose: (project: string | null) => void;
  onAdded?: () => void;
}) {
  const [isAdding, setAdding] = useState(false);
  const added = (project: AddedProject) => {
    onAdded?.();
    onChoose(project.ref);
  };
  if (isAdding)
    return (
      <AddProject
        machine={machine}
        onBack={() => setAdding(false)}
        onAdded={added}
      />
    );
  return (
    <ProjectList
      projects={projects}
      value={value}
      placeholder={placeholder}
      isProjectRequired={isProjectRequired}
      onChoose={onChoose}
      onAdd={() => setAdding(true)}
    />
  );
}

function ProjectList({
  projects,
  value,
  placeholder,
  isProjectRequired,
  onChoose,
  onAdd,
}: {
  projects: PickerProject[];
  value: string | null;
  placeholder: string;
  isProjectRequired?: boolean;
  onChoose: (project: string | null) => void;
  onAdd: () => void;
}) {
  const spaceId = useHarnessSelector((s) => s.spaceId);
  const registered = projects.filter((p) => !!p.id) as {
    id: string;
    favoriteOrder: number | null;
  }[];
  // Runs before the window's pinned-thread listener, which skips events already prevented.
  const chooseByNumber = (e: KeyboardEvent) => {
    if (!isMod(e) || e.shiftKey || e.altKey || !/^[1-9]$/.test(e.key)) return;
    const project = projects[Number(e.key) - 1];
    if (!project || project.isMissing) return;
    e.preventDefault();
    onChoose(project.ref);
  };

  return (
    <Command
      defaultValue={
        value ??
        (isProjectRequired
          ? projects.find((p) => !p.isMissing)?.ref
          : 'No project')
      }
      onKeyDown={chooseByNumber}
    >
      <CommandInput autoFocus placeholder={placeholder} />
      <CommandList className="max-h-72">
        <CommandEmpty>No project matches.</CommandEmpty>
        {projects.length > 0 && (
          <>
            <CommandGroup heading="Projects">
              {projects.map((p, i) => (
                <CommandItem
                  key={p.ref}
                  value={p.ref}
                  keywords={[p.name]}
                  disabled={p.isMissing}
                  data-checked={p.ref === value}
                  onSelect={() => onChoose(p.ref)}
                >
                  <ProjectIcon name={p.name} icon={p.icon} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{p.name}</span>
                    {p.isMissing ? (
                      <span className="truncate type-caption text-warning">
                        Folder not found; relocate it in Projects
                      </span>
                    ) : (
                      !!p.detail && (
                        <span className="truncate type-caption text-subtle-foreground">
                          {p.detail}
                        </span>
                      )
                    )}
                  </span>
                  <CommandShortcut className="flex items-center gap-2">
                    {p.ref === value && <Check />}
                    {i < 9 && !p.isMissing && (
                      <Shortcut keys={['mod', String(i + 1)]} />
                    )}
                    {!!p.id && (
                      <FavoriteToggle
                        isOn={p.favoriteOrder != null}
                        name={p.name}
                        onToggle={() =>
                          void toggleFavorite(spaceId, registered, p.id!)
                        }
                      />
                    )}
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}
        <CommandGroup>
          {!isProjectRequired && (
            <CommandItem
              value="No project"
              keywords={['chat', 'folder']}
              data-checked={value === null}
              onSelect={() => onChoose(null)}
            >
              <Chat />
              <span className="flex min-w-0 flex-col">
                No project
                <span className="type-caption text-subtle-foreground">
                  Chat without a folder, branch or files
                </span>
              </span>
            </CommandItem>
          )}
          <CommandItem
            value="Add project"
            keywords={['open', 'folder', 'clone', 'github', 'git', 'new']}
            onSelect={onAdd}
          >
            <FolderPlus />
            Add project…
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

function FavoriteToggle({
  isOn,
  name,
  onToggle,
}: {
  isOn: boolean;
  name: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={isOn ? `Unfavorite ${name}` : `Favorite ${name}`}
      aria-pressed={isOn}
      // Command items select on pointerup, so the toggle keeps both presses to itself.
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="flex size-5 shrink-0 cursor-default items-center justify-center rounded-sm text-subtle-foreground hover:text-foreground"
    >
      <Star
        filled={isOn}
        className={cn('size-3.5', isOn && 'text-warning! **:text-warning!')}
      />
    </button>
  );
}
