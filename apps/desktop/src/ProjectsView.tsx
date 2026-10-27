import { useQuery } from '@tanstack/react-query';
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import {
  Check,
  Edit,
  Folder,
  FolderPlus,
  FolderMove,
  Image,
  Link,
  Search,
  Star,
  Trash,
} from '@/icons';
import { toast } from '@/toast/store';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { plural } from '@mochi/domain/lib/format';
import { AddProject } from './AddProject';
import { gitError } from './git/useGit';
import { host } from './host';
import type { Project } from '@mochi/domain/host/types/projects';
import type { FollowedMachine } from './host/types/remote';
import { GithubMarkIcon } from './icons/github';
import { ProjectIcon } from './ProjectIcon';
import { timeAgo } from './progress';
import {
  projectUsage,
  refreshProjects,
  requestNewThreadIn,
  useProjects,
} from './projects';
import { toggleFavorite } from './toggleFavorite';
import { useMachines } from './remote/useMachines';
import { useHarness, useSpaceThreads, useHarnessSelector } from './store';
import { OverflowIcon } from './ui';
import { SettingsCard, SettingsSection } from './settings/parts';
import { queryKeys } from './queryKeys';

const FOOTER =
  'Removing a project only takes it off this list; its folder stays on disk. Icons come from a favicon in the folder (public/, app/, static/ and the like) unless you upload one.';
/** Past this many, a filter sits over the list. */
const FILTER_FROM = 8;

/** Every project this profile works in, on this computer and on the others you follow, each with its icon and how it's used. */
export function ProjectsView() {
  const others = useMachines()
    .machines.map((m) => m.machine)
    .filter((m) => m.status === 'online' && m.scopes.includes('read'));
  return (
    <ScrollArea type="scroll" className="h-full">
      <div className="mx-auto flex w-full max-w-180 flex-col gap-10 px-4 pt-6 pb-16 md:px-8 md:pt-8">
        <ThisComputerProjects />
        {others.map((m) => (
          <MachineProjects key={m.id} machine={m} />
        ))}
      </div>
    </ScrollArea>
  );
}

function ThisComputerProjects() {
  const spaceId = useHarnessSelector((s) => s.spaceId);
  const threads = useSpaceThreads();
  const projects = useProjects(spaceId, threads);
  const [query, setQuery] = useState('');
  useEffect(() => refreshProjects(spaceId), [spaceId]);
  if (!projects) return <Spinner className="mx-auto" />;

  const usage = projectUsage(threads);
  const q = query.trim().toLowerCase();
  const shown = q
    ? projects.filter((p) =>
        `${p.name} ${p.path} ${p.origin ?? ''}`.toLowerCase().includes(q),
      )
    : projects;
  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-end justify-between gap-3 px-1">
        <h1 className="type-display">
          Projects
          {projects.length > 0 && (
            <span className="ml-2 font-normal text-subtle-foreground tabular">
              {projects.length}
            </span>
          )}
        </h1>
        <AddProjectButton />
      </header>
      {projects.length === 0 && <NoProjects />}
      {projects.length > FILTER_FROM && (
        <InputGroup className="h-8">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, folder or remote"
            aria-label="Filter projects"
          />
        </InputGroup>
      )}
      {projects.length > 0 && (
        <>
          <SettingsCard>
            {shown.map((p) => (
              <ProjectRow
                key={p.id}
                spaceId={spaceId}
                project={p}
                all={projects}
                usage={usage.get(p.path)}
              />
            ))}
            {shown.length === 0 && (
              <p className="px-4 py-6 text-center type-meta text-muted-foreground">
                No project matches “{query.trim()}”.
              </p>
            )}
          </SettingsCard>
          <p className="px-1 type-caption text-muted-foreground">{FOOTER}</p>
        </>
      )}
    </section>
  );
}

/** Another computer's projects, read there; Add project runs there too, in its own projects folder. */
function MachineProjects({ machine }: { machine: FollowedMachine }) {
  const { ask } = useMachines();
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects.machine(machine.id),
    queryFn: () => ask(machine.id, { type: 'projects' }),
  });
  const projects = projectsQuery.data ?? null;
  const error = projectsQuery.error ? gitError(projectsQuery.error) : null;
  const canAdd =
    machine.status === 'online' && machine.scopes.includes('manage');
  const add = canAdd && (
    <AddProjectButton
      machine={machine}
      onAdded={() => {
        void projectsQuery.refetch();
      }}
    />
  );

  if (error) return <p className="px-1 type-meta text-destructive">{error}</p>;
  if (!projects) return <Spinner className="mx-auto" />;
  return (
    <SettingsSection
      title={
        <CountedTitle title={`On ${machine.name}`} count={projects.length} />
      }
      action={add}
      footer={`Rename, remove, relocate and change icons on ${machine.name} itself.`}
    >
      <SettingsCard>
        {projects.length === 0 && (
          <p className="px-4 py-6 text-center type-meta text-muted-foreground">
            No projects yet
            {canAdd
              ? `; add one and it’s cloned or created on ${machine.name}`
              : ''}
            .
          </p>
        )}
        {projects.map((p) => (
          <ProjectLayout
            key={p.id}
            project={p}
            tile={<IconTile project={p} />}
          />
        ))}
      </SettingsCard>
    </SettingsSection>
  );
}

