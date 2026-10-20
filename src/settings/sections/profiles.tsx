import { useEffect, useState } from 'react';
import { Connector, Plugin, Plus, Skill, Trash } from '@/icons';
import { toast } from '@/toast/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useConfirm } from '../../git/useConfirm';
import { formatGithubAccount, GITHUB_COM } from '../../git/github';
import { gitError } from '../../git/useGit';
import type { GhAccount } from '../../host/types/git';
import { host } from '../../host';
import { keyName } from '../../keys';
import { SPACE_ICON_NAMES, type Provider, type Space, type SpaceIconName } from '../../model';
import { addProfile, getProfiles, MAX_PROFILES, removeProfile, updateProfile, useProfiles } from '../../profiles';
import { useHarness } from '../../store';
import { ProviderMark, SPACE_ICONS, SpaceIcon } from '../../ui';
import { AgentConfigRows } from '../ProfileAgentConfig';
import { useAgentSettings } from '../AgentSettings';
import { HARNESS_IDS, HARNESSES } from '../harnesses';
import { CatalogRow } from '../CatalogRow';
import { openSettings, useLinkedTab } from '../open';
import { useLibrary } from '../../library/useLibrary';
import { countOf } from '../../library/LibraryParts';
import { setAllOff } from '../../library/nativeOff';
import { useNativeItems } from '../../library/useNativeItems';
import { DesktopOnlyNotice, SettingsGroup, SettingsRow, SettingsSelect, settingControlId, UNDO_MS } from '../parts';

