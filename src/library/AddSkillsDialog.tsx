import { useState } from 'react';
import { Code, Download, FileText, Link, ShieldAlert } from '@/icons';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { toast } from '@/toast/store';
import { host } from '../host';
import type { Provider } from '../model';
import { useProjects } from '../projects';
import { HARNESS_IDS, HARNESSES } from '../settings/harnesses';
import { SkeletonRows } from '../settings/parts';
import { useHarness, useSpaceThreads } from '../store';
import { ProviderMark } from '../ui';
import { TRUSTED_SKILL_OWNERS, type CatalogSkill, type SkillDestination } from './library';
import { CatalogErrorRow, countOf, EmptyRow } from './LibraryParts';
import { parseSkillSource } from './skillSource';
import { installedEntry, useLoaded, type Library } from './useLibrary';

/**
 * Adds skills from GitHub the way `npx skills add <source>` does: any source form the CLI takes, every skill found in it
 * to pick from, each one's files to read before it installs, and where it goes. `source` starts it on a repo or a skill.
 */
export function AddSkillsDialog({ source, onClose, library }: { source: string | null; onClose: () => void; library: Library }) {
  return (
    <Dialog open={source !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="h-[calc(100dvh-2rem)] grid-rows-[minmax(0,1fr)] sm:h-[min(880px,calc(100dvh-4rem))] sm:max-w-[min(1200px,calc(100vw-4rem))]">{source !== null && <AddSkillsForm initialSource={source} library={library} onDone={onClose} />}</DialogContent>
    </Dialog>
  );
}


type Scope = SkillDestination['scope'];

// Inside the dialog's content, which unmounts on close, so each opening starts fresh.
function AddSkillsForm({ initialSource, library, onDone }: { initialSource: string; library: Library; onDone: () => void }) {
  const [draft, setDraft] = useState(initialSource);
  const [source, setSource] = useState(initialSource);
  const { state, retry } = useLoaded(source, () => (source ? host.library.discoverSkills(source) : Promise.resolve([])));
  const found = state.status === 'done' ? state.value : [];
  const [chosen, setChosen] = useState<string[] | null>(null);
  // One skill found (or `@skill`) is picked already; from a repo of several you pick, like the CLI's prompt.
  const picked = chosen ?? (found.length === 1 ? [found[0].name] : []);
  const [focused, setFocused] = useState<string | null>(null);
  const shown = found.find((s) => s.name === focused) ?? found.find((s) => picked.includes(s.name)) ?? found[0];
  const [destination, setDestination] = useDestination();
  const [isInstalling, setInstalling] = useState(false);
  const owner = parseSkillSource(source)?.owner;
  const isTrusted = !!owner && TRUSTED_SKILL_OWNERS.includes(owner);
  const isReady = !!picked.length && !isInstalling && destination.isValid;
  const install = async () => {
    setInstalling(true);
    const skills = found.filter((s) => picked.includes(s.name));
    let installed = 0;
    for (const skill of skills) if (await library.installSkill(source, skill, destination.value)) installed++;
    setInstalling(false);
    if (!installed) return;
    toast.success(`Installed ${countOf(installed, 'skill')}`, { description: destination.summary });
    onDone();
  };
  const toggle = (name: string, isOn: boolean) => {
    setChosen(isOn ? [...picked, name] : picked.filter((n) => n !== name));
    setFocused(name);
  };
  return (
    <form
      className="-mx-4 flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto px-4 sm:mx-0 sm:overflow-visible sm:px-0"
      onSubmit={(e) => {
        e.preventDefault();
        if (isReady) void install();
      }}
    >
      <DialogHeader>
        <DialogTitle>Add skills from GitHub</DialogTitle>
        <DialogDescription>Like npx skills add: a repository, a folder in one, or one skill by name.</DialogDescription>
      </DialogHeader>
      <InputGroup>
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
            setChosen(null);
            setFocused(null);
            setSource(draft.trim());
          }}
          placeholder="owner/repo, owner/repo@skill or a github.com link, then Enter"
          aria-label="GitHub source"
        />
      </InputGroup>
      {!!source && (
        <div className="grid shrink-0 gap-3 sm:min-h-0 sm:flex-1 sm:shrink sm:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="flex max-h-60 min-h-0 min-w-0 flex-col overflow-y-auto rounded-xl border sm:max-h-none">
            {state.status === 'loading' && <SkeletonRows count={3} />}
            {state.status === 'error' && <CatalogErrorRow what={source} message={state.message} onRetry={retry} />}
            {state.status === 'done' && !found.length && <EmptyRow text={`No SKILL.md in ${source}`} />}
            {found.map((skill) => (
              <FoundSkillRow key={skill.source} skill={skill} isPicked={picked.includes(skill.name)} isShown={skill === shown} isInstalled={!!installedEntry(library.entries, 'skill', skill.name)} onToggle={(isOn) => toggle(skill.name, isOn)} onShow={() => setFocused(skill.name)} />
            ))}
          </div>
          {!!shown && <SkillFiles key={shown.source} source={source} skill={shown} isTrusted={isTrusted} owner={owner ?? ''} />}
        </div>
      )}
      {!!found.length && <DestinationPicker destination={destination} onChange={setDestination} />}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!isReady}>
          {isInstalling ? <Spinner data-icon="inline-start" /> : <Download data-icon="inline-start" />}
          {picked.length > 1 ? `Install ${countOf(picked.length, 'skill')}` : 'Install'}
        </Button>
      </DialogFooter>
    </form>
  );
}

