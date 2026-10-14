import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, ChatRound, ChevronDown, ChevronRight, Folder, FolderAdd, X } from 'reicon-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { host } from './host';
import { getPrefs } from './settings/prefs';
import { useHarness, useSpaceThreads } from './store';
import { MetaChip } from './MetaChip';
import { addRecentProject, projectName, projectRef, useSavedProjects } from './projects';

/** Where a new thread runs: a folder this profile opened before, one opened by path, or no folder at all. `value` is a project ref (`src/projects.ts`). */
export function ProjectPicker({ value, onChange }: { value: string | null; onChange: (project: string | null) => void }) {
  const name = value && projectName(value);
  return (
    <FolderPopover value={value} onChoose={onChange}>
      <MetaChip aria-label={`Project: ${name ?? 'No project'}`}>
        {value ? <Folder /> : <ChatRound />}
        <span className="truncate">{name ?? 'No project'}</span>
        <ChevronDown data-icon="inline-end" />
      </MetaChip>
    </FolderPopover>
  );
}

/** Claude's add-folder button: more project folders the agent works in besides `project`, each a chip that removes itself. */
export function ExtraFolders({ project, value, onChange }: { project: string; value: string[]; onChange: (dirs: string[]) => void }) {
  const taken = [project, ...value];
  return (
    <>
      {value.map((dir) => (
        <MetaChip key={dir} onClick={() => onChange(value.filter((d) => d !== dir))} aria-label={`Remove ${projectName(dir)}`} className="group/folder">
          <Folder className="group-hover/folder:hidden group-focus-visible/folder:hidden" />
          <X className="hidden group-hover/folder:block group-focus-visible/folder:block" />
          <span className="truncate">{projectName(dir)}</span>
        </MetaChip>
      ))}
      <FolderPopover exclude={taken} onChoose={(dir) => dir && onChange([...value, dir])}>
        <MetaChip size="icon-sm" aria-label="Add a folder" className="w-7 px-0">
          <FolderAdd />
        </MetaChip>
      </FolderPopover>
    </>
  );
}

/**
 * The folder list behind a chip: recent projects, then Open folder. With `exclude` it adds a folder (no "No project", those
 * folders left out); without, it picks the thread's project and checks `value`.
 */
function FolderPopover({ value = null, exclude, onChoose, children }: { value?: string | null; exclude?: string[]; onChoose: (project: string | null) => void; children: ReactNode }) {
  const spaceId = useHarness().state.spaceId;
  const recent = useRecentProjects();
  const projects = exclude ? recent.filter((p) => !exclude.includes(p)) : recent;
  const [isOpen, setOpen] = useState(false);
  const [isBrowsing, setBrowsing] = useState(false);

  const choose = (project: string | null) => {
    onChoose(project);
    setOpen(false);
    setBrowsing(false);
  };
  const openFolder = (project: string) => {
    addRecentProject(spaceId, project);
    choose(project);
  };

  return (
    <Popover
      open={isOpen}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setBrowsing(false);
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        {isBrowsing ? <FolderBrowser onBack={() => setBrowsing(false)} onChoose={openFolder} /> : <ProjectList projects={projects} value={value} isAdding={!!exclude} onChoose={choose} onBrowse={() => setBrowsing(true)} />}
      </PopoverContent>
    </Popover>
  );
}

/** Folders this profile opened, then the projects of its threads, most recently started first. */
export function useRecentProjects() {
  const threads = useSpaceThreads();
  const saved = useSavedProjects(useHarness().state.spaceId);
  const fromThreads = [...threads].sort((a, b) => b.startedAt - a.startedAt).flatMap((t) => (t.repo ? [projectRef(t.repo)!] : []));
  return [...new Set([...saved, ...fromThreads])];
}

