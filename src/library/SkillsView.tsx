import { useState } from 'react';
import { Import, Link } from '@/icons';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { toast } from '@/toast/store';
import { host } from '../host';
import { HARNESS_IDS, HARNESSES } from '../settings/harnesses';
import { SettingsCard, SettingsRow, SettingsSection, SkeletonRows } from '../settings/parts';
import { ProviderMark } from '../ui';
import { FEATURED_SKILL_SOURCES } from './library';
import { LibraryPage, type PagePart } from './LibraryPage';
import { CatalogErrorRow, EmptyRow, filterBy, InstallControl, InstalledList, LibraryRow } from './LibraryParts';
import { installedEntry, useLoaded, type Library } from './useLibrary';

/** Settings › Skills: the skills installed, which profiles get each, and skills in GitHub repos to add. */
export function SkillsView() {
  return (
    <LibraryPage
      id="skillsLibrary"
      noun="skills"
      description="Installed once, then handed to the profiles that should have them. Claude Code threads load each as /mochi:name; Codex threads don’t get library skills yet."
      count={({ entries }) => entries?.filter((e) => e.kind === 'skill').length ?? 0}
      actions={host.isDesktop ? ({ library }) => <ImportMenu library={library} /> : undefined}
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
            description="Skills teach agents how to do a kind of task. Add some from a GitHub repository."
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

const OTHER_REPO = 'other';

function SkillCatalog({ library, query }: Parameters<PagePart>[0]) {
  const [source, setSource] = useState(FEATURED_SKILL_SOURCES[0]);
  const [draft, setDraft] = useState('');
  const isFeatured = FEATURED_SKILL_SOURCES.includes(source);
  const [picked, setPicked] = useState(source);
  const { state, retry } = useLoaded(source, () => host.library.discoverSkills(source));
  const shown = state.status === 'done' ? filterBy(state.value, query, (s) => [s.name, s.description]) : [];
  return (
    <SettingsSection
      title="From GitHub"
      action={
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={isFeatured ? source : picked}
          onValueChange={(v) => {
            if (!v) return;
            setPicked(v);
            if (v !== OTHER_REPO) setSource(v);
          }}
        >
          {FEATURED_SKILL_SOURCES.map((s) => (
            <ToggleGroupItem key={s} value={s}>
              {s.split('/')[0]}
            </ToggleGroupItem>
          ))}
          <ToggleGroupItem value={OTHER_REPO}>Other repo</ToggleGroupItem>
        </ToggleGroup>
      }
      footer={!query && 'Every folder with a SKILL.md in a public GitHub repository, read as text. A skill’s scripts run only when an agent uses it.'}
    >
      {(picked === OTHER_REPO || !isFeatured) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) setSource(draft.trim());
          }}
        >
          <InputGroup>
            <InputGroupAddon>
              <Link />
            </InputGroupAddon>
            <InputGroupInput autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="owner/repo, or a github.com link, then Enter" aria-label="GitHub repository to browse for skills" />
          </InputGroup>
        </form>
      )}
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
            actions={<InstallControl entry={installedEntry(library.entries, 'skill', skill.name)} name={skill.name} install={() => library.installSkill(source, skill)} />}
          />
        ))}
      </SettingsCard>
    </SettingsSection>
  );
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
