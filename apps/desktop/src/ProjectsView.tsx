import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
  Download,
  Edit,
  Folder,
  FolderMove,
  FolderPlus,
  Image,
  Link,
  Monitor,
  Plus,
  Search,
  Star,
  Trash,
  Unlink,
} from '@/icons';
import { toast } from '@/toast/store';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { plural } from '@mochi/domain/lib/format';
import type { Project } from '@mochi/domain/host/types/projects';
import { AddProject } from './AddProject';
import {
  copyBlocker,
  isAway,
  queuedClone,
  repoNameFor,
  syncNeed,
  useCopyActions,
  useOutbox,
} from './copyActions';
import type { SyncDirection } from './git/copyStatus';
import { gitError } from './git/useGit';
import { host } from './host';
import { GithubMarkIcon } from './icons/github';
import { CopyFactLine, placeIn, WARNING_TEXT } from './PlacePicker';
import { SkippedItem } from './menus/ActionItems';
import {
  isOtherRepo,
  useCopyStatus,
  useProjectsWithCopies,
  type ProjectCopy,
  type ProjectWithCopies,
} from './projectCopies';
import { ProjectIcon } from './ProjectIcon';
import { timeAgo } from './progress';
import {
  projectUsage,
  refreshProjects,
  requestNewThreadIn,
  type Place,
} from './projects';
import {
  ComputerAvatar,
  HereBadge,
  startBlocker,
  useComputers,
  type Computer,
} from './remote/computers';
import { useHarness, useHarnessSelector, useSpaceThreads } from './store';
import { toggleFavorite } from './toggleFavorite';
import { OverflowIcon } from './ui';
import { queryClient } from './query';
import { queryKeys } from './queryKeys';

const FOOTER =
  'Folders with the same git remote are one project. Mochi never copies files between computers; git does. Removing a project only takes it off this list; its folder stays on disk.';

/**
 * Every project this profile works in, across your computers: projects on the left, the picked one's copies on the right,
 * one line per computer. A phone shows one pane at a time.
 */