function ProjectList({ projects, value, isAdding, onChoose, onBrowse }: { projects: string[]; value: string | null; isAdding: boolean; onChoose: (project: string | null) => void; onBrowse: () => void }) {
  return (
    <Command>
      <CommandInput placeholder="Search projects" />
      <CommandList className="max-h-72">
        <CommandEmpty>No project matches.</CommandEmpty>
        {projects.length > 0 && (
          <>
            <CommandGroup heading={isAdding ? 'Add a folder' : 'Projects'}>
              {projects.map((p) => (
                <CommandItem key={p} value={p} data-checked={p === value} onSelect={() => onChoose(p)}>
                  <Folder />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{projectName(p)}</span>
                    {p !== projectName(p) && <span className="truncate type-caption text-subtle-foreground">{p}</span>}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}
        <CommandGroup>
          {!isAdding && (
            <CommandItem value="No project" keywords={['chat', 'folder']} data-checked={value === null} onSelect={() => onChoose(null)}>
              <ChatRound />
              <span className="flex min-w-0 flex-col">
                No project
                <span className="type-caption text-subtle-foreground">Chat without a folder, branch or files</span>
              </span>
            </CommandItem>
          )}
          <CommandItem value="Open folder" keywords={['add', 'project', 'path']} onSelect={onBrowse}>
            <FolderAdd />
            Open folder
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

/** T3 Code's Add project: type or paste a path, or browse with the native picker. Suggestions list the folders in the typed directory. */
function FolderBrowser({ onBack, onChoose }: { onBack: () => void; onChoose: (project: string) => void }) {
  const [path, setPath] = useState(() => getPrefs().projectsFolder.replace(/\/*$/, '/'));
  const { dir, matches, folder } = useFolderMatches(path);
  const enter = (name: string) => setPath(`${dir}/${name}/`);

  return (
    <Command shouldFilter={false}>
      <div className="flex items-center gap-1 px-1 pt-1">
        <Button variant="ghost" size="icon-xs" onClick={onBack} aria-label="Back to projects">
          <ArrowLeft />
        </Button>
        <span className="type-meta font-medium">Open folder</span>
      </div>
      <CommandInput
        autoFocus
        value={path}
        onValueChange={setPath}
        placeholder="~/path/to/project"
        aria-label="Folder path"
        className="font-mono"
        onKeyDown={(e) => {
          if (e.key !== 'Tab' || matches.length === 0) return;
          e.preventDefault();
          enter(matches[0]);
        }}
      />
      <CommandList className="max-h-64">
        <CommandEmpty>No folder here</CommandEmpty>
        {!!folder && (
          <CommandGroup>
            <CommandItem value={`open ${folder.path}`} onSelect={() => onChoose(folder.path)}>
              <FolderAdd />
              Open {projectName(folder.path)}
            </CommandItem>
          </CommandGroup>
        )}
        {matches.length > 0 && (
          <CommandGroup heading={dir}>
            {matches.map((name) => (
              <CommandItem key={name} value={name} onSelect={() => enter(name)}>
                <Folder />
                {name}
                <CommandShortcut>
                  <ChevronRight />
                </CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
      <div className="flex items-center justify-between gap-2 px-2 pt-1 pb-2">
        <Button variant="outline" size="xs" onClick={() => browseNative(onChoose)}>
          Browse
        </Button>
        <span className="type-caption text-subtle-foreground">Tab completes</span>
      </div>
    </Command>
  );
}

/** The typed path split at its last slash: subfolders of the directory part that start with the rest, and the typed path itself when it is a folder. */
function useFolderMatches(path: string) {
  const cut = path.lastIndexOf('/');
  const dir = cut < 0 ? '~' : path.slice(0, cut) || '/';
  const partial = (cut < 0 ? path : path.slice(cut + 1)).toLowerCase();
  const full = path.replace(/\/+$/, '') || '/';
  const [found, setFound] = useState<{ key: string; names: string[]; folder: { path: string } | null }>({ key: '', names: [], folder: null });
  useEffect(() => {
    let isCurrent = true;
    void Promise.all([host.fs.folders(dir), host.fs.folders(full)]).then(
      ([inDir, self]) => isCurrent && setFound({ key: `${dir}\n${full}`, names: inDir?.names ?? [], folder: self && { path: self.path } }),
      () => isCurrent && setFound({ key: `${dir}\n${full}`, names: [], folder: null }),
    );
    return () => {
      isCurrent = false;
    };
  }, [dir, full]);
  const isFresh = found.key === `${dir}\n${full}`;
  const matches = isFresh ? found.names.filter((name) => name.toLowerCase().startsWith(partial)) : [];
  return { dir, matches, folder: isFresh ? found.folder : null };
}

function browseNative(onChoose: (project: string) => void) {
  host.fs.pickFolder(getPrefs().projectsFolder).then(
    (path) => path && onChoose(path),
    (error: Error) => toast(error.message),
  );
}
