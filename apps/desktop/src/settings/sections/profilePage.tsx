import { useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  Connector,
  Copy,
  FileText,
  Plugin,
  Skill,
  Trash,
  type IconComponent,
} from '@/icons';
import { toast } from '@/toast/store';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { plural } from '@mochi/domain/lib/format';
import { useConfirm } from '../../git/useConfirm';
import { formatGithubAccount } from '../../git/github';
import { host } from '../../host';
import type { Space } from '../../model';
import {
  getProfiles,
  MAX_PROFILES,
  removeProfile,
  updateProfile,
  useProfiles,
} from '../../profiles';
import { useHarness } from '../../store';
import { OverflowIcon, ProviderMark, SpaceIcon } from '../../ui';
import type { LibraryEntry } from '../../library/library';
import { countOf } from '../../library/LibraryParts';
import { setLibraryScope } from '../../library/libraryScope';
import { setAllOff } from '../../library/nativeOff';
import { useLibrary } from '../../library/useLibrary';
import type { NativeItem } from '../../library/nativeItems';
import { useNativeItems } from '../../library/useNativeItems';
import { CatalogRow } from '../CatalogRow';
import { HARNESS_IDS, HARNESSES } from '../harnesses';
import { openSettings } from '../../routes/nav';
import { useProfileFolder } from '../ProfileInstructions';
import {
  DesktopOnlyNotice,
  SettingsGroup,
  SettingsRow,
  SettingsSelect,
  settingControlId,
  UNDO_MS,
} from '../parts';
import {
  GitHubAccountSelect,
  NewProfileDialog,
  useGhAccounts,
  type GhAccountsState,
} from './profiles';

/** Settings › Profiles › <profile>: who it is, what it signs in with, what its threads load, and its browser. */
export function ProfilePage({ id }: { id: string }) {
  const profile = useProfiles().find((p) => p.id === id);
  const gh = useGhAccounts();
  if (!profile) return <MissingProfile />;
  return (
    <div
      data-setting-id={`${profile.id}-page`}
      className="flex flex-col gap-10"
    >
      <ProfileHeader profile={profile} />
      {!host.isDesktop && (
        <DesktopOnlyNotice what="Choosing GitHub and agent accounts and clearing browsing data need the Mochi desktop app." />
      )}
      <SettingsGroup title="General" id={`${profile.id}-profile`}>
        <CatalogRow settingKey="profile.name" profile={profile} />
        <CatalogRow settingKey="profile.icon" profile={profile} />
      </SettingsGroup>
      <ProfileInstructionsLink profile={profile} />
      {host.isDesktop && (
        <SettingsGroup
          title="Accounts"
          footer="Threads in this profile sign in, push and open pull requests with these."
        >
          <GitHubAccountRow profile={profile} gh={gh} />
          {HARNESS_IDS.map((provider) => (
            <CatalogRow
              key={provider}
              settingKey={`profile.${provider}Account`}
              profile={profile}
            />
          ))}
        </SettingsGroup>
      )}
      <ProfileLibrary profile={profile} />
      <OwnSetupGroup profile={profile} />
      <SettingsGroup>
        {host.isDesktop && <ClearBrowsingRow profile={profile} />}
        <RemoveProfileRow profile={profile} />
      </SettingsGroup>
    </div>
  );
}

function BackLink() {
  return (
    <Button
      variant="ghost"
      size="xs"
      className="self-start text-muted-foreground"
      onClick={() => openSettings('profiles')}
    >
      <ArrowLeft />
      Profiles
    </Button>
  );
}

function MissingProfile() {
  return (
    <div className="flex flex-col gap-4">
      <BackLink />
      <p className="px-1 type-meta text-muted-foreground">
        This profile was removed.
      </p>
    </div>
  );
}

