import { useState } from 'react';
import { Chat, ChevronDown, Folder, FolderPlus } from '@/icons';
import type { Project } from './host/types/projects';
import { ProjectIcon } from './ProjectIcon';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { FollowedMachine } from './host/types/remote';
import { MetaChip } from './MetaChip';
import { AddProject, type AddedProject } from './AddProject';
import { refreshProjects } from './projects';
import { useHarness } from './store';

/** A row in the picker: `ref` is what the composer starts the thread with (a folder here, a project id on another computer). */
export interface PickerProject {
  ref: string;
  name: string;
  detail?: string;
  isMissing?: boolean;
  icon?: Project['icon'];
}

/**
 * Where a new thread runs: one of the chosen computer's projects, or no folder at all, with Add project… at the bottom.
 * `machine` is another computer the list and Add project belong to; unset, this one.
 */
export function ProjectPicker({ value, projects, machine, onChange, onAdded }: { value: string | null; projects: PickerProject[]; machine?: FollowedMachine; onChange: (project: string | null) => void; onAdded?: () => void }) {
  const spaceId = useHarness().state.spaceId;
  const [isOpen, setOpen] = useState(false);
  const chosen = projects.find((p) => p.ref === value);
  const name = value && (chosen?.name ?? value);

  const choose = (project: string | null) => {
    onChange(project);
    setOpen(false);
  };

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        setOpen(open);
        if (open && !machine) refreshProjects(spaceId);
      }}
    >
      <PopoverTrigger asChild>
        <MetaChip aria-label={`Project: ${name ?? 'No project'}`}>
          {!value && <Chat />}
          {!!value && (chosen?.icon ? <ProjectIcon name={chosen.name} icon={chosen.icon} /> : <Folder />)}
          <span className="truncate">{name ?? 'No project'}</span>
          <ChevronDown data-icon="inline-end" />
        </MetaChip>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <ProjectChooser value={value} projects={projects} machine={machine} onChoose={choose} onAdded={onAdded} />
      </PopoverContent>
    </Popover>
  );
}

/** The searchable list with Add project… in place: the picker's popover, and the new-thread page's first step. */
export function ProjectChooser({ value, projects, machine, placeholder = 'Search projects', onChoose, onAdded }: { value: string | null; projects: PickerProject[]; machine?: FollowedMachine; placeholder?: string; onChoose: (project: string | null) => void; onAdded?: () => void }) {
  const [isAdding, setAdding] = useState(false);
  const added = (project: AddedProject) => {
    onAdded?.();
    onChoose(project.ref);
  };
  if (isAdding) return <AddProject machine={machine} onBack={() => setAdding(false)} onAdded={added} />;
  return <ProjectList projects={projects} value={value} placeholder={placeholder} onChoose={onChoose} onAdd={() => setAdding(true)} />;
}

function ProjectList({ projects, value, placeholder, onChoose, onAdd }: { projects: PickerProject[]; value: string | null; placeholder: string; onChoose: (project: string | null) => void; onAdd: () => void }) {
  return (
    <Command defaultValue={value ?? 'No project'}>
      <CommandInput autoFocus placeholder={placeholder} />
      <CommandList className="max-h-72">
        <CommandEmpty>No project matches.</CommandEmpty>
        {projects.length > 0 && (
          <>
            <CommandGroup heading="Projects">
              {projects.map((p) => (
                <CommandItem key={p.ref} value={p.ref} keywords={[p.name]} disabled={p.isMissing} data-checked={p.ref === value} onSelect={() => onChoose(p.ref)}>
                  <ProjectIcon name={p.name} icon={p.icon} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{p.name}</span>
                    {p.isMissing ? <span className="truncate type-caption text-warning">Folder not found; relocate it in Projects</span> : !!p.detail && <span className="truncate type-caption text-subtle-foreground">{p.detail}</span>}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}
        <CommandGroup>
          <CommandItem value="No project" keywords={['chat', 'folder']} data-checked={value === null} onSelect={() => onChoose(null)}>
            <Chat />
            <span className="flex min-w-0 flex-col">
              No project
              <span className="type-caption text-subtle-foreground">Chat without a folder, branch or files</span>
            </span>
          </CommandItem>
          <CommandItem value="Add project" keywords={['open', 'folder', 'clone', 'github', 'git', 'new']} onSelect={onAdd}>
            <FolderPlus />
            Add project…
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
