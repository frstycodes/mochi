import { useState } from 'react';
import { ArrowLeft, ChatRound, ChevronDown, ChevronRight, Folder, FolderAdd } from 'reicon-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { host } from './host';
import { getPrefs } from './settings/prefs';
import { useSpaceThreads } from './store';

/** Where a new thread runs: one of the space's projects, a folder opened by path, or no folder at all. */
export function ProjectPicker({ value, onChange }: { value: string | null; onChange: (project: string | null) => void }) {
  const [opened, setOpened] = useState<string[]>([]);
  const projects = useRecentProjects(opened);
  const [isOpen, setOpen] = useState(false);
  const [isBrowsing, setBrowsing] = useState(false);

  const choose = (project: string | null) => {
    onChange(project);
    setOpen(false);
  };
  const openFolder = (project: string) => {
    setOpened((o) => (o.includes(project) ? o : [project, ...o]));
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
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" className="max-w-48 text-subtle-foreground hover:text-foreground" aria-label={`Project: ${value ?? 'No project'}`}>
          {value ? <Folder /> : <ChatRound />}
          <span className="truncate">{value ?? 'No project'}</span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        {isBrowsing ? <FolderBrowser onBack={() => setBrowsing(false)} onChoose={openFolder} /> : <ProjectList projects={projects} value={value} onChoose={choose} onBrowse={() => setBrowsing(true)} />}
      </PopoverContent>
    </Popover>
  );
}

/** Projects of the space's threads, most recently started first, after folders opened this session. */
export function useRecentProjects(opened: string[] = []) {
  const threads = useSpaceThreads();
  const fromThreads = [...threads].sort((a, b) => b.startedAt - a.startedAt).flatMap((t) => (t.repo ? [t.repo.project] : []));
  return [...new Set([...opened, ...fromThreads])];
}

function ProjectList({ projects, value, onChoose, onBrowse }: { projects: string[]; value: string | null; onChoose: (project: string | null) => void; onBrowse: () => void }) {
  return (
    <Command>
      <CommandInput placeholder="Search projects" />
      <CommandList className="max-h-72">
        <CommandEmpty>No project matches.</CommandEmpty>
        {projects.length > 0 && (
          <CommandGroup heading="Projects">
            {projects.map((p) => (
              <CommandItem key={p} value={p} data-checked={p === value} onSelect={() => onChoose(p)}>
                <Folder />
                <span className="truncate">{p}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandSeparator />
        <CommandGroup>
          <CommandItem value="No project" keywords={['chat', 'folder']} data-checked={value === null} onSelect={() => onChoose(null)}>
            <ChatRound />
            <span className="flex min-w-0 flex-col">
              No project
              <span className="type-caption text-subtle-foreground">Chat without a folder, branch or files</span>
            </span>
          </CommandItem>
          <CommandItem value="Open folder" keywords={['add', 'project', 'path']} onSelect={onBrowse}>
            <FolderAdd />
            Open folder
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

// GAP: fake file system. The desktop app lists real directories through the harness server.
const FOLDERS: Record<string, string[]> = {
  '~': ['dev', 'work', 'Documents'],
  '~/dev': ['agent-skills', 'focus-mode', 'harness', 'liane', 'map-veto'],
  '~/work': ['latitude', 'latitude-docs', 'latitude-infra'],
  '~/Documents': ['notes'],
};

/** T3 Code's Add project: type or paste a path, or browse with the native picker. Suggestions list the folders in the typed directory. */
function FolderBrowser({ onBack, onChoose }: { onBack: () => void; onChoose: (project: string) => void }) {
  const [path, setPath] = useState(() => getPrefs().projectsFolder.replace(/\/*$/, '/'));
  const { dir, matches, folder } = resolvePath(path);
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
            <CommandItem value={`open ${folder.path}`} onSelect={() => onChoose(folder.name)}>
              <FolderAdd />
              Open {folder.name}
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

function resolvePath(path: string) {
  const cut = path.lastIndexOf('/');
  const dir = cut < 0 ? '~' : path.slice(0, cut);
  const partial = (cut < 0 ? path : path.slice(cut + 1)).toLowerCase();
  const matches = (FOLDERS[dir] ?? []).filter((name) => name.toLowerCase().startsWith(partial));
  const full = path.replace(/\/+$/, '');
  const parent = full.slice(0, full.lastIndexOf('/'));
  const name = full.slice(full.lastIndexOf('/') + 1);
  const isFolder = !!FOLDERS[parent]?.includes(name);
  return { dir, matches, folder: isFolder ? { path: full, name } : null };
}

function browseNative(onChoose: (project: string) => void) {
  host.fs.pickFolder(getPrefs().projectsFolder).then(
    (path) => path && onChoose(path),
    (error: Error) => toast(error.message),
  );
}
