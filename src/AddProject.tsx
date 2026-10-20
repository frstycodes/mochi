import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, ChevronRight, Folder, FolderPlus, Link, Lock } from '@/icons';
import { toast } from '@/toast/store';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { isCloneUrl } from './git/origin';
import { gitError } from './git/useGit';
import { host } from './host';
import type { CloneSource, GithubRepo, Project } from './host/types/projects';
import type { FollowedMachine } from './host/types/remote';
import { GithubMarkIcon } from './icons/github';
import { cloneProject, createProject, githubUserOf, projectName } from './projects';
import { useMachines } from './remote/useMachines';
import { getPrefs, usePrefs } from './settings/prefs';
import { useHarness } from './store';

/** What the picker gets back: `ref` is the folder here, the project's id on another computer. */
export interface AddedProject {
  ref: string;
  name: string;
}

type Source = 'folder' | 'github' | 'url' | 'new';

/**
 * Add project, inside the project picker or the Projects page: open a folder, clone from GitHub or any git URL, or start an
 * empty one. On another computer (`machine`) it runs there, in its projects folder; a folder can't be browsed from here.
 */
export function AddProject({ machine, onBack, onAdded }: { machine?: FollowedMachine; onBack?: () => void; onAdded: (project: AddedProject) => void }) {
  const [source, setSource] = useState<Source | null>(null);
  const adder = useAdder(machine);
  const back = () => setSource(null);
  if (source === 'folder') return <FolderBrowser onBack={back} onChoose={(path) => void adder.run(`Adding ${projectName(path)}`, () => adder.folder(path)).then((p) => p && onAdded(p))} error={adder.error} />;
  if (source === 'github') return <GithubPicker adder={adder} machine={machine} onBack={back} onAdded={onAdded} />;
  if (source === 'url') return <UrlForm adder={adder} onBack={back} onAdded={onAdded} />;
  if (source === 'new') return <NewForm adder={adder} machine={machine} onBack={back} onAdded={onAdded} />;
  return <SourceList machine={machine} onBack={onBack} onPick={setSource} />;
}

function SourceList({ machine, onBack, onPick }: { machine?: FollowedMachine; onBack?: () => void; onPick: (source: Source) => void }) {
  const folder = usePrefs().projectsFolder;
  const where = machine ? `${machine.name}’s projects folder` : folder;
  return (
    // No search field to hold focus, so the list takes it: cmdk's arrow keys only work with focus inside.
    <Command ref={(el) => el?.focus()} tabIndex={-1} className="outline-none">
      <AddHeader title={machine ? `Add a project on ${machine.name}` : 'Add project'} onBack={onBack} />
      <CommandList className="max-h-80">
        <CommandGroup>
          {!machine && (
            <SourceItem value="Open folder" icon={<Folder />} title="Open folder" detail="A folder already on this computer" onSelect={() => onPick('folder')} />
          )}
          <SourceItem value="GitHub" icon={<GithubMarkIcon />} title="Clone from GitHub" detail={`One of your repositories, into ${where}`} onSelect={() => onPick('github')} />
          <SourceItem value="Git URL" icon={<Link />} title="Clone from a URL" detail="GitLab, Bitbucket or any git host" onSelect={() => onPick('url')} />
          <SourceItem value="New project" icon={<FolderPlus />} title="New project" detail={`An empty repository in ${where}`} onSelect={() => onPick('new')} />
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

function SourceItem({ value, icon, title, detail, onSelect }: { value: string; icon: ReactNode; title: string; detail: string; onSelect: () => void }) {
  return (
    <CommandItem value={value} onSelect={onSelect}>
      {icon}
      <span className="flex min-w-0 flex-col">
        {title}
        <span className="truncate type-caption text-subtle-foreground">{detail}</span>
      </span>
      <CommandShortcut>
        <ChevronRight />
      </CommandShortcut>
    </CommandItem>
  );
}

function AddHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <div className="flex h-9 items-center gap-1 px-1">
      {!!onBack && (
        <Button variant="ghost" size="icon-xs" onClick={onBack} aria-label="Back">
          <ArrowLeft />
        </Button>
      )}
      <span className="truncate px-1 type-meta font-medium">{title}</span>
    </div>
  );
}

type Adder = ReturnType<typeof useAdder>;

