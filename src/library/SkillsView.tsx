import { useEffect, useState } from 'react';
import { CheckBadge, Download, ExternalLink, Import, Plus } from '@/icons';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { toast } from '@/toast/store';
import { host } from '../host';
import { HARNESS_IDS, HARNESSES } from '../settings/harnesses';
import { SettingsCard, SettingsRow, SettingsSection, SkeletonRows } from '../settings/parts';
import { ProviderMark } from '../ui';
import { AddSkillsDialog } from './AddSkillsDialog';
import { FEATURED_SKILL_SOURCES } from './library';
import { LibraryPage, type PagePart } from './LibraryPage';
import { CatalogErrorRow, EmptyRow, filterBy, InstalledList, LibraryRow, PAGE } from './LibraryParts';
import { SKILLS_SH } from './skillsSh';
import { installedEntry, useLoaded, type Library } from './useLibrary';

/** Settings › Skills: the skills installed, which profiles get each, and skills in GitHub repos to add. */
export function SkillsView() {
  return (
    <LibraryPage
      id="skillsLibrary"
      noun="skills"
      description="Installed once, then handed to the profiles that should have them, or written where npx skills add puts them. Library skills load in Claude Code threads as /mochi:name."
      count={({ entries }) => entries?.filter((e) => e.kind === 'skill').length ?? 0}
      actions={({ library }) => (
        <>
          {host.isDesktop && <ImportMenu library={library} />}
          <AddFromGitHub library={library} />
        </>
      )}
      library={InstalledSkills}
      discover={SkillCatalog}
    />
  );
}

function InstalledSkills({ library, query, showDiscover }: Parameters<PagePart>[0]) {
  return (
    <SettingsSection>
      <InstalledList
        entries={library.entries?.filter((e) => e.kind === 'skill')}
        library={library}
        query={query}
        empty={
          <SettingsRow
            label="No skills yet"
            description="Skills teach agents how to do a kind of task. Add some from skills.sh or a GitHub repository."
            control={
              <Button variant="outline" size="sm" onClick={showDiscover}>
                Discover skills
              </Button>
            }
          />
        }
      />
    </SettingsSection>
  );
}

function SkillCatalog(props: Parameters<PagePart>[0]) {
  return (
    <div className="flex flex-col gap-10">
      <SkillsShCatalog {...props} />
      <FeaturedRepos {...props} />
    </div>
  );
}

const PREVIEW_ROWS = 20;
const INSTALLS = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** skills.sh, the skills CLI's directory: its leaderboard, or its search while the page search has 2+ characters. */
function SkillsShCatalog({ library, query }: Parameters<PagePart>[0]) {
  const search = useDebounced(query, 300);
  const isSearch = search.length >= 2;
  const { state, retry } = useLoaded(isSearch ? `search:${search}` : 'popular', () => (isSearch ? host.library.searchSkillsSh(search) : host.library.popularSkillsSh()));
  const [limit, setLimit] = useState(PREVIEW_ROWS);
  const [adding, setAdding] = useState<string | null>(null);
  // Under two characters skills.sh won't search: the leaderboard is filtered here instead.
  const skills = state.status === 'done' ? (isSearch ? state.value : filterBy(state.value, query, (s) => [s.name, s.source])) : [];
  return (
    <SettingsSection
      title={isSearch ? 'On skills.sh' : 'Popular on skills.sh'}
      action={
        <Button variant="ghost" size="xs" asChild>
          <a href={SKILLS_SH} target="_blank" rel="noreferrer">
            <ExternalLink data-icon="inline-start" />
            skills.sh
          </a>
        </Button>
      }
      footer={!query && 'The skills CLI’s directory, ranked by installs. Anyone can list a skill: Install shows its files first.'}
    >
      <SettingsCard>
        {state.status === 'loading' && <SkeletonRows count={4} />}
        {state.status === 'error' && <CatalogErrorRow what="skills.sh" message={state.message} onRetry={retry} />}
        {state.status === 'done' && !skills.length && <EmptyRow text={isSearch ? `Nothing on skills.sh matches “${search}”` : 'skills.sh listed nothing'} />}
        {skills.slice(0, limit).map((skill) => (
          <LibraryRow
            key={skill.id}
            name={skill.name}
            icon={skill.icon}
            meta={`${skill.source} · ${INSTALLS.format(skill.installs)} installs`}
            actions={
              <>
                <Button variant="ghost" size="icon-sm" asChild>
                  <a href={skill.url} target="_blank" rel="noreferrer" aria-label={`${skill.name} on skills.sh`}>
                    <ExternalLink />
                  </a>
                </Button>
                <AddControl isInstalled={!!installedEntry(library.entries, 'skill', skill.name)} name={skill.name} onAdd={() => setAdding(skill.installSource)} />
              </>
            }
          />
        ))}
        {skills.length > limit && (
          <div className="px-4 py-2">
            <Button variant="ghost" size="sm" onClick={() => setLimit((n) => n + PAGE)}>
              Show more
            </Button>
          </div>
        )}
      </SettingsCard>
      <AddSkillsDialog source={adding} onClose={() => setAdding(null)} library={library} />
    </SettingsSection>
  );
}

