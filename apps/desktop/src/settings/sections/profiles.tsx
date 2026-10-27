import { useQuery } from '@tanstack/react-query';
import { Fragment, useEffect, useEffectEvent, useState } from 'react';
import { ChevronRight, Plus } from '@/icons';
import { toast } from '@/toast/store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { formatGithubAccount, GITHUB_COM } from '../../git/github';
import { gitError } from '../../git/useGit';
import type { GhAccount } from '../../host/types/git';
import { host } from '../../host';
import { keyName } from '../../keys';
import {
  SPACE_COLOR_NAMES,
  SPACE_HALO_MOTIONS,
  SPACE_ICON_NAMES,
  type Provider,
  type Space,
  type SpaceColor,
  type SpaceHaloMotion,
  type SpaceIconName,
} from '../../model';
import { spaceColorCss } from '../../spaceColor';
import { cn } from '@/lib/utils';
import { addProfile, MAX_PROFILES, useProfiles } from '../../profiles';
import { useHarness, useDispatch } from '../../store';
import { ProviderMark, SPACE_ICONS, SpaceIcon } from '../../ui';
import { countOf } from '../../library/LibraryParts';
import { useLibrary } from '../../library/useLibrary';
import { linkedAccountId } from '../accounts';
import { useAgentSettings } from '../AgentSettings';
import { HARNESS_IDS } from '../harnesses';
import { openSubpage, useSettingsRoute } from '../../routes/nav';
import { SettingsCard, SettingsSection, SettingsSelect } from '../parts';
import { queryKeys } from '../../queryKeys';

/** Settings › Profiles: every profile as a row opening its own page (Settings › Profiles › <profile>), and a way to add one. */
export function ProfilesSection() {
  const profiles = useProfiles();
  const [isAdding, setAdding] = useState(false);
  const isFull = profiles.length >= MAX_PROFILES;
  useOpenLinkedProfile(profiles);
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-3 px-1 sm:flex-row sm:items-start sm:justify-between">
        <p className="type-meta text-pretty text-muted-foreground">
          Each profile is a space in the sidebar with its own threads, agent
          accounts, skills and browser logins. Switch with the icons at the
          bottom of the sidebar.
        </p>
        <Button
          size="xs"
          className="shrink-0"
          disabled={isFull}
          onClick={() => setAdding(true)}
        >
          <Plus />
          Add profile
        </Button>
      </div>
      <SettingsSection
        id="addProfile"
        footer={
          isFull &&
          `Mochi holds up to ${MAX_PROFILES} profiles, one per ${keyName('nav')} + number shortcut.`
        }
      >
        <SettingsCard>
          {profiles.map((profile) => (
            <ProfileListRow key={profile.id} profile={profile} />
          ))}
        </SettingsCard>
      </SettingsSection>
      <NewProfileDialog open={isAdding} onClose={() => setAdding(false)} />
    </div>
  );
}

/** A deep link to one profile's row (`<profileId>-<row>`, from search or a thread) opens that profile's page on it. */
function useOpenLinkedProfile(profiles: Space[]) {
  const route = useSettingsRoute();
  const openLinked = useEffectEvent((settingId: string) => {
    const linked = profiles.find((p) => settingId.startsWith(`${p.id}-`));
    if (linked) openSubpage('profiles', linked.id, settingId, true);
  });
  useEffect(() => {
    if (route?.settingId) openLinked(route.settingId);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `nonce` re-runs it when the same setting is deep-linked twice
  }, [route?.nonce, route?.settingId]);
}

/** One profile as a settings row that opens its page: its icon, name, the accounts it runs on and what it loads. */
function ProfileListRow({ profile }: { profile: Space }) {
  const { state } = useHarness();
  const meta = useProfileMeta(profile);
  return (
    <button
      type="button"
      onClick={() => openSubpage('profiles', profile.id)}
      className="relative flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors not-first:before:absolute not-first:before:inset-x-4 not-first:before:top-0 not-first:before:h-px not-first:before:bg-border first:rounded-t-xl last:rounded-b-xl hover:bg-accent/60 focus-visible:bg-accent/60"
    >
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background"
      >
        <SpaceIcon space={profile} className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate type-body font-medium">{profile.name}</span>
          {state.spaceId === profile.id && (
            <Badge variant="secondary">Current</Badge>
          )}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 type-caption text-subtle-foreground">
          {meta.map((part, i) => (
            <Fragment key={i}>
              {i > 0 && <span aria-hidden>·</span>}
              <span className="flex items-center gap-1 whitespace-nowrap">
                {part}
              </span>
            </Fragment>
          ))}
        </span>
      </span>
      <ChevronRight
        aria-hidden
        className="size-4 shrink-0 text-subtle-foreground"
      />
    </button>
  );
}