/** The add calls for this computer or another, and what's running: one at a time, with its latest progress line and git's error as it said it. */
function useAdder(machine: FollowedMachine | undefined) {
  const spaceId = useHarness().state.spaceId;
  const { ask } = useMachines();
  const [busy, setBusy] = useState<{ label: string; line: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const here = (project: Project): AddedProject => ({ ref: project.path, name: project.name });
  const onLine = (line: string) => setBusy((b) => b && { ...b, line });

  return {
    busy,
    error,
    folder: (path: string) => host.projects.addFolder(spaceId, path).then(here),
    clone: (source: CloneSource) => (machine ? ask(machine.id, { type: 'clone-project', source }) : cloneProject(spaceId, source, onLine).then(here)),
    create: (name: string, publish?: 'private' | 'public') => (machine ? ask(machine.id, { type: 'add-project', name, ...(publish && { publish }) }) : createProject(spaceId, name, publish).then(here)),
    async run(label: string, task: () => Promise<AddedProject>) {
      setBusy({ label, line: '' });
      setError(null);
      try {
        return await task();
      } catch (e) {
        setError(gitError(e));
        return null;
      } finally {
        setBusy(null);
      }
    },
  };
}

/** While a clone runs: what it's doing and git's latest line; afterwards git's error, word for word. */
function AddStatus({ adder }: { adder: Adder }) {
  if (adder.busy)
    return (
      <div role="status" className="flex min-w-0 flex-col gap-1 px-3 py-2">
        <span className="flex items-center gap-2 type-meta text-foreground">
          <Spinner className="size-3.5" />
          {adder.busy.label}…
        </span>
        {!!adder.busy.line && <span className="truncate font-mono type-caption text-subtle-foreground">{adder.busy.line}</span>}
      </div>
    );
  if (!adder.error) return null;
  return (
    <p role="alert" className="max-h-40 overflow-y-auto px-3 py-2 type-caption break-words whitespace-pre-wrap text-destructive">
      {adder.error}
    </p>
  );
}

const OWNER_REPO = /^[\w.-]+\/[\w.-]+$/;

/** The profile's own repositories from gh, searchable; a typed `owner/repo` clones any other. Another computer clones as its own login, so there only the typed name works. */
function GithubPicker({ adder, machine, onBack, onAdded }: { adder: Adder; machine?: FollowedMachine; onBack: () => void; onAdded: (project: AddedProject) => void }) {
  const spaceId = useHarness().state.spaceId;
  const [query, setQuery] = useState('');
  const repos = useGithubRepos(machine ? null : spaceId);
  const typed = query.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
  const matches = (repos.list ?? []).filter((r) => r.name.toLowerCase().includes(typed.toLowerCase()));
  const canTypeClone = OWNER_REPO.test(typed) && !matches.some((r) => r.name.toLowerCase() === typed.toLowerCase());
  const clone = (name: string) => void adder.run(`Cloning ${name}`, () => adder.clone({ github: name })).then((p) => p && onAdded(p));

  return (
    <Command shouldFilter={false}>
      <AddHeader title="Clone from GitHub" onBack={onBack} />
      <CommandInput autoFocus value={query} onValueChange={setQuery} placeholder={machine ? 'owner/repo' : 'Search, or type owner/repo'} aria-label="Repository" disabled={!!adder.busy} />
      <AddStatus adder={adder} />
      {!adder.busy && (
        <CommandList className="max-h-64">
          {!canTypeClone && <CommandEmpty>{machine ? `Type owner/repo; ${machine.name} clones it as its own GitHub login.` : repos.error ? repos.error : repos.list ? 'No repository matches; type owner/repo for any other.' : 'Reading your repositories…'}</CommandEmpty>}
          {canTypeClone && (
            <CommandGroup>
              <CommandItem value={`clone ${typed}`} onSelect={() => clone(typed)}>
                <GithubMarkIcon />
                Clone {typed}
              </CommandItem>
            </CommandGroup>
          )}
          {matches.length > 0 && (
            <CommandGroup heading={repos.login ?? 'Your repositories'}>
              {matches.map((r) => (
                <CommandItem key={r.name} value={r.name} onSelect={() => clone(r.name)}>
                  {r.isPrivate ? <Lock aria-label="Private" /> : <GithubMarkIcon />}
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{r.name}</span>
                    {!!r.description && <span className="truncate type-caption text-subtle-foreground">{r.description}</span>}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      )}
    </Command>
  );
}

/** `gh repo list` as the profile's login, once per open. `spaceId` null skips it (another computer's login isn't readable from here). */
function useGithubRepos(spaceId: string | null) {
  const [state, setState] = useState<{ list: GithubRepo[] | null; error: string | null }>({ list: null, error: null });
  useEffect(() => {
    if (!spaceId) return;
    let isCurrent = true;
    host.projects.githubRepos(githubUserOf(spaceId)).then(
      (list) => isCurrent && setState({ list, error: null }),
      (e: unknown) => isCurrent && setState({ list: [], error: gitError(e) }),
    );
    return () => {
      isCurrent = false;
    };
  }, [spaceId]);
  return { ...state, login: spaceId ? githubUserOf(spaceId) : undefined };
}

function UrlForm({ adder, onBack, onAdded }: { adder: Adder; onBack: () => void; onAdded: (project: AddedProject) => void }) {
  const [url, setUrl] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!isCloneUrl(trimmed)) return setProblem('Use an https://, ssh:// or git@host:owner/repo URL');
    setProblem(null);
    void adder.run(`Cloning ${trimmed}`, () => adder.clone({ url: trimmed })).then((p) => p && onAdded(p));
  };
  return (
    <form onSubmit={submit} className="flex flex-col pb-2">
      <AddHeader title="Clone from a URL" onBack={onBack} />
      <div className="flex flex-col gap-2 px-2">
        <Input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://gitlab.com/owner/repo.git" aria-label="Git URL" aria-invalid={!!problem} aria-describedby="clone-url-problem" disabled={!!adder.busy} spellCheck={false} />
        {!!problem && (
          <span id="clone-url-problem" className="px-1 type-caption text-destructive">
            {problem}
          </span>
        )}
        <span className="px-1 type-caption text-subtle-foreground">Clones with your own git credentials for that host.</span>
      </div>
      <AddStatus adder={adder} />
      <div className="flex justify-end px-2 pt-1">
        <Button type="submit" size="xs" disabled={!!adder.busy}>
          Clone
        </Button>
      </div>
    </form>
  );
}

const NAME = /^[\w.-]+$/;

function NewForm({ adder, machine, onBack, onAdded }: { adder: Adder; machine?: FollowedMachine; onBack: () => void; onAdded: (project: AddedProject) => void }) {
  const folder = usePrefs().projectsFolder;
  const [name, setName] = useState('');
  const [publish, setPublish] = useState<'none' | 'private' | 'public'>('none');
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!NAME.test(trimmed) || trimmed === '.' || trimmed === '..') return setProblem('Letters, digits, “.”, “-” and “_” only');
    setProblem(null);
    void adder.run(`Creating ${trimmed}`, () => adder.create(trimmed, publish === 'none' ? undefined : publish)).then((p) => p && onAdded(p));
  };
  return (
    <form onSubmit={submit} className="flex flex-col pb-2">
      <AddHeader title="New project" onBack={onBack} />
      <div className="flex flex-col gap-2 px-2">
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="my-project" aria-label="Project name" aria-invalid={!!problem} aria-describedby="new-project-problem" disabled={!!adder.busy} spellCheck={false} />
        {!!problem && (
          <span id="new-project-problem" className="px-1 type-caption text-destructive">
            {problem}
          </span>
        )}
        <span className="truncate px-1 type-caption text-subtle-foreground">
          {machine ? `In ${machine.name}’s projects folder` : `In ${folder.replace(/\/+$/, '')}/${name.trim() || '…'}`}
        </span>
        <div className="flex items-center justify-between gap-2 px-1">
          <span id="publish-label" className="type-caption text-muted-foreground">
            On GitHub
          </span>
          <ToggleGroup type="single" size="sm" variant="outline" spacing={0} value={publish} onValueChange={(v) => v && setPublish(v as typeof publish)} aria-labelledby="publish-label">
            <ToggleGroupItem value="none">Not yet</ToggleGroupItem>
            <ToggleGroupItem value="private">Private</ToggleGroupItem>
            <ToggleGroupItem value="public">Public</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
      <AddStatus adder={adder} />
      <div className="flex justify-end px-2 pt-1">
        <Button type="submit" size="xs" disabled={!!adder.busy}>
          Create project
        </Button>
      </div>
    </form>
  );
}

/** T3 Code's Add project: type or paste a path, or browse with the native picker. Suggestions list the folders in the typed directory. */
function FolderBrowser({ onBack, onChoose, error }: { onBack: () => void; onChoose: (path: string) => void; error: string | null }) {
  const [path, setPath] = useState(() => getPrefs().projectsFolder.replace(/\/*$/, '/'));
  const { dir, matches, folder } = useFolderMatches(path);
  const enter = (name: string) => setPath(`${dir}/${name}/`);

  return (
    <Command shouldFilter={false}>
      <AddHeader title="Open folder" onBack={onBack} />
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
      {!!error && (
        <p role="alert" className="px-3 py-2 type-caption break-words whitespace-pre-wrap text-destructive">
          {error}
        </p>
      )}
      <CommandList className="max-h-64">
        <CommandEmpty>No folder here</CommandEmpty>
        {!!folder && (
          <CommandGroup>
            <CommandItem value={`open ${folder.path}`} onSelect={() => onChoose(folder.path)}>
              <FolderPlus />
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

function browseNative(onChoose: (path: string) => void) {
  host.fs.pickFolder(getPrefs().projectsFolder).then(
    (path) => path && onChoose(path),
    (error: Error) => toast(error.message),
  );
}