/** One profile at a time behind a tab per profile: what it's called, how it looks in the sidebar, and what it signs in with. */
export function ProfilesSection() {
  const profiles = useProfiles();
  const gh = useGhAccounts();
  const { confirm, dialog } = useConfirm();
  const [shownId, setShownId] = useShownProfile(profiles);
  const shown = profiles.find((p) => p.id === shownId) ?? profiles[0];
  return (
    <div className="flex flex-col gap-10">
      <p className="type-meta text-muted-foreground">Each profile is a space in the sidebar with its own threads, agent accounts and browser logins. Switch with the icons at the bottom of the sidebar.</p>
      {!host.isDesktop && <DesktopOnlyNotice what="Choosing GitHub and agent accounts and clearing browsing data need the Mochi desktop app." />}
      <Tabs value={shown.id} onValueChange={setShownId} className="gap-4">
        <TabsList variant="line" className="w-full justify-start overflow-x-auto">
          {profiles.map((profile) => (
            <TabsTrigger key={profile.id} value={profile.id} className="flex-none px-2">
              <SpaceIcon space={profile} className="size-3.5" />
              {profile.name}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={shown.id} className="flex flex-col gap-10">
          <ProfileGroup key={shown.id} profile={shown} isLast={profiles.length === 1} gh={gh} confirm={confirm} />
          <NativeGroup profile={shown} />
        </TabsContent>
      </Tabs>
      <AddProfileGroup isFull={profiles.length >= MAX_PROFILES} onAdded={setShownId} />
      {dialog}
    </div>
  );
}

/** The profile on screen: the one a deep link names (`<profileId>-<row>`), else the one you're in. */
function useShownProfile(profiles: Space[]) {
  const { state } = useHarness();
  return useLinkedTab((settingId) => profiles.find((p) => settingId.startsWith(`${p.id}-`))?.id, state.spaceId);
}

function ProfileGroup({ profile, isLast, gh, confirm }: { profile: Space; isLast: boolean; gh: GhAccountsState; confirm: ReturnType<typeof useConfirm>['confirm'] }) {
  const { id } = profile;
  return (
    <SettingsGroup id={`${id}-profile`}>
      <CatalogRow settingKey="profile.name" profile={profile} />
      <CatalogRow settingKey="profile.icon" profile={profile} />
      {host.isDesktop && <GitHubAccountRow profile={profile} gh={gh} />}
      {host.isDesktop && HARNESS_IDS.map((provider) => <CatalogRow key={provider} settingKey={`profile.${provider}Account`} profile={profile} />)}
      <AgentConfigRows profile={profile} />
      <LibraryRow profile={profile} />
      {host.isDesktop && <ClearBrowsingRow profile={profile} confirm={confirm} />}
      <RemoveProfileRow profile={profile} isLast={isLast} />
    </SettingsGroup>
  );
}

const NEW_ITEM_OPTIONS = [
  { value: 'on', label: 'Load them' },
  { value: 'off', label: 'Only what I add' },
] as const;

/** What this profile takes from its own Claude Code and Codex accounts: everything on or off at once, and what new items do. */
function NativeGroup({ profile }: { profile: Space }) {
  const accounts = useNativeItems()?.filter((a) => a.profileIds.includes(profile.id));
  if (!accounts?.length) return null;
  return (
    <SettingsGroup title="Claude Code and Codex" footer={`Mochi never changes Claude Code’s or Codex’s own files. What you turn off here only leaves Mochi threads in ${profile.name}.`}>
      {accounts.map(({ account, items }) => {
        const { provider } = account;
        const harness = HARNESSES[provider].name;
        const switchable = items.filter((i) => !i.isOffNatively);
        const off = switchable.filter((i) => profile.nativeOff?.includes(i.id));
        const isAllOff = !!switchable.length && off.length === switchable.length;
        const mode = profile.nativeNew?.[provider] ?? 'on';
        return [
          <SettingsRow
            key={`${provider}-all`}
            id={`${profile.id}-native-${provider}`}
            label={
              <span className="flex items-center gap-2">
                <ProviderMark provider={provider} size={14} />
                Everything from {harness}
              </span>
            }
            description={`${account.name} account · ${countOf(items.length, 'item')}${off.length ? `, ${off.length} off in Mochi` : ''}`}
            control={
              <Button variant="outline" size="sm" disabled={!switchable.length} onClick={() => setAllOff(profile, switchable, !isAllOff, harness)}>
                {isAllOff ? 'Turn all on' : 'Turn all off'}
              </Button>
            }
          />,
          <SettingsRow
            key={`${provider}-new`}
            id={`${profile.id}-native-new-${provider}`}
            label={`New in ${harness}`}
            description={mode === 'on' ? `What you add to ${harness} later loads here too` : `What you add to ${harness} later arrives off; turn it on in Skills, Plugins or Connectors`}
            control={
              <SettingsSelect
                id={`${profile.id}-native-new-${provider}`}
                value={mode}
                options={NEW_ITEM_OPTIONS}
                onChange={(next) => updateProfile(profile.id, { nativeNew: { ...profile.nativeNew, [provider]: next } })}
              />
            }
          />,
        ];
      })}
    </SettingsGroup>
  );
}

type GhAccountsState = { accounts?: GhAccount[]; error?: string };

/** gh's logins, read when the page opens and again when the window regains focus (after a `gh auth login` in a terminal). */
function useGhAccounts(isNeeded = true): GhAccountsState {
  const [state, setState] = useState<GhAccountsState>({});
  useEffect(() => {
    if (!host.isDesktop || !isNeeded) return;
    const load = () => host.git.ghAccounts().then((accounts) => setState({ accounts }), (error: Error) => setState({ error: gitError(error) }));
    load();
    addEventListener('focus', load);
    return () => removeEventListener('focus', load);
  }, [isNeeded]);
  return state;
}

// Radix Select can't hold '' (the profile's "use gh's active account").
const ACTIVE = 'gh-active';

function GitHubAccountRow({ profile, gh }: { profile: Space; gh: GhAccountsState }) {
  const rowId = `${profile.id}-github`;
  const isMissing = !!profile.github && !!gh.accounts && !gh.accounts.some((a) => a.isValid && formatGithubAccount(a) === profile.github);
  const description = gh.error
    ? `Couldn't ask gh for its logins: ${gh.error}`
    : isMissing
      ? `gh has no working login for ${profile.github}. Run gh auth login, then come back.`
      : 'This profile’s threads push and open pull requests as this account. Add one with gh auth login.';
  return (
    <SettingsRow
      id={rowId}
      label="GitHub account"
      description={<span className={cn(isMissing && 'text-warning')}>{description}</span>}
      control={<GitHubAccountSelect id={rowId} value={profile.github} gh={gh} onChange={(github) => updateProfile(profile.id, { github })} />}
    />
  );
}

/** gh's working logins plus "Active account" (stored as ''); pass `gh` when the caller already reads them. */
export function GitHubAccountSelect({ id, value, gh: given, onChange }: { id: string; value: string; gh?: GhAccountsState; onChange: (github: string) => void }) {
  const own = useGhAccounts(!given);
  const gh = given ?? own;
  const working = gh.accounts?.filter((a) => a.isValid) ?? [];
  const active = gh.accounts?.find((a) => a.isActive && a.host === GITHUB_COM);
  const isMissing = !!value && !!gh.accounts && !working.some((a) => formatGithubAccount(a) === value);
  const options = [
    { value: ACTIVE, label: active ? `Active account (${active.login})` : 'Active account' },
    ...working.map((a) => ({ value: formatGithubAccount(a), label: a.host === GITHUB_COM ? a.login : `${a.login} (${a.host})` })),
    ...(isMissing ? [{ value, label: `${value} (signed out)` }] : []),
  ];
  return <SettingsSelect id={id} value={value || ACTIVE} options={options} onChange={(v) => onChange(v === ACTIVE ? '' : v)} disabled={!gh.accounts} className="w-56" />;
}

const ICON_LABELS = { work: 'Briefcase', home: 'Home', layers: 'Layers', code: 'Code', book: 'Book', rocket: 'Rocket', coffee: 'Coffee', star: 'Star' } satisfies Record<SpaceIconName, string>;

/** Profiles are told apart by icon, not colour, so each icon is one tap away. */
export function IconPicker({ id, value, onChange }: { id: string; value: string; onChange: (icon: string) => void }) {
  return (
    <ToggleGroup
      id={id}
      type="single"
      size="sm"
      variant="outline"
      spacing={1}
      value={value}
      onValueChange={(icon) => icon && onChange(icon)}
      className="flex-wrap"
    >
      {SPACE_ICON_NAMES.map((name) => {
        const Icon = SPACE_ICONS[name];
        return (
          <Tooltip key={name}>
            {/* On a wrapper: as the trigger itself, the tooltip's data-state="closed" would overwrite the toggle's data-state="on". */}
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <ToggleGroupItem value={name} aria-label={ICON_LABELS[name]} className="size-7 px-0">
                  <Icon aria-hidden />
                </ToggleGroupItem>
              </span>
            </TooltipTrigger>
            <TooltipContent>{ICON_LABELS[name]}</TooltipContent>
          </Tooltip>
        );
      })}
    </ToggleGroup>
  );
}

/** The harness's accounts; one serves several profiles. */
export function AccountSelect({ id, provider, value, onChange }: { id: string; provider: Provider; value: string; onChange: (accountId: string) => void }) {
  const { accounts } = useAgentSettings();
  const own = accounts?.accounts.filter((a) => a.provider === provider) ?? [];
  return <SettingsSelect id={id} value={value} options={own.map((a) => ({ value: a.id, label: a.name }))} onChange={onChange} disabled={!accounts} />;
}

const LIBRARY_PAGES = [
  { kind: 'skills', label: 'Skills', icon: Skill },
  { kind: 'plugins', label: 'Plugins', icon: Plugin },
  { kind: 'connectors', label: 'Connectors', icon: Connector },
] as const;

/** Skills, plugins and connectors are installed once and handed to profiles in Settings › Customize; the row says how many this one has. */
function LibraryRow({ profile }: { profile: Space }) {
  const { entries } = useLibrary(profile.id);
  const on = entries?.filter((e) => e.isEnabled).length;
  const open = (kind: (typeof LIBRARY_PAGES)[number]['kind']) => openSettings(kind);
  return (
    <SettingsRow
      label="Skills, plugins and connectors"
      description={on === undefined ? 'What this profile’s threads load beyond the account’s own setup.' : `${on} ${THREADS.select(on) === 'one' ? 'item' : 'items'} on. What this profile’s threads load beyond the account’s own setup.`}
      control={
        <div className="flex flex-wrap items-center gap-1.5">
          {LIBRARY_PAGES.map(({ kind, label, icon: Icon }) => (
            <Button key={kind} variant="outline" size="sm" onClick={() => open(kind)}>
              <Icon data-icon="inline-start" />
              {label}
            </Button>
          ))}
        </div>
      }
    />
  );
}

function ClearBrowsingRow({ profile, confirm }: { profile: Space; confirm: ReturnType<typeof useConfirm>['confirm'] }) {
  const rowId = `${profile.id}-browsing`;
  const clear = async () => {
    const isConfirmed = await confirm({
      title: `Clear ${profile.name}'s browsing data?`,
      description: 'Cookies, logins, site storage and cache in this profile’s browser tabs go. Open pages stay open, signed out. Other profiles keep theirs.',
      confirm: 'Clear browsing data',
      cancel: 'Keep it',
      isDestructive: true,
    });
    if (!isConfirmed) return;
    host.browser.clearData(profile.id).then(
      () => toast(`${profile.name}'s browsing data cleared`),
      (error: Error) => toast.error('Browsing data not cleared', { description: error.message }),
    );
  };
  return (
    <SettingsRow
      id={rowId}
      label="Browser"
      description="Its own cookies and logins, apart from other profiles."
      control={
        <Button id={settingControlId(rowId)} variant="outline" size="sm" onClick={() => void clear()}>
          Clear browsing data
        </Button>
      }
    />
  );
}

function RemoveProfileRow({ profile, isLast }: { profile: Space; isLast: boolean }) {
  const { state, dispatch } = useHarness();
  const threadCount = state.threads.filter((t) => t.spaceId === profile.id).length;
  const block = isLast ? 'The last profile stays.' : threadCount ? `${threadCount} ${THREADS.select(threadCount) === 'one' ? 'thread lives' : 'threads live'} here; delete or move them first.` : undefined;
  const remove = () => {
    const undo = removeProfile(profile.id);
    if (state.spaceId === profile.id) dispatch({ type: 'space', id: getProfiles()[0].id });
    toast(`${profile.name} removed`, { duration: UNDO_MS, action: { label: 'Undo', onClick: undo } });
  };
  return (
    <SettingsRow
      label={<span className="text-muted-foreground">{block ?? 'Removes it from the sidebar. Its agent accounts and browser data stay on disk.'}</span>}
      control={
        <Button variant="outline" size="sm" disabled={!!block} onClick={remove}>
          <Trash data-icon="inline-start" className="text-destructive" />
          Remove profile
        </Button>
      }
    />
  );
}

const THREADS = new Intl.PluralRules('en');

function AddProfileGroup({ isFull, onAdded }: { isFull: boolean; onAdded: (id: string) => void }) {
  const { dispatch } = useHarness();
  const [name, setName] = useState<string | null>(null);
  const create = (value: string) => {
    const profile = addProfile(value);
    setName(null);
    onAdded(profile.id);
    toast(`${profile.name} added`, { action: { label: 'Open', onClick: () => dispatch({ type: 'space', id: profile.id }) } });
  };
  return (
    <SettingsGroup id="addProfile" footer={isFull ? `Mochi holds up to ${MAX_PROFILES} profiles, one per ${keyName('nav')} + number shortcut.` : 'A new profile starts empty, on the default accounts, with a fresh browser session.'}>
      {name === null ? (
        <SettingsRow
          label={
            <button type="button" disabled={isFull} onClick={() => setName('')} className="flex items-center gap-1.5 text-foreground enabled:hover:underline enabled:hover:underline-offset-4 disabled:text-muted-foreground">
              <Plus aria-hidden className="size-4" />
              Add profile…
            </button>
          }
        />
      ) : (
        <SettingsRow
          label="New profile"
          control={
            <form
              className="flex w-full items-center gap-2 sm:w-auto"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) create(name.trim());
              }}
            >
              <Input autoFocus aria-label="Profile name" placeholder="Side project" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setName(null)} className="sm:w-52" />
              <Button type="submit" variant="outline" disabled={!name.trim()}>
                Add
              </Button>
            </form>
          }
        />
      )}
    </SettingsGroup>
  );
}