/** The row's muted line: the agent account each harness runs on, what it loads from the library, its threads. */
function useProfileMeta(profile: Space) {
  const { accounts } = useAgentSettings();
  const { entries } = useLibrary(profile.id);
  const loaded = entries?.filter((e) =>
    e.profileIds.includes(profile.id),
  ).length;
  const { state } = useHarness();
  const threadCount = state.threads.filter(
    (t) => t.spaceId === profile.id,
  ).length;
  const accountNames = HARNESS_IDS.flatMap((provider) => {
    const id =
      accounts && linkedAccountId(accounts.links, profile.id, provider);
    const name = accounts?.accounts.find((a) => a.id === id)?.name;
    return name ? [{ provider, name }] : [];
  });
  const meta = [
    ...accountNames.map(({ provider, name }) => (
      <>
        <ProviderMark provider={provider} size={12} />
        {name}
      </>
    )),
    ...(loaded === undefined
      ? []
      : [`${countOf(loaded, 'item')} from the library`]),
    countOf(threadCount, 'thread'),
  ];
  return meta;
}

// Radix Select can't hold ''.
const EMPTY = 'empty';

/**
 * Adds a profile, empty or as a copy of another (`from` starts it there, the page's Duplicate). A copy takes the source's
 * agent accounts, GitHub login, library items and native choices; threads and browser logins stay where they are.
 */
export function NewProfileDialog({
  open,
  from,
  onClose,
  onCreated,
}: {
  open: boolean;
  from?: Space;
  onClose: () => void;
  /** Replaces the default follow-up: opening the new profile's settings page with a "Switch to it" toast. */
  onCreated?: (profile: Space) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        {open && (
          <NewProfileForm from={from} onDone={onClose} onCreated={onCreated} />
        )}
      </DialogContent>
    </Dialog>
  );
}