function FeaturedRepos({ library, query }: Parameters<PagePart>[0]) {
  const [source, setSource] = useState(FEATURED_SKILL_SOURCES[0]);
  const [adding, setAdding] = useState<string | null>(null);
  const { state, retry } = useLoaded(source, () => host.library.discoverSkills(source));
  const shown = state.status === 'done' ? filterBy(state.value, query, (s) => [s.name, s.description]) : [];
  return (
    <SettingsSection
      title="From GitHub"
      action={
        <ToggleGroup type="single" size="sm" variant="outline" value={source} onValueChange={(v) => v && setSource(v)}>
          {FEATURED_SKILL_SOURCES.map((s) => (
            <ToggleGroupItem key={s} value={s}>
              {s.split('/')[0]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      }
      footer={!query && 'Every SKILL.md in the repository, found as npx skills add finds them. Add from GitHub takes any other repository.'}
    >
      <SettingsCard>
        {state.status === 'loading' && <SkeletonRows count={4} />}
        {state.status === 'error' && <CatalogErrorRow what={source} message={state.message} onRetry={retry} />}
        {state.status === 'done' && !shown.length && <EmptyRow text={query ? `No skill in ${source} matches “${query}”` : `${source} has no skills`} />}
        {shown.map((skill) => (
          <LibraryRow
            key={skill.source}
            name={skill.name}
            icon={skill.icon}
            description={skill.description}
            meta={skill.source}
            actions={<AddControl isInstalled={!!installedEntry(library.entries, 'skill', skill.name)} name={skill.name} onAdd={() => setAdding(skill.source)} />}
          />
        ))}
      </SettingsCard>
      <AddSkillsDialog source={adding} onClose={() => setAdding(null)} library={library} />
    </SettingsSection>
  );
}

/** Install opens the add dialog on that one skill, so its files and destination are seen before anything is written. */
function AddControl({ isInstalled, name, onAdd }: { isInstalled: boolean; name: string; onAdd: () => void }) {
  if (isInstalled)
    return (
      <span className="flex h-7 w-24 items-center justify-end gap-1 type-meta text-muted-foreground">
        <CheckBadge aria-hidden className="size-3.5 text-success" />
        Installed
      </span>
    );
  return (
    <Button variant="outline" size="sm" className="w-24" onClick={onAdd} aria-label={`Install ${name}`}>
      <Download data-icon="inline-start" />
      Install
    </Button>
  );
}

function AddFromGitHub({ library }: { library: Library }) {
  const [adding, setAdding] = useState<string | null>(null);
  return (
    <>
      <Button size="xs" onClick={() => setAdding('')}>
        <Plus />
        Add from GitHub
      </Button>
      <AddSkillsDialog source={adding} onClose={() => setAdding(null)} library={library} />
    </>
  );
}

function useDebounced(value: string, ms: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** Copies what the profile's own Claude Code or Codex account already has into the library. */
function ImportMenu({ library }: { library: Library }) {
  const [busy, setBusy] = useState<string | null>(null);
  const importFrom = (provider: (typeof HARNESS_IDS)[number]) => {
    setBusy(provider);
    void library.importFromAccount(provider).then((notes) => {
      setBusy(null);
      if (notes) toast(`Imported from ${HARNESSES[provider].name}`, { description: notes.join(' ') || undefined });
    });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="xs" disabled={!!busy}>
          {busy ? <Spinner /> : <Import />}
          Import
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {HARNESS_IDS.map((provider) => (
          <DropdownMenuItem key={provider} onSelect={() => importFrom(provider)}>
            <ProviderMark provider={provider} size={14} />
            Skills and servers from {HARNESSES[provider].name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