function FoundSkillRow({ skill, isPicked, isShown, isInstalled, onToggle, onShow }: { skill: CatalogSkill; isPicked: boolean; isShown: boolean; isInstalled: boolean; onToggle: (isOn: boolean) => void; onShow: () => void }) {
  return (
    <div className={cn('flex items-start gap-2.5 px-3 py-2.5 not-first:border-t', isShown && 'bg-accent/50')}>
      <Checkbox className="mt-0.5" checked={isPicked} onCheckedChange={(v) => onToggle(v === true)} aria-label={`Pick ${skill.name}`} />
      <button type="button" className="flex min-w-0 flex-1 flex-col gap-0.5 text-left outline-none focus-visible:underline" onClick={onShow} aria-label={`Read ${skill.name}’s files`}>
        <span className="flex items-center gap-1.5 truncate type-body font-medium">
          {skill.name}
          {isInstalled && <span className="type-caption font-normal text-muted-foreground">installed</span>}
        </span>
        <span className="line-clamp-2 type-caption text-muted-foreground">{skill.description}</span>
      </button>
    </div>
  );
}

/**
 * The skill's files as text, SKILL.md first: what an agent will read and may run, read here before it installs. Files on
 * the left, the open one filling the rest; what to watch for sits under it.
 */
function SkillFiles({ source, skill, isTrusted, owner }: { source: string; skill: CatalogSkill; isTrusted: boolean; owner: string }) {
  const { state, retry } = useLoaded(`${source}:${skill.name}`, () => host.library.skillFiles(source, skill.name));
  const files = state.status === 'done' ? state.value : {};
  const paths = Object.keys(files).sort((a, b) => Number(b === 'SKILL.md') - Number(a === 'SKILL.md') || a.localeCompare(b));
  const [path, setPath] = useState('SKILL.md');
  const scripts = paths.filter(isScript);
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-2">
      <div className="grid h-96 min-h-0 overflow-hidden rounded-xl border sm:h-auto sm:flex-1 sm:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label={`${skill.name}’s files`} className="flex max-h-32 min-w-0 flex-col gap-px overflow-y-auto border-b p-1.5 sm:max-h-none sm:border-r sm:border-b-0">
          {state.status === 'loading' && <SkeletonRows count={3} />}
          {paths.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPath(p)}
              aria-current={p === path || undefined}
              className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left font-mono text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground aria-current:bg-accent aria-current:text-foreground"
            >
              {isScript(p) ? <Code aria-hidden className="size-3.5 shrink-0" /> : <FileText aria-hidden className="size-3.5 shrink-0" />}
              <span className="truncate">{p}</span>
            </button>
          ))}
        </nav>
        <pre className="min-h-0 min-w-0 overflow-auto bg-muted/40 p-4 font-mono text-xs/5 break-words whitespace-pre-wrap text-foreground" aria-label={`${path} of ${skill.name}`}>
          {files[path] ?? files['SKILL.md']}
        </pre>
      </div>
      {state.status === 'error' && <CatalogErrorRow what={skill.name} message={state.message} onRetry={retry} />}
      {!isTrusted && (
        <p className="flex items-start gap-1.5 type-caption text-warning">
          <ShieldAlert aria-hidden className="mt-px size-3.5 shrink-0" />
          {owner} isn’t a source Mochi knows. Read SKILL.md{scripts.length ? ` and its ${countOf(scripts.length, 'script')}` : ''} first: agents follow it, and may run what it ships. Nothing runs when it installs.
        </p>
      )}
    </div>
  );
}

