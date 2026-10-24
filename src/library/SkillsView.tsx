import { useEffect, useState } from 'react';
import { CheckBadge, Download, ExternalLink, Import, Plus } from '@/icons';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/toast/store';
import { host } from '../host';
import { HARNESS_IDS, HARNESSES } from '../settings/harnesses';
import { SettingsCard, SettingsRow, SettingsSection, SkeletonRows } from '../settings/parts';
import { ProviderMark } from '../ui';
import { AddSkillsDialog } from './AddSkillsDialog';
import { LibraryPage, type PagePart } from './LibraryPage';
import { NativeSections } from './NativeSections';
import { CatalogErrorRow, EmptyRow, EntryRow, filterBy, GroupControl, LibraryRow, PAGE, SimilarNote, useSimilarNative } from './LibraryParts';
import { SkillGroups } from './SkillGroups';
import { SKILLS_SH } from './skillsSh';
import { installedEntry, useLoaded, type Library } from './useLibrary';

/** Settings › Skills: the skills installed, which profiles get each, and skills.sh or any GitHub repo to add from. */
export function SkillsView() {
  return (
    <LibraryPage
      id="skillsLibrary"
      noun="skills"
      description="Installed once, then handed to the profiles that should have them, or written where npx skills add puts them. Library skills load in Claude Code threads as /owner:name, owner being the GitHub account they came from (mochi for your own)."
      count={({ entries }) => entries?.filter((e) => e.kind === 'skill').length ?? 0}
      actions={({ library }) => (
        <>
          {host.isDesktop && <ImportMenu library={library} />}
          <AddFromGitHub library={library} />
        </>
      )}
      library={InstalledSkills}
      discover={SkillsShCatalog}
    />
  );
}

function InstalledSkills({ library, query, showDiscover }: Parameters<PagePart>[0]) {
  const skills = library.entries && filterBy(library.entries.filter((e) => e.kind === 'skill'), query, (e) => [e.title, e.description, e.source]);
  return (
    <>
      <SettingsSection title="In Mochi">
        <SettingsCard>
          {!skills && <SkeletonRows count={2} />}
          {skills?.length === 0 &&
            (query ? (
              <EmptyRow text={`Nothing in your library matches “${query}”`} />
            ) : (
              <SettingsRow
                label="No skills yet"
                description="Skills teach agents how to do a kind of task. Add some from skills.sh or a GitHub repository."
                control={
                  <Button variant="outline" size="sm" onClick={showDiscover}>
                    Discover skills
                  </Button>
                }
              />
            ))}
          {!!skills?.length && (
            <SkillGroups
              entries={skills}
              row={(entry) => <EntryRow entry={entry} library={library} />}
              control={(group) => <GroupControl entries={group.entries} name={group.repo} library={library} />}
            />
          )}
        </SettingsCard>
      </SettingsSection>
      <NativeSections kinds={['skill']} query={query} />
    </>
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
  const similarTo = useSimilarNative();
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
      footer={!query && 'The skills CLI’s directory, ranked by installs. Anyone can list a skill: Install shows its files first. Add from GitHub takes any repository.'}
    >
      <SettingsCard>
        {state.status === 'loading' && <SkeletonRows count={4} />}
        {state.status === 'error' && <CatalogErrorRow what="skills.sh" message={state.message} onRetry={retry} />}
        {state.status === 'done' && !skills.length && <EmptyRow text={isSearch ? `Nothing on skills.sh matches “${search}”` : 'skills.sh listed nothing'} />}
        {skills.slice(0, limit).map((skill) => {
          const isInstalled = !!installedEntry(library.entries, 'skill', skill.name);
          const similar = isInstalled ? [] : similarTo(skill.name);
          return (
          <LibraryRow
            key={skill.id}
            name={skill.name}
            icon={skill.icon}
            meta={`${skill.source} · ${INSTALLS.format(skill.installs)} installs`}
            status={!!similar.length && <SimilarNote similar={similar} />}
            actions={
              <>
                <Button variant="ghost" size="icon-sm" asChild>
                  <a href={skill.url} target="_blank" rel="noreferrer" aria-label={`${skill.name} on skills.sh`}>
                    <ExternalLink />
                  </a>
                </Button>
                <AddControl isInstalled={isInstalled} name={skill.name} onAdd={() => setAdding(skill.installSource)} />
              </>
            }
          />
          );
        })}
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

/** Install opens the add dialog on that one skill, so its files and destination are seen before anything is written. */
function AddControl({ isInstalled, name, onAdd }: { isInstalled: boolean; name: string; onAdd: () => void }) {
  if (isInstalled)
    return (
      <span className="flex h-7 w-24 items-center justify-end gap-1 type-meta text-muted-foreground">
        <CheckBadge aria-hidden className="size-3.5 text-success" />
        In library
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
