import { lazy, Suspense, useState } from 'react';
import {
  ChevronDown,
  Code,
  Download,
  FileText,
  Folder,
  Link,
  ShieldAlert,
  Skill,
  UserCircle,
  Users,
  type IconComponent,
} from '@/icons';
import { Button } from '@/components/ui/button';
import {
  ButtonGroup,
  ButtonGroupSeparator,
} from '@/components/ui/button-group';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { toast } from '@/toast/store';
import { MarkdownView } from '../files/MarkdownView';
import { host } from '../host';
import type { Provider } from '../model';
import { useProjects } from '../projects';
import { HARNESS_IDS, HARNESSES } from '../settings/harnesses';
import { SettingsSelect } from '../settings/parts';
import { useSpaceThreads, useHarnessSelector } from '../store';
import { ProviderMark, SpaceIcon } from '../ui';
import { useLibraryScope } from './libraryScope';
import {
  TRUSTED_SKILL_OWNERS,
  type CatalogSkill,
  type SkillDestination,
} from './library';
import {
  CatalogErrorRow,
  countOf,
  SimilarNote,
  useSimilarNative,
} from './LibraryParts';
import { parseSkillSource } from '@mochi/domain/library/skillSource';
import { installedEntry, useLoaded, type Library } from './useLibrary';

/**
 * Adds skills from GitHub the way `npx skills add <source>` does: any source form the CLI takes, every skill found in it
 * to pick from, each one's files to read before it installs, and where it goes. `source` starts it on a repo or a skill.
 */