const isScript = (path: string) => /\.(sh|bash|zsh|py|js|mjs|cjs|ts|rb|pl|ps1)$/.test(path) || path.startsWith('scripts/');

const SCOPES = {
  library: { title: 'Mochi library', body: 'Loaded per profile into Claude Code threads as /mochi:name; you pick the profiles.' },
  user: { title: 'Your account', body: 'Like npx skills add -g: ~/.claude/skills for Claude Code, ~/.agents/skills for Codex. Every session sees it.' },
  project: { title: 'A project', body: 'Its .claude/skills and .agents/skills, so it travels with the repository.' },
} satisfies Record<Scope, { title: string; body: string }>;

type Destination = ReturnType<typeof useDestination>[0];

/** Where an install goes, and whether the choice is complete (a project picked, an agent ticked). */
function useDestination() {
  const { spaceId } = useHarness().state;
  const projects = useProjects(spaceId, useSpaceThreads()) ?? [];
  const [scope, setScope] = useState<Scope>('library');
  const [providers, setProviders] = useState<Provider[]>([...HARNESS_IDS]);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const project = projects.find((p) => p.path === projectPath) ?? projects[0];
  const value: SkillDestination = scope === 'library' ? { scope } : scope === 'user' ? { scope, providers } : { scope, providers, project: project?.path ?? '' };
  const where = scope === 'library' ? 'Mochi library' : scope === 'user' ? 'your account' : (project?.name ?? 'a project');
  const destination = {
    scope,
    providers,
    projects,
    project,
    value,
    isValid: scope === 'library' || (!!providers.length && (scope === 'user' || !!project)),
    summary: scope === 'library' ? 'In your Mochi library' : `In ${where} for ${providers.map((p) => HARNESSES[p].name).join(' and ')}`,
  };
  const change = (next: { scope?: Scope; providers?: Provider[]; projectPath?: string }) => {
    if (next.scope) setScope(next.scope);
    if (next.providers) setProviders(next.providers);
    if (next.projectPath) setProjectPath(next.projectPath);
  };
  return [destination, change] as const;
}

function DestinationPicker({ destination, onChange }: { destination: Destination; onChange: ReturnType<typeof useDestination>[1] }) {
  const { scope, providers, projects, project } = destination;
  return (
    <div className="flex flex-col gap-2">
      <span className="type-body font-medium">Install to</span>
      <RadioGroup value={scope} onValueChange={(v) => onChange({ scope: v as Scope })} aria-label="Install to" className="grid gap-2 sm:grid-cols-3">
        {(Object.keys(SCOPES) as Scope[]).map((s) => (
          <label
            key={s}
            htmlFor={`skill-scope-${s}`}
            className="flex cursor-pointer gap-2.5 rounded-xl border p-3 transition-colors hover:bg-accent/40 has-data-checked:border-foreground/25 has-data-checked:bg-accent/50 has-disabled:cursor-not-allowed has-disabled:opacity-60"
          >
            <RadioGroupItem id={`skill-scope-${s}`} value={s} disabled={s === 'project' && !projects.length} className="mt-0.5" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="type-body font-medium">{SCOPES[s].title}</span>
              <span className="type-caption text-pretty text-muted-foreground">{SCOPES[s].body}</span>
            </span>
          </label>
        ))}
      </RadioGroup>
      {scope !== 'library' && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
          {scope === 'project' && (
            <NativeSelect size="sm" value={project?.path} onChange={(e) => onChange({ projectPath: e.target.value })} aria-label="Project">
              {projects.map((p) => (
                <NativeSelectOption key={p.id} value={p.path}>
                  {p.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
          {HARNESS_IDS.map((provider) => (
            <label key={provider} className="flex cursor-pointer items-center gap-2 type-meta">
              <Checkbox checked={providers.includes(provider)} onCheckedChange={(v) => onChange({ providers: v === true ? [...providers, provider] : providers.filter((p) => p !== provider) })} />
              <ProviderMark provider={provider} size={14} />
              {HARNESSES[provider].name}
            </label>
          ))}
          {!providers.length && <span className="type-caption text-destructive">Pick at least one agent</span>}
        </div>
      )}
    </div>
  );
}
