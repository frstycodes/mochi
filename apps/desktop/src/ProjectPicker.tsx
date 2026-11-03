import { useState, type KeyboardEvent } from 'react';
import { Chat, Check, FolderPlus, Star } from '@/icons';
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
import type { FollowedMachine } from './host/types/remote';
import { cn } from '@/lib/utils';
import { AddProject, type AddedProject } from './AddProject';
import { useHarnessSelector, useSpaceThreads } from './store';
import { useProjects } from './projects';
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

/** The searchable list with Add project… in place, for a folderless chat's Add to project: this computer's projects only. */
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