export function AddSkillsDialog({
  source,
  onClose,
  library,
}: {
  source: string | null;
  onClose: () => void;
  library: Library;
}) {
  return (
    <Dialog open={source !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:h-[min(860px,calc(100dvh-4rem))] sm:max-w-[min(1160px,calc(100vw-4rem))]">
        {source !== null && (
          <AddSkillsForm
            initialSource={source}
            library={library}
            onDone={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// Lazy so CodeMirror parses only when a file that isn't markdown is opened.
const CodeEditor = lazy(() => import('../files/CodeEditor'));

// Inside the dialog's content, which unmounts on close, so each opening starts fresh.
function AddSkillsForm({
  initialSource,
  library,
  onDone,
}: {
  initialSource: string;
  library: Library;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(initialSource);
  const [source, setSource] = useState(initialSource);
  const { state, retry } = useLoaded(source, () =>
    source ? host.library.discoverSkills(source) : Promise.resolve([]),
  );
  const found = state.status === 'done' ? state.value : [];
  const [chosen, setChosen] = useState<string[] | null>(null);
  // One skill found (or `@skill`) is picked already; from a repo of several you pick, like the CLI's prompt.
  const picked = chosen ?? (found.length === 1 ? [found[0].name] : []);
  const [focused, setFocused] = useState<string | null>(null);
  const shown =
    found.find((s) => s.name === focused) ??
    found.find((s) => picked.includes(s.name)) ??
    found[0];
  const [destination, setDestination] = useDestination();
  const [isInstalling, setInstalling] = useState(false);
  const owner = parseSkillSource(source)?.owner ?? '';
  const isReady = !!picked.length && !isInstalling && destination.isValid;
  const install = async () => {
    setInstalling(true);
    let installed = 0;
    for (const skill of found.filter((s) => picked.includes(s.name)))
      if (await library.installSkill(source, skill, destination.value))
        installed++;
    setInstalling(false);
    if (!installed) return;
    toast.success(`Installed ${countOf(installed, 'skill')}`, {
      description: destination.summary,
    });
    onDone();
  };
  const toggle = (name: string, isOn: boolean) => {
    setChosen((was) => {
      const current = was ?? picked;
      return isOn
        ? [...current.filter((n) => n !== name), name]
        : current.filter((n) => n !== name);
    });
    setFocused(name);
  };
  const toggleAll = (isOn: boolean) =>
    setChosen(isOn ? found.map((s) => s.name) : []);
  const browse = () => {
    setChosen(null);
    setFocused(null);
    setSource(draft.trim());
  };
  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        if (isReady) void install();
      }}
    >
      <header className="flex flex-col gap-3 border-b px-5 pt-4 pr-12 pb-3">
        <div className="flex flex-col gap-0.5">
          <DialogTitle>Add skills from GitHub</DialogTitle>
          <DialogDescription>
            Like npx skills add: a repository, a folder in one, or one skill by
            name.
          </DialogDescription>
        </div>
        <InputGroup className="max-w-2xl">
          <InputGroupAddon>
            <Link />
          </InputGroupAddon>
          <InputGroupInput
            autoFocus={!initialSource}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              browse();
            }}
            placeholder="owner/repo, owner/repo@skill or a github.com link"
            aria-label="GitHub source"
          />
        </InputGroup>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto sm:flex-row sm:overflow-hidden">
        {!source ? (
          <EmptyBody text="Type a repository and press Enter to see its skills." />
        ) : state.status === 'error' ? (
          <div className="flex-1 p-4">
            <CatalogErrorRow
              what={source}
              message={state.message}
              onRetry={retry}
            />
          </div>
        ) : state.status === 'done' && !found.length ? (
          <EmptyBody text={`No SKILL.md in ${source}`} />
        ) : (
          <>
            <SkillList
              found={found}
              isLoading={state.status === 'loading'}
              picked={picked}
              shown={shown}
              library={library}
              onToggle={toggle}
              onToggleAll={toggleAll}
              onShow={setFocused}
            />
            {shown ? (
              <SkillFiles
                key={shown.source}
                source={source}
                skill={shown}
                owner={owner}
              />
            ) : (
              <div className="flex-1" />
            )}
          </>
        )}
      </div>
      <footer className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t px-5 py-3">
        {destination.scope === 'library' ? (
          <ScopeNote />
        ) : (
          <DestinationFields
            destination={destination}
            onChange={setDestination}
          />
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <InstallButton
            count={picked.length}
            destination={destination}
            onChange={setDestination}
            isReady={isReady}
            isBusy={isInstalling}
          />
        </div>
      </footer>
    </form>
  );
}

function EmptyBody({ text }: { text: string }) {
  return (
    <p className="flex flex-1 items-center justify-center p-8 text-center type-meta text-muted-foreground">
      {text}
    </p>
  );
}

/** The skills found, a checkbox each; the row you last touched is the one whose files show. */
function SkillList({
  found,
  isLoading,
  picked,
  shown,
  library,
  onToggle,
  onToggleAll,
  onShow,
}: {
  found: CatalogSkill[];
  isLoading: boolean;
  picked: string[];
  shown: CatalogSkill | undefined;
  library: Library;
  onToggle: (name: string, isOn: boolean) => void;
  onToggleAll: (isOn: boolean) => void;
  onShow: (name: string) => void;
}) {
  const similarTo = useSimilarNative();
  const isAllPicked = !!found.length && picked.length === found.length;
  return (
    <aside className="flex max-h-64 shrink-0 flex-col border-b sm:max-h-none sm:w-72 sm:border-r sm:border-b-0">
      {isLoading || found.length < 2 ? (
        <p className="px-4 pt-3 pb-1.5 type-caption text-muted-foreground">
          {isLoading
            ? 'Looking for SKILL.md…'
            : `${countOf(found.length, 'skill')} · ${picked.length} picked`}
        </p>
      ) : (
        // The CLI's "select all"; a repo has no way to say which of its skills it recommends.
        <label className="flex cursor-pointer items-center gap-2.5 px-4 pt-3 pb-1.5 type-caption text-muted-foreground">
          <Checkbox
            checked={isAllPicked || (!!picked.length && 'indeterminate')}
            onCheckedChange={() => onToggleAll(!isAllPicked)}
            aria-label="Pick every skill"
          />
          {countOf(found.length, 'skill')} · {picked.length} picked
        </label>
      )}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-px px-2 pb-2">
          {isLoading &&
            Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="mx-2 my-2 h-9" />
            ))}
          {found.map((skill) => {
            const isShown = skill === shown;
            return (
              <div
                key={skill.source}
                className={cn(
                  'flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors',
                  isShown ? 'bg-accent' : 'hover:bg-accent/60',
                )}
              >
                <Checkbox
                  className="mt-0.5"
                  checked={picked.includes(skill.name)}
                  onCheckedChange={(v) => onToggle(skill.name, v === true)}
                  aria-label={`Pick ${skill.name}`}
                />
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-col gap-0.5 text-left outline-none focus-visible:underline"
                  onClick={() => onShow(skill.name)}
                  aria-current={isShown || undefined}
                  aria-label={`Read ${skill.name}’s files`}
                >
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span
                      className={cn(
                        'truncate type-body font-medium',
                        !isShown && 'text-foreground/80',
                      )}
                    >
                      {skill.name}
                    </span>
                    {!!installedEntry(library.entries, 'skill', skill.name) && (
                      <span className="shrink-0 type-caption text-muted-foreground">
                        installed
                      </span>
                    )}
                  </span>
                  <span className="line-clamp-2 type-caption text-muted-foreground">
                    {skill.description}
                  </span>
                  <SimilarNote similar={similarTo(skill.name)} />
                </button>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </aside>
  );
}

/**
 * The skill's files as text, SKILL.md first: what an agent will read and may run, read here before it installs. Its name
 * heads it, file tabs run across the top, the file sits flush below, and what to watch for closes it.
 */
function SkillFiles({
  source,
  skill,
  owner,
}: {
  source: string;
  skill: CatalogSkill;
  owner: string;
}) {
  const { state, retry } = useLoaded(`${source}:${skill.name}`, () =>
    host.library.skillFiles(source, skill.name),
  );
  const files = state.status === 'done' ? state.value : {};
  const paths = Object.keys(files).sort(
    (a, b) =>
      Number(b === 'SKILL.md') - Number(a === 'SKILL.md') || a.localeCompare(b),
  );
  const [path, setPath] = useState('SKILL.md');
  const shownPath = files[path] === undefined ? 'SKILL.md' : path;
  const scripts = paths.filter(isScript);
  const isTrusted = TRUSTED_SKILL_OWNERS.includes(owner);
  return (
    <section
      className="flex min-h-96 min-w-0 flex-1 flex-col sm:min-h-0"
      aria-label={`${skill.name}’s files`}
    >
      <div className="flex flex-col gap-0.5 px-5 pt-4 pb-3">
        <h3 className="type-title">{skill.name}</h3>
        <p className="truncate type-caption text-muted-foreground">
          {skill.source}
        </p>
      </div>
      <Tabs
        value={shownPath}
        onValueChange={setPath}
        className="shrink-0 gap-0"
      >
        <TabsList
          variant="line"
          aria-label="Files"
          className="w-full justify-start overflow-x-auto px-4"
        >
          {state.status === 'loading' && <Skeleton className="h-4 w-40" />}
          {paths.map((p) => (
            <TabsTrigger
              key={p}
              value={p}
              className="flex-none px-2 font-mono text-xs"
            >
              <FileIcon path={p} />
              {p}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="min-h-0 flex-1">
        {state.status === 'error' && (
          <div className="p-4">
            <CatalogErrorRow
              what={skill.name}
              message={state.message}
              onRetry={retry}
            />
          </div>
        )}
        {state.status === 'done' && (
          <FileBody
            key={shownPath}
            path={shownPath}
            text={files[shownPath] ?? ''}
          />
        )}
      </div>
      <p
        className={cn(
          'flex items-start gap-2 border-t px-5 py-2.5 type-caption',
          isTrusted ? 'text-muted-foreground' : 'text-warning',
        )}
      >
        <ShieldAlert aria-hidden className="mt-px size-3.5 shrink-0" />
        {isTrusted
          ? 'Nothing runs when it installs. Agents follow SKILL.md and may run what it ships.'
          : `${owner} isn’t a source Mochi knows. Read SKILL.md${scripts.length ? ` and its ${countOf(scripts.length, 'script')}` : ''} first: agents follow it and may run what it ships. Nothing runs when it installs.`}
      </p>
    </section>
  );
}

/** Markdown rendered (its source a hover toggle away); everything else as highlighted, read-only code. */
function FileBody({ path, text }: { path: string; text: string }) {
  if (/\.(md|mdx|markdown)$/i.test(path))
    return <MarkdownView path={path} text={text} />;
  return (
    <Suspense>
      <CodeEditor readOnly isWrapped path={path} value={text} />
    </Suspense>
  );
}

function FileIcon({ path }: { path: string }) {
  const Icon = isScript(path) ? Code : FileText;
  return <Icon aria-hidden className="size-3.5 shrink-0" />;
}

const isScript = (path: string) =>
  /\.(sh|bash|zsh|py|js|mjs|cjs|ts|rb|pl|ps1)$/.test(path) ||
  path.startsWith('scripts/');

type Scope = SkillDestination['scope'];

const SCOPES = {
  library: {
    icon: Skill,
    title: 'Mochi library',
    action: 'Install to library',
    body: 'Per profile, in Claude Code threads as /mochi:name.',
  },
  user: {
    icon: UserCircle,
    title: 'Your account',
    action: 'Install to account',
    body: 'Like npx skills add -g: ~/.claude/skills and ~/.agents/skills. Every session sees it.',
  },
  project: {
    icon: Folder,
    title: 'A project',
    action: 'Install to project',
    body: 'Its .claude/skills and .agents/skills, so it travels with the repository.',
  },
} satisfies Record<
  Scope,
  { icon: IconComponent; title: string; action: string; body: string }
>;

type Destination = ReturnType<typeof useDestination>[0];
type ChangeDestination = ReturnType<typeof useDestination>[1];

/** GitHub's merge button: install to the chosen place, and a chevron to pick another; its fields show beside it. */
function InstallButton({
  count,
  destination,
  onChange,
  isReady,
  isBusy,
}: {
  count: number;
  destination: Destination;
  onChange: ChangeDestination;
  isReady: boolean;
  isBusy: boolean;
}) {
  const { action } = SCOPES[destination.scope];
  return (
    <ButtonGroup>
      <Button type="submit" disabled={!isReady}>
        {isBusy ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <Download data-icon="inline-start" />
        )}
        {count > 1 ? `${action} (${count})` : action}
      </Button>
      <ButtonGroupSeparator />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            aria-label="Choose where to install"
            disabled={isBusy}
          >
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuRadioGroup
            value={destination.scope}
            onValueChange={(v) => onChange({ scope: v as Scope })}
          >
            {(Object.keys(SCOPES) as Scope[]).map((scope) => {
              const Icon = SCOPES[scope].icon;
              return (
                <DropdownMenuRadioItem
                  key={scope}
                  value={scope}
                  disabled={scope === 'project' && !destination.projects.length}
                  className="items-start"
                >
                  <Icon
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="type-body font-medium">
                      {SCOPES[scope].title}
                    </span>
                    <span className="type-meta text-pretty text-muted-foreground">
                      {SCOPES[scope].body}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );
}

/** Where a library install goes: the profile the page shows, or every profile; changed at the top of the page. */
function ScopeNote() {
  const { profile } = useLibraryScope();
  return (
    <span className="flex items-center gap-1.5 type-meta text-muted-foreground">
      {profile ? (
        <SpaceIcon space={profile} className="size-3.5" />
      ) : (
        <Users aria-hidden className="size-3.5" />
      )}
      {profile ? `Adds to ${profile.name}` : 'Adds to every profile'}
    </span>
  );
}

/** What installing to an account or a project needs: which agents, and which project. */
function DestinationFields({
  destination,
  onChange,
}: {
  destination: Destination;
  onChange: ChangeDestination;
}) {
  const { scope, providers, projects, project } = destination;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {scope === 'project' && !!project && (
        <SettingsSelect
          aria-label="Project"
          value={project.path}
          options={projects.map((p) => ({ value: p.path, label: p.name }))}
          onChange={(path) => onChange({ projectPath: path })}
        />
      )}
      {HARNESS_IDS.map((provider) => (
        <label
          key={provider}
          className="flex cursor-pointer items-center gap-2 type-meta"
        >
          <Checkbox
            checked={providers.includes(provider)}
            onCheckedChange={(v) =>
              onChange({
                providers:
                  v === true
                    ? [...providers, provider]
                    : providers.filter((p) => p !== provider),
              })
            }
          />
          <ProviderMark provider={provider} size={14} />
          {HARNESSES[provider].name}
        </label>
      ))}
      {!providers.length && (
        <span className="type-caption text-destructive">
          Pick at least one agent
        </span>
      )}
    </div>
  );
}

/** Where an install goes, and whether the choice is complete (a project picked, an agent ticked). */
function useDestination() {
  const spaceId = useHarnessSelector((s) => s.spaceId);
  const projects = useProjects(spaceId, useSpaceThreads()) ?? [];
  const [scope, setScope] = useState<Scope>('library');
  const [providers, setProviders] = useState<Provider[]>([...HARNESS_IDS]);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const project = projects.find((p) => p.path === projectPath) ?? projects[0];
  const value: SkillDestination =
    scope === 'library'
      ? { scope }
      : scope === 'user'
        ? { scope, providers }
        : { scope, providers, project: project?.path ?? '' };
  const where =
    scope === 'user' ? 'your account' : (project?.name ?? 'a project');
  const destination = {
    scope,
    providers,
    projects,
    project,
    value,
    isValid:
      scope === 'library' ||
      (!!providers.length && (scope === 'user' || !!project)),
    summary:
      scope === 'library'
        ? 'In your Mochi library'
        : `In ${where} for ${providers.map((p) => HARNESSES[p].name).join(' and ')}`,
  };
  const change = (next: {
    scope?: Scope;
    providers?: Provider[];
    projectPath?: string;
  }) => {
    if (next.scope) setScope(next.scope);
    if (next.providers) setProviders(next.providers);
    if (next.projectPath) setProjectPath(next.projectPath);
  };
  return [destination, change] as const;
}