function CountedTitle({ title, count }: { title: string; count: number }) {
  return (
    <>
      {title}
      <span className="ml-1.5 font-normal text-subtle-foreground tabular">
        {count}
      </span>
    </>
  );
}

function NoProjects() {
  return (
    <Empty className="rounded-xl border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Folder />
        </EmptyMedia>
        <EmptyTitle>No projects yet</EmptyTitle>
        <EmptyDescription>
          A project is a folder your threads work in. Open one you have, clone
          one from GitHub or any git host, or start an empty one.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function AddProjectButton({
  machine,
  onAdded,
}: {
  machine?: FollowedMachine;
  onAdded?: () => void;
}) {
  const [isOpen, setOpen] = useState(false);
  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="xs">
          <FolderPlus />
          Add project
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <AddProject
          machine={machine}
          onAdded={(p) => {
            setOpen(false);
            onAdded?.();
            toast.success(`Added ${p.name}`);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

type Usage =
  ReturnType<typeof projectUsage> extends Map<string, infer U> ? U : never;

function ProjectRow({
  spaceId,
  project,
  all,
  usage,
}: {
  spaceId: string;
  project: Project;
  all: Project[];
  usage?: Usage;
}) {
  const { state, dispatch } = useHarness();
  const now = state.now;
  const [isRenaming, setRenaming] = useState(false);
  const attempt = (what: string, run: () => Promise<unknown>) =>
    run().catch((e: unknown) =>
      toast.error(`${what} failed`, { description: gitError(e) }),
    );
  const rename = (name: string) => {
    setRenaming(false);
    if (name.trim() && name.trim() !== project.name)
      void attempt('Renaming', () =>
        host.projects.rename(spaceId, project.id, name),
      );
  };
  const relocate = () =>
    attempt('Relocating', async () => {
      const path = await host.fs.pickFolder(
        project.path.replace(/[\\/][^\\/]+[\\/]?$/, ''),
      );
      if (path) await host.projects.relocate(spaceId, project.id, path);
    });
  const remove = () =>
    attempt('Removing', async () => {
      await host.projects.remove(spaceId, project.id);
      toast(`Removed ${project.name} from Projects`, {
        description: 'Its folder stays on disk.',
        action: {
          label: 'Undo',
          onClick: () => void attempt('Undo', () => restore(spaceId, project)),
        },
      });
    });
  const newThread = () => {
    requestNewThreadIn(project.path);
    dispatch({ type: 'go', view: { kind: 'new' } });
  };

  return (
    <ProjectLayout
      project={project}
      tile={<IconPicker spaceId={spaceId} project={project} />}
      name={
        isRenaming ? (
          <RenameField name={project.name} onDone={rename} />
        ) : undefined
      }
      facts={
        !!usage && (
          <span className="shrink-0 tabular">
            {threadCount(usage)} · {timeAgo(now - usage.lastAt)}
          </span>
        )
      }
      actions={
        <>
          {project.isMissing && (
            <Button variant="outline" size="xs" onClick={relocate}>
              Relocate…
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`${project.name} actions`}
              >
                <OverflowIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                disabled={project.isMissing}
                onSelect={newThread}
              >
                <Edit />
                New thread here
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => void toggleFavorite(spaceId, all, project.id)}
              >
                <Star filled={project.favoriteOrder !== null} />
                {project.favoriteOrder === null
                  ? 'Add to favorites'
                  : 'Remove from favorites'}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={project.isMissing}
                onSelect={() =>
                  void attempt('Showing the folder', () =>
                    host.fs.reveal(project.path, ''),
                  )
                }
              >
                <Folder />
                Show folder
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setRenaming(true)}>
                <Edit />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={relocate}>
                <FolderMove />
                Relocate…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={remove}>
                <Trash />
                Remove from list
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    />
  );
}

/** One project's row: its icon tile, then name, where it comes from and how much it's used, and where it lives. */
function ProjectLayout({
  project,
  tile,
  name,
  facts,
  actions,
}: {
  project: Project;
  tile: ReactNode;
  name?: ReactNode;
  facts?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="relative flex items-center gap-3 px-4 py-3 not-first:before:absolute not-first:before:inset-x-4 not-first:before:top-0 not-first:before:h-px not-first:before:bg-border">
      {tile}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {name ?? (
          <span className="truncate type-body font-medium text-foreground">
            {project.name}
          </span>
        )}
        <span className="flex min-w-0 items-center gap-2 type-caption text-muted-foreground">
          <OriginLabel origin={project.origin} />
          {facts}
        </span>
        {project.isMissing && (
          <span className="truncate type-caption text-warning">
            Folder not found at {project.path}
          </span>
        )}
        {!project.isMissing && project.path !== project.name && (
          <span className="truncate type-caption text-subtle-foreground">
            {project.path}
          </span>
        )}
      </div>
      {!!actions && (
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      )}
    </div>
  );
}

/** Where it's cloned from, with GitHub's mark for GitHub; a folder without a remote says so. */
function OriginLabel({ origin }: { origin: string | null }) {
  if (!origin) return <span className="shrink-0">Local folder</span>;
  const isGithub = origin.startsWith('github.com/');
  return (
    <span className="flex min-w-0 items-center gap-1">
      {isGithub ? (
        <GithubMarkIcon className="size-3 shrink-0" />
      ) : (
        <Link className="size-3 shrink-0" />
      )}
      <span className="truncate">
        {isGithub ? origin.slice('github.com/'.length) : origin}
      </span>
    </span>
  );
}

function threadCount({ open, total }: Usage) {
  const all = plural(total, '1 thread', `${total} threads`);
  return open > 0 && open < total ? `${open} open of ${all}` : all;
}

function IconTile({ project }: { project: Project }) {
  return (
    <span
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background',
        project.isMissing && 'opacity-50',
      )}
    >
      <ProjectIcon
        name={project.name}
        icon={project.icon}
        className="size-6 rounded-md"
      />
    </span>
  );
}

/** The icon tile is the button: the folder's favicon, an image you upload, or the letter. */
function IconPicker({
  spaceId,
  project,
}: {
  spaceId: string;
  project: Project;
}) {
  const [isOpen, setOpen] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const set = (icon: string) =>
    host.projects.setIcon(spaceId, project.id, icon).then(
      () => setOpen(false),
      (e: unknown) =>
        toast.error('Icon not changed', { description: gitError(e) }),
    );
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void set(await dataUrl(file));
  };

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Change ${project.name}’s icon`}
          className="group/tile relative rounded-lg focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <IconTile project={project} />
          <span
            aria-hidden
            className="absolute inset-0 flex items-center justify-center rounded-lg bg-foreground/50 text-background opacity-0 transition-opacity group-hover/tile:opacity-100 group-aria-expanded/tile:opacity-100"
          >
            <Image className="size-4" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1">
        <p className="px-2 pt-1 pb-1.5 type-meta font-medium">Icon</p>
        <IconChoice
          isChosen={project.iconMode === 'auto'}
          disabled={!project.favicon}
          onClick={() => void set('auto')}
          title="Favicon"
          detail={project.favicon ?? 'None found in the folder'}
        />
        <IconChoice
          isChosen={project.iconMode === 'custom'}
          onClick={() => upload.current?.click()}
          title={
            project.iconMode === 'custom'
              ? 'Your image (replace…)'
              : 'Upload an image…'
          }
          detail="SVG, PNG, ICO, JPEG or WebP, up to 512 KB"
        />
        <IconChoice
          isChosen={project.iconMode === 'none'}
          onClick={() => void set('none')}
          title="Letter"
          detail={`“${project.name.trim()[0]?.toUpperCase() ?? '?'}” on a tile`}
        />
        <input
          ref={upload}
          type="file"
          accept=".svg,.png,.ico,.jpg,.jpeg,.webp,.gif"
          className="hidden"
          onChange={(e) => void onFile(e)}
        />
      </PopoverContent>
    </Popover>
  );
}

function IconChoice({
  isChosen,
  disabled,
  onClick,
  title,
  detail,
}: {
  isChosen: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="type-body">{title}</span>
        <span className="truncate type-caption text-subtle-foreground">
          {detail}
        </span>
      </span>
      {isChosen && <Check className="size-4 shrink-0" />}
    </button>
  );
}

const ICON_TYPES = {
  svg: 'image/svg+xml',
  png: 'image/png',
  ico: 'image/x-icon',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
} satisfies Record<string, string>;

/** The file as a data URL with its type taken from its extension: browsers name .ico files differently. */
async function dataUrl(file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const type = ICON_TYPES[ext as keyof typeof ICON_TYPES] ?? file.type;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(binary)}`;
}

function RenameField({
  name,
  onDone,
}: {
  name: string;
  onDone: (name: string) => void;
}) {
  const [value, setValue] = useState(name);
  // Enter or Esc ends it, and the field's unmount then blurs it: once is enough.
  const isDone = useRef(false);
  const done = (next: string) => {
    if (isDone.current) return;
    isDone.current = true;
    onDone(next);
  };
  return (
    <Input
      autoFocus
      value={value}
      maxLength={100}
      aria-label="Project name"
      className="h-7 max-w-72"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => done(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') done(value);
        if (e.key !== 'Escape') return;
        e.preventDefault();
        done(name);
      }}
    />
  );
}

/** Undo for Remove: the same folder back under its name. */
async function restore(spaceId: string, project: Project) {
  const back = await host.projects.addFolder(spaceId, project.path);
  if (back.name !== project.name)
    await host.projects.rename(spaceId, back.id, project.name);
}
