import { useEffect, useState } from 'react';
import { Add, Trash3 } from 'reicon-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useConfirm } from '../../git/useConfirm';
import { gitError } from '../../git/useGit';
import type { GhAccount } from '../../host/types/git';
import { host } from '../../host';
import { SPACE_ICON_NAMES, type Space, type SpaceIconName } from '../../model';
import { addProfile, getProfiles, MAX_PROFILES, removeProfile, updateProfile, useProfiles } from '../../profiles';
import { useHarness } from '../../store';
import { SPACE_ICONS, SpaceIcon } from '../../ui';
import { linkedAccountId } from '../accounts';
import { useAgentSettings } from '../AgentSettings';
import { HARNESS_IDS, HARNESSES } from '../harnesses';
import { CommitInput, DesktopOnlyNotice, SettingsGroup, SettingsRow, SettingsSelect, settingControlId, UNDO_MS } from '../parts';

/** One group per profile: what it's called, how it looks in the sidebar, and what it signs in with. */
export function ProfilesSection() {
  const profiles = useProfiles();
  const gh = useGhAccounts();
  const { confirm, dialog } = useConfirm();
  return (
    <div className="flex flex-col gap-8">
      <p className="type-meta text-muted-foreground">Each profile is a space in the sidebar with its own threads, agent accounts and browser logins. Switch with the icons at the bottom of the sidebar.</p>
      {!host.isDesktop && <DesktopOnlyNotice what="Choosing GitHub and agent accounts and clearing browsing data need the Mochi desktop app." />}
      {profiles.map((profile) => (
        <ProfileGroup key={profile.id} profile={profile} isLast={profiles.length === 1} gh={gh} confirm={confirm} />
      ))}
      <AddProfileGroup isFull={profiles.length >= MAX_PROFILES} />
      {dialog}
    </div>
  );
}

function ProfileGroup({ profile, isLast, gh, confirm }: { profile: Space; isLast: boolean; gh: GhAccountsState; confirm: ReturnType<typeof useConfirm>['confirm'] }) {
  const { id } = profile;
  return (
    <SettingsGroup
      id={`${id}-profile`}
      title={
        <span className="flex items-center gap-1.5">
          <SpaceIcon space={profile} className="size-3.5" />
          {profile.name}
        </span>
      }
    >
      <SettingsRow
        id={`${id}-name`}
        label="Name"
        control={<CommitInput id={settingControlId(`${id}-name`)} value={profile.name} onCommit={(name) => name && updateProfile(id, { name })} />}
      />
      <SettingsRow id={`${id}-icon`} label="Icon" control={<IconPicker profile={profile} />} />
      {host.isDesktop && <GitHubAccountRow profile={profile} gh={gh} />}
      {host.isDesktop && <AccountRows profile={profile} />}
      {host.isDesktop && <ClearBrowsingRow profile={profile} confirm={confirm} />}
      <RemoveProfileRow profile={profile} isLast={isLast} />
    </SettingsGroup>
  );
}

type GhAccountsState = { accounts?: GhAccount[]; error?: string };

/** gh's logins, read when the page opens and again when the window regains focus (after a `gh auth login` in a terminal). */
function useGhAccounts(): GhAccountsState {
  const [state, setState] = useState<GhAccountsState>({});
  useEffect(() => {
    if (!host.isDesktop) return;
    const load = () => host.git.ghAccounts().then((accounts) => setState({ accounts }), (error: Error) => setState({ error: gitError(error) }));
    load();
    addEventListener('focus', load);
    return () => removeEventListener('focus', load);
  }, []);
  return state;
}

// Radix Select can't hold '' (the profile's "use gh's active account").
const ACTIVE = 'gh-active';

function GitHubAccountRow({ profile, gh }: { profile: Space; gh: GhAccountsState }) {
  const rowId = `${profile.id}-github`;
  const working = gh.accounts?.filter((a) => a.isValid) ?? [];
  const active = gh.accounts?.find((a) => a.isActive);
  const isMissing = !!profile.github && !!gh.accounts && !working.some((a) => a.login === profile.github);
  const options = [
    { value: ACTIVE, label: active ? `Active account (${active.login})` : 'Active account' },
    ...working.map((a) => ({ value: a.login, label: a.login })),
    ...(isMissing ? [{ value: profile.github, label: `${profile.github} (signed out)` }] : []),
  ];
  const description = gh.error
    ? `Couldn't ask gh for its logins: ${gh.error}`
    : isMissing
      ? `gh has no working login for ${profile.github}. Run gh auth login, then come back.`
      : 'Pull requests from this profile’s threads open as this account. Add one with gh auth login.';
  return (
    <SettingsRow
      id={rowId}
      label="GitHub account"
      description={<span className={cn(isMissing && 'text-warning')}>{description}</span>}
      control={<SettingsSelect id={rowId} value={profile.github || ACTIVE} options={options} onChange={(v) => updateProfile(profile.id, { github: v === ACTIVE ? '' : v })} disabled={!gh.accounts} className="w-56" />}
    />
  );
}

const ICON_LABELS = { work: 'Briefcase', home: 'Home', layers: 'Layers', code: 'Code', book: 'Book', rocket: 'Rocket', coffee: 'Coffee', star: 'Star' } satisfies Record<SpaceIconName, string>;

/** Profiles are told apart by icon, not colour, so each icon is one tap away. */
function IconPicker({ profile }: { profile: Space }) {
  return (
    <ToggleGroup
      id={settingControlId(`${profile.id}-icon`)}
      type="single"
      size="sm"
      variant="outline"
      spacing={1}
      value={profile.icon}
      onValueChange={(icon) => icon && updateProfile(profile.id, { icon: icon as SpaceIconName })}
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

function AccountRows({ profile }: { profile: Space }) {
  const { accounts, linkAccount } = useAgentSettings();
  return HARNESS_IDS.map((provider) => {
    const rowId = `${profile.id}-${provider}Account`;
    const own = accounts?.accounts.filter((a) => a.provider === provider) ?? [];
    return (
      <SettingsRow
        key={provider}
        id={rowId}
        label={`${HARNESSES[provider].name} account`}
        control={
          <SettingsSelect
            id={rowId}
            value={linkedAccountId(accounts?.links ?? {}, profile.id, provider)}
            options={own.map((a) => ({ value: a.id, label: a.name }))}
            onChange={(accountId) => void linkAccount(profile.id, provider, accountId)}
            disabled={!accounts}
          />
        }
      />
    );
  });
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
          <Trash3 data-icon="inline-start" className="text-destructive" />
          Remove profile
        </Button>
      }
    />
  );
}

const THREADS = new Intl.PluralRules('en');

function AddProfileGroup({ isFull }: { isFull: boolean }) {
  const { dispatch } = useHarness();
  const [name, setName] = useState<string | null>(null);
  const create = (value: string) => {
    const profile = addProfile(value);
    setName(null);
    toast(`${profile.name} added`, { action: { label: 'Open', onClick: () => dispatch({ type: 'space', id: profile.id }) } });
  };
  return (
    <SettingsGroup id="addProfile" footer={isFull ? `Mochi holds up to ${MAX_PROFILES} profiles, one per ⌥ digit.` : 'A new profile starts empty, on the default accounts, with a fresh browser session.'}>
      {name === null ? (
        <SettingsRow
          label={
            <button type="button" disabled={isFull} onClick={() => setName('')} className="flex items-center gap-1.5 text-foreground enabled:hover:underline enabled:hover:underline-offset-4 disabled:text-muted-foreground">
              <Add aria-hidden className="size-4" />
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