export function ProjectsView() {
  const spaceId = useHarnessSelector((s) => s.spaceId);
  const projects = useProjectsWithCopies(spaceId);
  const computers = useComputers();
  const isMobile = useIsMobile();
  const [query, setQuery] = useState('');
  const [on, setOn] = useState(ALL);
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  useEffect(() => refreshProjects(spaceId), [spaceId]);
  if (!projects) return <Spinner className="mx-auto mt-16" />;

  const isMulti = computers.length > 1;
  const shown = matching(projects, query).filter(
    (p) => on === ALL || p.copies.some((c) => computerKey(c.machineId) === on),
  );
  const picked =
    shown.find((p) => p.key === pickedKey) ?? (isMobile ? undefined : shown[0]);
  const isDetailOnly = isMobile && !!picked;
  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex w-full max-w-280 flex-col gap-5 px-4 pt-6 pb-16 md:px-8 md:pt-8">
        <header className="flex items-center justify-between gap-3">
          <h1 className="type-display">
            Projects
            {projects.length > 0 && (
              <span className="ml-2 font-normal text-subtle-foreground tabular">
                {projects.length}
              </span>
            )}
          </h1>
          <AddProjectButton computers={computers} />
        </header>
        {projects.length === 0 && <NoProjects />}
        {projects.length > 0 && (
          <div className="flex items-start gap-6">
            {!isDetailOnly && (
              <div className="flex w-full flex-col gap-2 md:w-80 md:shrink-0">
                <div className="flex gap-2">
                  <InputGroup className="h-8 min-w-0 flex-1">
                    <InputGroupAddon>
                      <Search />
                    </InputGroupAddon>
                    <InputGroupInput
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Filter projects"
                      aria-label="Filter projects"
                    />
                  </InputGroup>
                  {isMulti && (
                    <ComputerFilter
                      computers={computers}
                      projects={projects}
                      value={on}
                      onChange={setOn}
                    />
                  )}
                </div>
                <ul className="flex flex-col gap-0.5" aria-label="Projects">
                  {shown.map((p) => (
                    <ProjectListRow
                      key={p.key}
                      project={p}
                      computers={computers}
                      isPicked={p === picked}
                      onPick={() => setPickedKey(p.key)}
                    />
                  ))}
                </ul>
                {shown.length === 0 && (
                  <p className="px-2 py-8 text-center type-meta text-muted-foreground">
                    No project matches.
                  </p>
                )}
              </div>
            )}
            {!!picked && (
              <ProjectDetail
                key={picked.key}
                spaceId={spaceId}
                project={picked}
                all={projects}
                computers={computers}
                onBack={isMobile ? () => setPickedKey(null) : undefined}
              />
            )}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

const ALL = 'all';
const HERE = 'here';
const computerKey = (machineId: string | null) => machineId ?? HERE;

function matching(projects: ProjectWithCopies[], query: string) {
  const q = query.trim().toLowerCase();
  return q
    ? projects.filter((p) =>
        `${p.name} ${p.origin ?? ''}`.toLowerCase().includes(q),
      )
    : projects;
}

/** One computer, or all of them, from a dropdown, so the control stays one size however many computers you pair. */
function ComputerFilter({
  computers,
  projects,
  value,
  onChange,
}: {
  computers: Computer[];
  projects: ProjectWithCopies[];
  value: string;
  onChange: (key: string) => void;
}) {
  const current = computers.find((c) => computerKey(c.id) === value);
  const countOn = (c: Computer) =>
    projects.filter((p) => p.copies.some((k) => k.machineId === c.id)).length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label={`Show projects on: ${current?.name ?? 'All computers'}`}
            className="h-8 max-w-40 min-w-0 justify-start font-normal"
          />
        }
      >
        {current ? <ComputerAvatar computer={current} /> : <Monitor />}
        <span className="min-w-0 flex-1 truncate text-left">
          {current?.name ?? 'All computers'}
        </span>
        <ChevronDown className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem
          onClick={() => onChange(ALL)}
          className={cn(value === ALL && 'bg-accent')}
        >
          <Monitor />
          All computers
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {computers.map((c) => (
          <DropdownMenuItem
            key={computerKey(c.id)}
            onClick={() => onChange(computerKey(c.id))}
            className={cn(computerKey(c.id) === value && 'bg-accent')}
          >
            <ComputerAvatar computer={c} />
            <span className="min-w-0 flex-1 truncate">{c.name}</span>
            <span className="shrink-0 type-caption text-subtle-foreground tabular">
              {countOn(c)}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Name, then the one thing it needs from you (or where it's from), then the computers holding a copy. */
function ProjectListRow({
  project,
  computers,
  isPicked,
  onPick,
}: {
  project: ProjectWithCopies;
  computers: Computer[];
  isPicked: boolean;
  onPick: () => void;
}) {
  const nudge = projectNudge(project, computers);
  const holders = holdersOf(project, computers);
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        aria-current={isPicked || undefined}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left outline-none hover:bg-accent/60 focus-visible:bg-accent aria-current:bg-accent"
      >
        <ProjectIcon
          name={project.name}
          icon={project.icon}
          className="size-7 shrink-0 rounded-md"
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate type-body font-medium text-foreground">
            {project.name}
          </span>
          {nudge ? (
            <span className={cn('truncate type-caption', WARNING_TEXT)}>
              {nudge}
            </span>
          ) : (
            <span className="truncate type-caption text-muted-foreground">
              {project.origin ? remotePath(project.origin) : 'No git remote'}
            </span>
          )}
        </span>
        {computers.length > 1 && <HolderMarks computers={holders} />}
      </button>
    </li>
  );
}

const MAX_MARKS = 3;

/** The computers holding a copy, side by side; past three, a count. Each names itself on hover. */
function HolderMarks({ computers }: { computers: Computer[] }) {
  const extra = computers.length - MAX_MARKS;
  const shown = computers.slice(0, extra > 0 ? MAX_MARKS - 1 : MAX_MARKS);
  return (
    <span
      aria-label={`On ${computers.map((c) => c.name).join(', ')}`}
      className="flex shrink-0 items-center gap-1.5"
    >
      {shown.map((c) => (
        <ComputerAvatar
          key={computerKey(c.id)}
          computer={c}
          surface="background"
        />
      ))}
      {extra > 0 && (
        <span className="flex h-4 min-w-4 items-center justify-center rounded-sm bg-muted px-1 text-[10px] leading-none text-muted-foreground tabular">
          +{extra + 1}
        </span>
      )}
    </span>
  );
}

function ProjectDetail({
  spaceId,
  project,
  all,
  computers,
  onBack,
}: {
  spaceId: string;
  project: ProjectWithCopies;
  all: ProjectWithCopies[];
  computers: Computer[];
  onBack?: () => void;
}) {
  const { state, dispatch } = useHarness();
  const threads = useSpaceThreads();
  const [isRenaming, setRenaming] = useState(false);
  const { outbox, cancel } = useOutbox();
  const isMulti = computers.length > 1;
  const local = project.copies.find((c) => !!c.local)?.local;
  const usage = local && projectUsage(threads).get(local.path);
  const newThread = (place: Place) => {
    requestNewThreadIn(place);
    dispatch({ type: 'go', view: { kind: 'new' } });
  };
  const rename = (name: string) => {
    setRenaming(false);
    if (local && name.trim() && name.trim() !== local.name)
      void attempt('Renaming', () =>
        host.projects.rename(spaceId, local.id, name),
      );
  };
  const localProjects = all.flatMap((p) =>
    p.copies.flatMap((c) => c.local ?? []),
  );
  return (
    <section
      aria-label={project.name}
      className="flex min-w-0 flex-1 flex-col gap-5"
    >
      {!!onBack && (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 self-start"
          onClick={onBack}
        >
          <ArrowLeft />
          Projects
        </Button>
      )}
      <header className="flex items-center gap-3">
        {local ? (
          <IconPicker spaceId={spaceId} project={local} />
        ) : (
          <IconTile name={project.name} icon={project.icon} />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {isRenaming ? (
            <RenameField name={project.name} onDone={rename} />
          ) : (
            <h2 className="truncate type-title text-foreground">
              {project.name}
            </h2>
          )}
          <span className="flex min-w-0 items-center gap-2 type-caption text-muted-foreground">
            <OriginLabel origin={project.origin} />
            {!!usage && (
              <span className="min-w-0 truncate tabular">
                {threadCount(usage)} · {timeAgo(state.now - usage.lastAt)}
              </span>
            )}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => newThread(placeIn(project, computers))}
        >
          <Edit />
          <span className="max-sm:sr-only">New thread</span>
        </Button>
      </header>
      <div className="flex flex-col gap-2">
        <div className="flex min-h-7 items-center justify-between gap-3">
          <h3 className="type-meta font-medium text-foreground">
            {isMulti
              ? `On ${plural(project.copies.length, '1 computer', `${project.copies.length} computers`)}`
              : 'Folder'}
          </h3>
          {isMulti && (
            <AddCopyMenu project={project} all={all} computers={computers} />
          )}
        </div>
        <ul className="flex flex-col rounded-xl border bg-card">
          {project.copies.map((copy) => (
            <CopyRow
              key={computerKey(copy.machineId)}
              spaceId={spaceId}
              project={project}
              copy={copy}
              computer={
                computers.find((c) => c.id === copy.machineId) ?? {
                  id: copy.machineId,
                  name: 'Unknown computer',
                  kind: undefined,
                }
              }
              isMulti={isMulti}
              localProjects={localProjects}
              cloneTo={computers.filter(
                (c) =>
                  !project.copies.some((k) => k.machineId === c.id) &&
                  !copyBlocker(c),
              )}
              onNewThread={() =>
                newThread({ machineId: copy.machineId, ref: copy.ref })
              }
              onRename={() => setRenaming(true)}
            />
          ))}
          {computers.map((c) => {
            const mail = queuedClone(outbox, project, c);
            return (
              !!mail && (
                <QueuedCopyRow
                  key={mail.id}
                  computer={c}
                  onCancel={() => void cancel(mail)}
                />
              )
            );
          })}
        </ul>
        <p className="px-1 type-caption text-muted-foreground">{FOOTER}</p>
      </div>
    </section>
  );
}

/** One computer's copy: which computer, its branch and state, where the folder is, and what you can do with it there. */
function CopyRow({
  spaceId,
  project,
  copy,
  computer,
  isMulti,
  localProjects,
  cloneTo,
  onNewThread,
  onRename,
}: {
  spaceId: string;
  project: ProjectWithCopies;
  copy: ProjectCopy;
  computer: Computer;
  isMulti: boolean;
  localProjects: Project[];
  /** The computers without a copy that a published folder can be cloned onto. */
  cloneTo: Computer[];
  onNewThread: () => void;
  onRename: () => void;
}) {
  const { local } = copy;
  const { unlink, sync } = useCopyActions();
  const status = useCopyStatus(copy);
  const need = isOtherRepo(copy, project) ? null : syncNeed(status);
  // Only a hand link can be undone: copies joined by their remote stay one project.
  const unlinkAction: MenuAction[] =
    copy.linkId && project.copies.length > 1
      ? [
          {
            label: 'Make it its own project',
            icon: <Unlink />,
            onSelect: () => void unlink(copy, [computer]),
            blocker: copyBlocker(computer),
            startsGroup: true,
          },
        ]
      : [];
  const actions = local
    ? localActions(
        spaceId,
        local,
        localProjects,
        onNewThread,
        onRename,
        unlinkAction,
      )
    : [
        { label: NEW_THREAD, icon: <Edit />, onSelect: onNewThread },
        ...unlinkAction,
      ];
  return (
    <WithContextMenu actions={actions}>
      <li className="flex items-center gap-3 px-4 py-3 not-first:border-t">
        {isMulti ? (
          <ComputerAvatar computer={computer} size="lg" surface="card" />
        ) : (
          <Folder className="size-5 shrink-0 text-muted-foreground" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate type-body font-medium text-foreground">
              {isMulti ? computer.name : (local?.path ?? copy.name)}
            </span>
            {isMulti && <HereBadge computer={computer} />}
          </span>
          <CopyFactLine copy={copy} project={project} className="type-meta" />
          {isMulti && !!local && (
            <span className="truncate type-caption text-subtle-foreground">
              {local.path}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!!local?.isMissing && (
            <Button
              variant="outline"
              size="xs"
              onClick={() => void relocate(spaceId, local)}
            >
              Relocate…
            </Button>
          )}
          {!!need && (
            <SyncButton
              direction={need}
              blocker={startBlocker(computer)}
              onSync={() => sync(copy, need)}
            />
          )}
          {/* A project with no remote anywhere: the folder itself goes up, from the computer that holds it. */}
          {!project.origin && !local?.isMissing && (
            <PublishButton
              project={project}
              copy={copy}
              computer={computer}
              cloneTo={cloneTo}
            />
          )}
          <OverflowMenu
            actions={actions}
            label={`${project.name} on ${computer.name} actions`}
          />
        </div>
      </li>
    </WithContextMenu>
  );
}

const NEW_THREAD = 'New thread here';

/** A clone waiting in an offline computer's mailbox: it runs when that computer connects, until you take it back. */
function QueuedCopyRow({
  computer,
  onCancel,
}: {
  computer: Computer;
  onCancel: () => void;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3 not-first:border-t">
      <ComputerAvatar
        computer={computer}
        size="lg"
        surface="card"
        className="opacity-60"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate type-body font-medium text-foreground">
          {computer.name}
        </span>
        <span className="truncate type-meta text-muted-foreground">
          Clones when it’s back online
        </span>
      </div>
      <Button variant="ghost" size="xs" onClick={onCancel}>
        Cancel
      </Button>
    </li>
  );
}

/**
 * Put on GitHub: the repository's name (the folder's, made safe), private by default, and the other computers it's then
 * cloned onto, ticked. Runs on the computer that holds the folder, with its own GitHub login; that computer must be online.
 */
function PublishButton({
  project,
  copy,
  computer,
  cloneTo,
}: {
  project: ProjectWithCopies;
  copy: ProjectCopy;
  computer: Computer;
  cloneTo: Computer[];
}) {
  const { publish } = useCopyActions();
  const [isOpen, setOpen] = useState(false);
  const [name, setName] = useState(() => repoNameFor(copy.name));
  const [isPrivate, setPrivate] = useState(true);
  const [isCloning, setCloning] = useState(true);
  const [isBusy, setBusy] = useState(false);
  const blocker = startBlocker(computer);
  const nameId = useId();
  const privateId = useId();
  const cloneId = useId();
  const submit = async () => {
    setBusy(true);
    const origin = await publish(project, copy, {
      name: name.trim(),
      visibility: isPrivate ? 'private' : 'public',
      cloneTo: isCloning ? cloneTo : [],
    });
    setBusy(false);
    if (origin) setOpen(false);
  };
  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="outline" size="xs" disabled={!!blocker} />}
      >
        <GithubMarkIcon className="size-3" />
        Put on GitHub
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3 p-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={nameId}>Repository name</Label>
          <Input
            id={nameId}
            autoFocus
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <label
          htmlFor={privateId}
          className="flex items-center justify-between gap-3 type-body"
        >
          Private
          <Switch
            id={privateId}
            checked={isPrivate}
            onCheckedChange={setPrivate}
          />
        </label>
        {cloneTo.length > 0 && (
          <label htmlFor={cloneId} className="flex items-start gap-2 type-body">
            <Checkbox
              id={cloneId}
              checked={isCloning}
              onCheckedChange={(on) => setCloning(on === true)}
              className="mt-0.5"
            />
            <span className="flex min-w-0 flex-col">
              Then clone it on every computer
              <span className="type-caption text-muted-foreground">
                {cloneTo.map((c) => c.name).join(', ')}; one that’s offline
                clones when it’s back
              </span>
            </span>
          </label>
        )}
        <p className="type-caption text-muted-foreground">
          {computer.name} commits what’s in the folder and pushes it, with its
          own GitHub login.
        </p>
        <Button
          size="sm"
          disabled={isBusy || !name.trim()}
          onClick={() => void submit()}
        >
          {isBusy && <Spinner />}
          Put on GitHub
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** The one git action a copy needs, run on its computer; busy while it runs, and saying why when that computer can't. */
function SyncButton({
  direction,
  blocker,
  onSync,
}: {
  direction: SyncDirection;
  blocker: string | undefined;
  onSync: () => Promise<void>;
}) {
  const [isSyncing, setSyncing] = useState(false);
  const button = (
    <Button
      size="xs"
      variant="outline"
      disabled={!!blocker || isSyncing}
      onClick={() => {
        setSyncing(true);
        void onSync().finally(() => setSyncing(false));
      }}
    >
      {isSyncing ? (
        <Spinner />
      ) : direction === 'pull' ? (
        <ArrowDown />
      ) : (
        <ArrowUp />
      )}
      {direction === 'pull' ? 'Pull' : 'Push'}
    </Button>
  );
  if (!blocker) return button;
  return (
    <Tooltip>
      <TooltipTrigger render={<span />}>{button}</TooltipTrigger>
      <TooltipContent>{blocker}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Puts the project on a computer that doesn't have it: Clone there from its remote, or Link one of the projects already
 * there as its copy (a fork, a renamed remote, a plain folder). Clone on every computer first when more than one can.
 */
function AddCopyMenu({
  project,
  all,
  computers,
}: {
  project: ProjectWithCopies;
  all: ProjectWithCopies[];
  computers: Computer[];
}) {
  const { clone, link } = useCopyActions();
  const { outbox } = useOutbox();
  const holders = holdersOf(project, computers);
  const missing = computers.filter(
    (c) => !holders.includes(c) && !queuedClone(outbox, project, c),
  );
  if (missing.length === 0) return null;
  // An offline computer is cloned on by mail, once it's back.
  const cloneable = project.origin
    ? missing.filter((c) => !copyBlocker(c))
    : [];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="xs" />}>
        <Plus />
        Add a copy
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {cloneable.length > 1 && (
          <>
            <DropdownMenuItem
              onClick={() => cloneable.forEach((c) => void clone(project, c))}
            >
              <Download />
              Clone on every computer
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {missing.map((c, i) => {
          const blocker = copyBlocker(c);
          const candidates = all.flatMap((p) =>
            p === project ? [] : p.copies.filter((k) => k.machineId === c.id),
          );
          return (
            <Fragment key={computerKey(c.id)}>
              {i > 0 && <DropdownMenuSeparator />}
              {!!project.origin &&
                (blocker ? (
                  <SkippedItem
                    menu="dropdown"
                    icon={<Download />}
                    title={`Clone on ${c.name}`}
                    reason={blocker}
                  />
                ) : (
                  <DropdownMenuItem onClick={() => void clone(project, c)}>
                    <Download />
                    Clone on {c.name}
                    {isAway(c) && ' when it’s back'}
                  </DropdownMenuItem>
                ))}
              {blocker || candidates.length === 0 ? (
                <SkippedItem
                  menu="dropdown"
                  icon={<Link />}
                  title={`Link a project on ${c.name}`}
                  reason={blocker ?? `${c.name} has no other projects`}
                />
              ) : (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Link />
                    Link a project on {c.name}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-60">
                    {candidates.map((k) => (
                      <DropdownMenuItem
                        key={k.ref}
                        onClick={() => void link(project, k, computers)}
                      >
                        <ProjectIcon name={k.name} icon={k.icon} />
                        <span className="min-w-0 flex-1 truncate">
                          {k.name}
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
            </Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** What this computer's own copy offers: the registry's actions, run here. */
function localActions(
  spaceId: string,
  project: Project,
  all: Project[],
  onNewThread: () => void,
  onRename: () => void,
  /** Placed just before Remove, the destructive one, which stays last. */
  more: MenuAction[],
): MenuAction[] {
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
  return [
    {
      label: NEW_THREAD,
      icon: <Edit />,
      onSelect: onNewThread,
      disabled: project.isMissing,
    },
    {
      label:
        project.favoriteOrder === null
          ? 'Add to favorites'
          : 'Remove from favorites',
      icon: <Star filled={project.favoriteOrder !== null} />,
      onSelect: () => void toggleFavorite(spaceId, all, project.id),
    },
    {
      label: 'Show folder',
      icon: <Folder />,
      disabled: project.isMissing,
      onSelect: () =>
        void attempt('Showing the folder', () =>
          host.fs.reveal(project.path, ''),
        ),
    },
    { label: 'Rename', icon: <Edit />, onSelect: onRename, startsGroup: true },
    {
      label: 'Relocate…',
      icon: <FolderMove />,
      onSelect: () => void relocate(spaceId, project),
    },
    ...more,
    {
      label: 'Remove from list',
      icon: <Trash />,
      onSelect: () => void remove(),
      isDestructive: true,
      startsGroup: true,
    },
  ];
}

const attempt = (what: string, run: () => Promise<unknown>) =>
  run().catch((e: unknown) =>
    toast.error(`${what} failed`, { description: gitError(e) }),
  );

const relocate = (spaceId: string, project: Project) =>
  attempt('Relocating', async () => {
    const path = await host.fs.pickFolder(
      project.path.replace(/[\\/][^\\/]+[\\/]?$/, ''),
    );
    if (path) await host.projects.relocate(spaceId, project.id, path);
  });

/** The one thing a project needs from you, read from what's known without asking anyone. */
function projectNudge(project: ProjectWithCopies, computers: Computer[]) {
  const nameOf = (copy: ProjectCopy) =>
    computers.find((c) => c.id === copy.machineId)?.name ?? 'Another computer';
  const missing = project.copies.find((c) => c.local?.isMissing);
  if (missing) return 'Folder not found on this computer';
  const other = project.copies.find((c) => isOtherRepo(c, project));
  if (other) return `Different repo on ${nameOf(other)}`;
  const behind = project.copies.find(
    (c) => (c.status?.upstream?.behind ?? 0) > 0,
  );
  if (behind) return `${nameOf(behind)} needs a pull`;
  const ahead = project.copies.find(
    (c) => (c.status?.upstream?.ahead ?? 0) > 0,
  );
  if (ahead) return `Unpushed commits on ${nameOf(ahead)}`;
  return null;
}

function holdersOf(project: ProjectWithCopies, computers: Computer[]) {
  return computers.filter((c) =>
    project.copies.some((k) => k.machineId === c.id),
  );
}

function remotePath(origin: string) {
  return origin.startsWith('github.com/')
    ? origin.slice('github.com/'.length)
    : origin;
}

function NoProjects() {
  return (
    <Empty>
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

/**
 * Add project, here or on another computer you can start threads on: with more than one, it asks where first, and the
 * clone or new folder lands in that computer's own projects folder.
 */
function AddProjectButton({ computers }: { computers: Computer[] }) {
  const [isOpen, setOpen] = useState(false);
  const targets = computers.filter(
    (c) =>
      !c.machine ||
      (c.machine.status === 'online' && c.machine.scopes.includes('manage')),
  );
  const [target, setTarget] = useState<Computer | null>(null);
  const where = targets.length === 1 ? targets[0] : target;
  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        setOpen(open);
        if (!open) setTarget(null);
      }}
    >
      <PopoverTrigger render={<Button size="sm" />}>
        <FolderPlus />
        Add project
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        {where ? (
          <AddProject
            machine={where.machine}
            onBack={targets.length > 1 ? () => setTarget(null) : undefined}
            onAdded={(p) => {
              setOpen(false);
              setTarget(null);
              // This computer's list follows its registry; another's is in its catalog, read again here.
              if (where.machine)
                void queryClient.invalidateQueries({
                  queryKey: queryKeys.remote.catalog(where.machine.id, true),
                });
              toast.success(
                where.machine
                  ? `Added ${p.name} on ${where.name}`
                  : `Added ${p.name}`,
              );
            }}
          />
        ) : (
          <div className="flex flex-col gap-0.5 p-1.5">
            <p className="px-2 pt-1 pb-1.5 type-meta font-medium">
              Add a project on
            </p>
            {targets.map((c) => (
              <button
                key={computerKey(c.id)}
                type="button"
                onClick={() => setTarget(c)}
                className="flex h-10 items-center gap-2.5 rounded-md px-2 text-left type-body hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <ComputerAvatar computer={c} size="md" />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <HereBadge computer={c} />
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// {MENUS}

interface MenuAction {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Why it can't run right now, shown on the item instead of running it. */
  blocker?: string;
  isDestructive?: boolean;
  startsGroup?: boolean;
}

/** The ⋯ button's menu; the same actions open on right-click through `WithContextMenu`. */
function OverflowMenu({
  actions,
  label,
}: {
  actions: MenuAction[];
  label: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={label} />}
      >
        <OverflowIcon vertical />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <MenuItems actions={actions} kind="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WithContextMenu({
  actions,
  children,
}: {
  actions: MenuAction[];
  children: ReactElement;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent className="w-52">
        <MenuItems actions={actions} kind="context" />
      </ContextMenuContent>
    </ContextMenu>
  );
}

const MENU_PARTS = {
  dropdown: { Item: DropdownMenuItem, Separator: DropdownMenuSeparator },
  context: { Item: ContextMenuItem, Separator: ContextMenuSeparator },
} as const;

function MenuItems({
  actions,
  kind,
}: {
  actions: MenuAction[];
  kind: keyof typeof MENU_PARTS;
}) {
  const { Item, Separator } = MENU_PARTS[kind];
  return actions.map((a, i) => (
    <Fragment key={a.label}>
      {a.startsGroup && i > 0 && <Separator />}
      {a.blocker ? (
        <SkippedItem
          menu={kind}
          icon={a.icon}
          title={a.label}
          reason={a.blocker}
        />
      ) : (
        <Item
          disabled={a.disabled}
          variant={a.isDestructive ? 'destructive' : 'default'}
          onClick={a.onSelect}
        >
          {a.icon}
          {a.label}
        </Item>
      )}
    </Fragment>
  ));
}

// {PROJECT PARTS}

/** Where it's cloned from, with GitHub's mark for GitHub; a folder without a remote says so. */
function OriginLabel({ origin }: { origin: string | null }) {
  if (!origin) return <span className="shrink-0">No git remote</span>;
  const isGithub = origin.startsWith('github.com/');
  return (
    <span className="flex min-w-0 items-center gap-1">
      {isGithub ? (
        <GithubMarkIcon className="size-3 shrink-0" />
      ) : (
        <Link className="size-3 shrink-0" />
      )}
      <span className="truncate">{remotePath(origin)}</span>
    </span>
  );
}

type Usage =
  ReturnType<typeof projectUsage> extends Map<string, infer U> ? U : never;

function threadCount({ open, total }: Usage) {
  const all = plural(total, '1 thread', `${total} threads`);
  return open > 0 && open < total ? `${open} open of ${all}` : all;
}

function IconTile({
  name,
  icon,
  isDimmed,
}: {
  name: string;
  icon: Project['icon'];
  isDimmed?: boolean;
}) {
  return (
    <span
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background',
        isDimmed && 'opacity-50',
      )}
    >
      <ProjectIcon name={name} icon={icon} className="size-6 rounded-md" />
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
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Change ${project.name}’s icon`}
            className="group/tile relative rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2"
          />
        }
      >
        <IconTile
          name={project.name}
          icon={project.icon}
          isDimmed={project.isMissing}
        />
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center rounded-lg bg-foreground/50 text-background opacity-0 transition-opacity group-hover/tile:opacity-100 group-aria-expanded/tile:opacity-100"
        >
          <Image className="size-4" />
        </span>
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
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50"
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