/** Back to the list, then the profile's icon and name as the page title, with Switch to it and ⋯ › Duplicate on the right. */
function ProfileHeader({ profile }: { profile: Space }) {
  const { state, dispatch } = useHarness();
  const profiles = useProfiles();
  const [isCopying, setCopying] = useState(false);
  const isCurrent = state.spaceId === profile.id;
  const threadCount = state.threads.filter(
    (t) => t.spaceId === profile.id,
  ).length;
  return (
    <div className="flex flex-col gap-4">
      <BackLink />
      <div className="flex items-center gap-3 px-1">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background"
        >
          <SpaceIcon space={profile} className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate type-display">{profile.name}</h1>
          <p className="truncate type-meta text-muted-foreground">
            {[
              isCurrent && 'The profile you’re in',
              countOf(threadCount, 'thread'),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {!isCurrent && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => dispatch({ type: 'space', id: profile.id })}
          >
            Switch to {profile.name}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${profile.name} actions`}
            >
              <OverflowIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem
              disabled={profiles.length >= MAX_PROFILES}
              onSelect={() => setCopying(true)}
            >
              <Copy />
              Duplicate…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <NewProfileDialog
        open={isCopying}
        from={profile}
        onClose={() => setCopying(false)}
      />
    </div>
  );
}

const LIBRARY_PAGES = [
  {
    kind: 'skills',
    label: 'Skills',
    icon: Skill,
    isOf: (e: LibraryEntry) => e.kind === 'skill',
  },
  {
    kind: 'plugins',
    label: 'Plugins',
    icon: Plugin,
    isOf: (e: LibraryEntry) => e.kind === 'plugin',
  },
  {
    kind: 'connectors',
    label: 'Connectors',
    icon: Connector,
    isOf: (e: LibraryEntry) => e.kind === 'connector' || e.kind === 'server',
  },
] as const;

/** What the profile loads from the library, a row per kind opening that page scoped to this profile; switched there. */
function ProfileLibrary({ profile }: { profile: Space }) {
  const { entries } = useLibrary(profile.id);
  const open = (kind: (typeof LIBRARY_PAGES)[number]['kind']) => {
    setLibraryScope(profile.id);
    openSettings(kind);
  };
  return (
    <SettingsGroup
      title="Skills, plugins and connectors"
      footer={`What ${profile.name}’s threads load beyond the account’s own setup.`}
    >
      {LIBRARY_PAGES.map(({ kind, label, icon: Icon, isOf }) => {
        const all = entries?.filter(isOf);
        const on = all?.filter((e) => e.profileIds.includes(profile.id)).length;
        return (
          <ProfileLinkRow
            key={kind}
            icon={Icon}
            label={label}
            meta={!!all && (all.length ? `${on} of ${all.length}` : 'None yet')}
            onClick={() => open(kind)}
          />
        );
      })}
    </SettingsGroup>
  );
}

/** Mochi's own instructions for the profile and the switches for your CLAUDE.md and AGENTS.md live on Settings › Instructions. */
function ProfileInstructionsLink({ profile }: { profile: Space }) {
  const folder = useProfileFolder(profile.id);
  const written = folder?.files.filter((f) => f.lines).length;
  const total = folder?.files.length;
  return (
    <SettingsGroup
      title="Instructions"
      footer={`What ${profile.name}’s threads are told, and whether they also load your own CLAUDE.md and AGENTS.md.`}
    >
      <ProfileLinkRow
        icon={FileText}
        label="Edit instructions"
        meta={!!total && `${written} of ${total} written`}
        onClick={() => {
          setLibraryScope(profile.id);
          openSettings('instructions');
        }}
      />
    </SettingsGroup>
  );
}

function ProfileLinkRow({
  icon: Icon,
  label,
  meta,
  onClick,
}: {
  icon: IconComponent;
  label: string;
  meta: string | false;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors not-first:before:absolute not-first:before:inset-x-4 not-first:before:top-0 not-first:before:h-px not-first:before:bg-border first:rounded-t-xl last:rounded-b-xl hover:bg-accent/60 focus-visible:bg-accent/60"
    >
      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 type-body">{label}</span>
      {!!meta && (
        <span className="type-meta text-muted-foreground tabular">{meta}</span>
      )}
      <ChevronRight
        aria-hidden
        className="size-4 shrink-0 text-subtle-foreground"
      />
    </button>
  );
}

/**
 * Whether this profile's threads use what you set up in Claude Code and Codex yourself (your own skills, plugins and MCP
 * servers): all of it, none, or some (picked item by item on the Skills, Plugins and Connectors pages), and whether
 * what you add there later joins in. Nothing is changed in the tools' own files.
 */
function OwnSetupGroup({ profile }: { profile: Space }) {
  const accounts = useNativeItems()?.filter((a) =>
    a.profileIds.includes(profile.id),
  );
  if (!accounts?.length) return null;
  return (
    <SettingsGroup
      title="Your Claude Code and Codex setup"
      footer={`The skills, plugins and MCP servers you added to Claude Code or Codex outside Mochi. This only decides which of them ${profile.name}’s threads use; Mochi never changes them.`}
    >
      {accounts.map(({ account, items }) => {
        const { provider } = account;
        const harness = HARNESSES[provider].name;
        const usable = items.filter((i) => !i.isOffNatively);
        const used = usable.filter((i) => !profile.nativeOff?.includes(i.id));
        const choice = !used.length
          ? 'none'
          : used.length === usable.length
            ? 'all'
            : 'some';
        const choose = (next: string) => {
          if (next === 'some')
            return (setLibraryScope(profile.id), openSettings('skills'));
          // "None" covers what you add later too; "All" lets it in again.
          setAllOff(profile, usable, next === 'none', harness, {
            ...profile.nativeNew,
            [provider]: next === 'none' ? 'off' : 'on',
          });
        };
        const isLoadingNew = (profile.nativeNew?.[provider] ?? 'on') === 'on';
        return [
          <SettingsRow
            key={provider}
            id={`${profile.id}-native-${provider}`}
            label={
              <span className="flex items-center gap-2">
                <ProviderMark provider={provider} size={14} />
                {harness}
              </span>
            }
            description={`${account.name} account · ${kindCounts(usable)}${choice === 'some' ? ` · ${used.length} of ${usable.length} used` : ''}`}
            control={
              <SettingsSelect
                id={`${profile.id}-native-${provider}`}
                value={choice}
                options={USE_OPTIONS}
                onChange={choose}
                disabled={!usable.length}
              />
            }
          />,
          choice !== 'none' && (
            <SettingsRow
              key={`${provider}-new`}
              id={`${profile.id}-native-new-${provider}`}
              label={`Also use what you add to ${harness} later`}
              description={
                isLoadingNew
                  ? `A skill or server you add to ${harness} reaches ${profile.name}’s new threads too`
                  : `Something you add to ${harness} stays out of ${profile.name} until you turn it on`
              }
              control={
                <Switch
                  id={settingControlId(`${profile.id}-native-new-${provider}`)}
                  checked={isLoadingNew}
                  onCheckedChange={(isOn) =>
                    updateProfile(profile.id, {
                      nativeNew: {
                        ...profile.nativeNew,
                        [provider]: isOn ? 'on' : 'off',
                      },
                    })
                  }
                />
              }
            />
          ),
        ];
      })}
    </SettingsGroup>
  );
}

const USE_OPTIONS = [
  { value: 'all', label: 'Use all of it' },
  { value: 'some', label: 'Use some…' },
  { value: 'none', label: 'Use none of it' },
];

/** "6 skills, 2 plugins and 3 MCP servers": what one account brings, by kind. */
function kindCounts(items: NativeItem[]) {
  const parts = (['skill', 'plugin', 'server'] as const).flatMap((kind) => {
    const n = items.filter((i) => i.kind === kind).length;
    return n ? [countOf(n, kind === 'server' ? 'MCP server' : kind)] : [];
  });
  return parts.length ? LIST.format(parts) : 'Nothing set up';
}

const LIST = new Intl.ListFormat('en', { type: 'conjunction' });

function GitHubAccountRow({
  profile,
  gh,
}: {
  profile: Space;
  gh: GhAccountsState;
}) {
  const rowId = `${profile.id}-github`;
  const isMissing =
    !!profile.github &&
    !!gh.accounts &&
    !gh.accounts.some(
      (a) => a.isValid && formatGithubAccount(a) === profile.github,
    );
  const description = gh.error
    ? `Couldn't ask gh for its logins: ${gh.error}`
    : isMissing
      ? `gh has no working login for ${profile.github}. Run gh auth login, then come back.`
      : 'This profile’s threads push and open pull requests as this account. Add one with gh auth login.';
  return (
    <SettingsRow
      id={rowId}
      label="GitHub account"
      description={
        <span className={cn(isMissing && 'text-warning')}>{description}</span>
      }
      control={
        <GitHubAccountSelect
          id={rowId}
          value={profile.github}
          gh={gh}
          onChange={(github) => updateProfile(profile.id, { github })}
        />
      }
    />
  );
}

function ClearBrowsingRow({ profile }: { profile: Space }) {
  const { confirm, dialog } = useConfirm();
  const rowId = `${profile.id}-browsing`;
  const clear = async () => {
    const isConfirmed = await confirm({
      title: `Clear ${profile.name}'s browsing data?`,
      description:
        'Cookies, logins, site storage and cache in this profile’s browser tabs go. Open pages stay open, signed out. Other profiles keep theirs.',
      confirm: 'Clear browsing data',
      cancel: 'Keep it',
      isDestructive: true,
    });
    if (!isConfirmed) return;
    host.browser.clearData(profile.id).then(
      () => toast(`${profile.name}'s browsing data cleared`),
      (error: Error) =>
        toast.error('Browsing data not cleared', {
          description: error.message,
        }),
    );
  };
  return (
    <SettingsRow
      id={rowId}
      label="Browser"
      description="Its own cookies and logins, apart from other profiles."
      control={
        <>
          <Button
            id={settingControlId(rowId)}
            variant="outline"
            size="sm"
            onClick={() => void clear()}
          >
            Clear browsing data
          </Button>
          {dialog}
        </>
      }
    />
  );
}

function RemoveProfileRow({ profile }: { profile: Space }) {
  const { state, dispatch } = useHarness();
  const isLast = useProfiles().length === 1;
  const threadCount = state.threads.filter(
    (t) => t.spaceId === profile.id,
  ).length;
  const block = isLast
    ? 'The last profile stays.'
    : threadCount
      ? `${threadCount} ${plural(threadCount, 'thread lives', 'threads live')} here; delete or move them first.`
      : undefined;
  const remove = () => {
    const undo = removeProfile(profile.id);
    if (state.spaceId === profile.id)
      dispatch({ type: 'space', id: getProfiles()[0].id });
    openSettings('profiles');
    toast(`${profile.name} removed`, {
      duration: UNDO_MS,
      action: { label: 'Undo', onClick: undo },
    });
  };
  return (
    <SettingsRow
      label={
        <span className="text-muted-foreground">
          {block ??
            'Removes it from the sidebar. Its agent accounts and browser data stay on disk.'}
        </span>
      }
      control={
        <Button variant="outline" size="sm" disabled={!!block} onClick={remove}>
          <Trash data-icon="inline-start" className="text-destructive" />
          Remove profile
        </Button>
      }
    />
  );
}