// Inside the dialog's content, which unmounts on close, so each opening starts fresh.
function NewProfileForm({
  from,
  onDone,
  onCreated,
}: {
  from?: Space;
  onDone: () => void;
  onCreated?: (profile: Space) => void;
}) {
  const profiles = useProfiles();
  const dispatch = useDispatch();
  const copyProfile = useCopyProfile();
  const [name, setName] = useState(from ? `${from.name} copy` : '');
  const [sourceId, setSourceId] = useState(from?.id ?? EMPTY);
  const [isBusy, setBusy] = useState(false);
  const source = profiles.find((p) => p.id === sourceId);
  const create = async () => {
    setBusy(true);
    const profile = addProfile(name.trim(), source);
    if (source)
      await copyProfile(source, profile).catch((error: Error) =>
        toast.error(`Not everything was copied from ${source.name}`, {
          description: error.message,
        }),
      );
    onDone();
    if (onCreated) return onCreated(profile);
    openSubpage('profiles', profile.id);
    toast(`${profile.name} added`, {
      action: {
        label: 'Switch to it',
        onClick: () => dispatch({ type: 'space', id: profile.id }),
      },
    });
  };
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() && !isBusy) void create();
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {from ? `Duplicate ${from.name}` : 'Add profile'}
        </DialogTitle>
        <DialogDescription>
          A space in the sidebar with its own threads and a fresh browser
          session.
        </DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor="new-profile-name">Name</FieldLabel>
        <Input
          id="new-profile-name"
          autoFocus
          placeholder="Side project"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="new-profile-from">Start from</FieldLabel>
        <SettingsSelect
          id="new-profile-from"
          value={sourceId}
          options={[
            { value: EMPTY, label: 'An empty profile' },
            ...profiles.map((p) => ({
              value: p.id,
              label: `A copy of ${p.name}`,
            })),
          ]}
          onChange={setSourceId}
          className="w-full"
        />
        <FieldDescription>
          {source
            ? `Copies ${source.name}’s agent accounts, GitHub login, instructions, skills, plugins and connectors, and what it turns off from Claude Code and Codex. Threads and browser logins stay with ${source.name}.`
            : 'Starts on the default agent accounts with nothing from the library; add skills, plugins and connectors on its page.'}
        </FieldDescription>
      </Field>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!name.trim() || isBusy}>
          {source ? 'Duplicate profile' : 'Add profile'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Gives `to` what lives outside the profile record: `from`'s agent account links, its folder (instructions) and its library items. */
function useCopyProfile() {
  const { accounts, linkAccount } = useAgentSettings();
  return async (from: Space, to: Space) => {
    if (accounts)
      for (const provider of HARNESS_IDS) {
        const id = linkedAccountId(accounts.links, from.id, provider);
        if (id !== linkedAccountId(accounts.links, to.id, provider))
          await linkAccount(to.id, provider, id);
      }
    await host.settings.copyProfileFolder(from.id, to.id);
    const entries = await host.library.list(from.id);
    for (const entry of entries)
      if (entry.profileIds.includes(from.id))
        await host.library.setEnabled(to.id, entry.id, true);
  };
}

export type GhAccountsState = { accounts?: GhAccount[]; error?: string };

/** gh's logins, read when the page opens and again when the window regains focus (after a `gh auth login` in a terminal). */
export function useGhAccounts(isNeeded = true): GhAccountsState {
  const accountsQuery = useQuery({
    queryKey: queryKeys.profile.githubAccounts(),
    queryFn: () => host.git.ghAccounts(),
    enabled: host.isDesktop && isNeeded,
    staleTime: 0,
  });
  return {
    accounts: accountsQuery.data,
    error: accountsQuery.error ? gitError(accountsQuery.error) : undefined,
  };
}

// Radix Select can't hold '' (the profile's "use gh's active account").
const ACTIVE = 'gh-active';

/** gh's working logins plus "Active account" (stored as ''); pass `gh` when the caller already reads them. */
export function GitHubAccountSelect({
  id,
  value,
  gh: given,
  onChange,
}: {
  id: string;
  value: string;
  gh?: GhAccountsState;
  onChange: (github: string) => void;
}) {
  const own = useGhAccounts(!given);
  const gh = given ?? own;
  const working = gh.accounts?.filter((a) => a.isValid) ?? [];
  const active = gh.accounts?.find((a) => a.isActive && a.host === GITHUB_COM);
  const isMissing =
    !!value &&
    !!gh.accounts &&
    !working.some((a) => formatGithubAccount(a) === value);
  const options = [
    {
      value: ACTIVE,
      label: active ? `Active account (${active.login})` : 'Active account',
    },
    ...working.map((a) => ({
      value: formatGithubAccount(a),
      label: a.host === GITHUB_COM ? a.login : `${a.login} (${a.host})`,
    })),
    ...(isMissing ? [{ value, label: `${value} (signed out)` }] : []),
  ];
  return (
    <SettingsSelect
      id={id}
      value={value || ACTIVE}
      options={options}
      onChange={(v) => onChange(v === ACTIVE ? '' : v)}
      disabled={!gh.accounts}
      className="w-56"
    />
  );
}

const ICON_LABELS = {
  work: 'Briefcase',
  home: 'Home',
  layers: 'Layers',
  code: 'Code',
  book: 'Book',
  rocket: 'Rocket',
  coffee: 'Coffee',
  star: 'Star',
} satisfies Record<SpaceIconName, string>;

/** Every icon one tap away, not behind a select. */
export function IconPicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (icon: string) => void;
}) {
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
                <ToggleGroupItem
                  value={name}
                  aria-label={ICON_LABELS[name]}
                  className="size-7 px-0"
                >
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

const COLOR_LABELS = {
  green: 'Green',
  blue: 'Blue',
  violet: 'Violet',
  amber: 'Amber',
  pink: 'Pink',
  teal: 'Teal',
  orange: 'Orange',
  red: 'Red',
  none: 'None',
} satisfies Record<SpaceColor, string>;

const SPACE_COLORS = [...SPACE_COLOR_NAMES, 'none'] as const;

const MOTION_LABELS = {
  breathe: 'Breathe',
  drift: 'Drift',
  still: 'Still',
} satisfies Record<SpaceHaloMotion, string>;

/** Breathe pulses the glow, Drift slides its ragged edge sideways, Still holds it; Reduce motion stills all three. */
export function HaloMotionPicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (motion: string) => void;
}) {
  return (
    <ToggleGroup
      id={id}
      type="single"
      size="sm"
      variant="outline"
      spacing={1}
      value={value}
      onValueChange={(motion) => motion && onChange(motion)}
    >
      {SPACE_HALO_MOTIONS.map((motion) => (
        <ToggleGroupItem key={motion} value={motion} className="px-2.5">
          {MOTION_LABELS[motion]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** The halo along the bottom of the sidebar in this profile; None leaves the sidebar plain. */
export function SpaceColorPicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <ToggleGroup
      id={id}
      type="single"
      size="sm"
      variant="outline"
      spacing={1}
      value={value}
      onValueChange={(color) => color && onChange(color)}
      className="flex-wrap"
    >
      {SPACE_COLORS.map((color) => (
        <Tooltip key={color}>
          {/* On a wrapper, as in IconPicker: the tooltip's data-state would overwrite the toggle's. */}
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <ToggleGroupItem
                value={color}
                aria-label={COLOR_LABELS[color]}
                className="size-7 px-0"
              >
                <span
                  aria-hidden
                  className={cn(
                    'size-3.5 rounded-full',
                    color === 'none' &&
                      'border border-dashed border-muted-foreground',
                  )}
                  style={{ background: spaceColorCss(color) }}
                />
              </ToggleGroupItem>
            </span>
          </TooltipTrigger>
          <TooltipContent>{COLOR_LABELS[color]}</TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  );
}

/** The harness's accounts; one serves several profiles. */
export function AccountSelect({
  id,
  provider,
  value,
  onChange,
}: {
  id: string;
  provider: Provider;
  value: string;
  onChange: (accountId: string) => void;
}) {
  const { accounts } = useAgentSettings();
  const own = accounts?.accounts.filter((a) => a.provider === provider) ?? [];
  return (
    <SettingsSelect
      id={id}
      value={value}
      options={own.map((a) => ({ value: a.id, label: a.name }))}
      onChange={onChange}
      disabled={!accounts}
    />
  );
}
