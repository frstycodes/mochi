import { useState, type ReactNode } from 'react';
import { CheckBadge, Download, Login, Refresh, Trash } from '@/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { plural } from '@mochi/domain/lib/format';
import { OpenFileItems } from '../files/OpenFileItems';
import { IconImage } from '../IconImage';
import type { Space } from '../model';
import { useProfiles } from '../profiles';
import { timeAgo } from '../progress';
import { SettingsCard, SettingsRow, SkeletonRows } from '../settings/parts';
import { HARNESSES } from '../settings/harnesses';
import { OverflowIcon, ProviderMark, SpaceIcon } from '../ui';
import { isSameServer } from '@mochi/domain/library/connectors';
import { useLibraryScope } from './libraryScope';
import { skillPluginName, type LibraryEntry } from './library';
import { similarNativeSkills, type SimilarSkill } from './similarSkills';
import { useNativeItems } from './useNativeItems';
import type { Library } from './useLibrary';

/** What the Skills, Plugins and Connectors pages share: the installed list, item rows with their icon, install buttons. */
export function InstalledList({
  entries,
  library,
  query,
  empty,
}: {
  entries: LibraryEntry[] | undefined;
  library: Library;
  query: string;
  empty: ReactNode;
}) {
  const shown =
    entries &&
    filterBy(entries, query, (e) => [e.title, e.description, e.source]);
  return (
    <SettingsCard>
      {!shown && <SkeletonRows count={2} />}
      {shown?.length === 0 &&
        (query ? (
          <EmptyRow text={`Nothing in your library matches “${query}”`} />
        ) : (
          empty
        ))}
      {shown?.map((entry) => (
        <EntryRow key={entry.id} entry={entry} library={library} />
      ))}
    </SettingsCard>
  );
}

// A catalog can list hundreds of items; past this, Show more pages through them.
export const PAGE = 50;

export const ALL = 'all';

export const countOf = (n: number, noun: string) =>
  `${n} ${plural(n, noun, `${noun}s`)}`;

const KIND_LABELS = {
  skill: 'Skill',
  plugin: 'Plugin',
  server: 'Local server',
  connector: 'Connector',
} satisfies Record<LibraryEntry['kind'], string>;

export function EntryRow({
  entry,
  library,
}: {
  entry: LibraryEntry;
  library: Library;
}) {
  const { profile } = useLibraryScope();
  const isOff =
    !!profile && isHandedOut(entry) && !entry.profileIds.includes(profile.id);
  return (
    <LibraryRow
      name={entry.title}
      icon={entry.icon}
      description={entry.description}
      meta={entryMeta(entry)}
      notes={entryNotes(entry, library.entries ?? [], !profile)}
      isDimmed={isOff}
      actions={<EntryActions entry={entry} library={library} />}
    />
  );
}

// A skill written to an agent's own folders loads wherever that account does, so it isn't handed to profiles.
const isHandedOut = (entry: LibraryEntry) =>
  !entry.placements.length || !!entry.profileIds.length;

/**
 * Sign in (a signed-out account), whether it's in the profile the page shows (a switch) or which profiles get it (All
 * profiles), and the ⋯ menu: what every installed item can do.
 */
export function EntryActions({
  entry,
  library,
}: {
  entry: LibraryEntry;
  library: Library;
}) {
  const { profile } = useLibraryScope();
  const [isSigningIn, setSigningIn] = useState(false);
  const placed = entry.kind === 'skill' ? entry.placements[0] : undefined;
  const signIn = () => {
    setSigningIn(true);
    void library.signIn(entry).finally(() => setSigningIn(false));
  };
  return (
    <>
      {entry.isLinked === false && (
        <Button
          variant="outline"
          size="sm"
          disabled={isSigningIn}
          onClick={signIn}
        >
          {isSigningIn ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <Login data-icon="inline-start" />
          )}
          Sign in
        </Button>
      )}
      {isHandedOut(entry) &&
        (profile ? (
          <ProfileSwitch
            entries={[entry]}
            name={entry.title}
            profile={profile}
            library={library}
          />
        ) : (
          <ProfilesMenu
            entries={[entry]}
            name={entry.title}
            library={library}
          />
        ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`${entry.title} actions`}
          >
            <OverflowIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {/* Written to the agents' folders, it's files you can open; a library-only skill lives inside library.json. */}
          {!!placed && (
            <>
              <OpenFileItems file={{ root: placed.dir, path: 'SKILL.md' }} />
              <DropdownMenuSeparator />
            </>
          )}
          {entry.autoUpdate !== null && (
            <>
              <DropdownMenuItem onSelect={() => void library.update(entry)}>
                <Refresh />
                Update now
              </DropdownMenuItem>
              <DropdownMenuCheckboxItem
                checked={entry.autoUpdate}
                onCheckedChange={(isOn) =>
                  void library.setAutoUpdate(entry, isOn)
                }
              >
                Update automatically
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => void library.remove(entry)}
          >
            <Trash />
            {entry.kind === 'connector'
              ? 'Remove account'
              : 'Remove from library'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function entryMeta(entry: LibraryEntry) {
  const updated =
    entry.updatedAt &&
    `updated ${timeAgo((Date.now() - entry.updatedAt) / 60_000)}`;
  const pinned = entry.autoUpdate === false && 'pinned';
  // A skill written to an agent's own folders loads by its bare name there, not through the library's plugin.
  const name =
    entry.kind === 'skill' &&
    (entry.placements.length
      ? entry.placements.map((p) => tildePath(p.dir)).join(', ')
      : `/${skillPluginName(entry.source)}:${entry.name}`);
  const source =
    entry.source &&
    (entry.commit
      ? `${entry.source} @ ${entry.commit.slice(0, 7)}`
      : entry.source);
  return [
    KIND_LABELS[entry.kind],
    name,
    entry.contents,
    source,
    updated,
    pinned,
  ]
    .filter(Boolean)
    .join(' · ');
}

const tildePath = (dir: string) => dir.replace(/^\/(Users|home)\/[^/]+/, '~');

function entryNotes(
  entry: LibraryEntry,
  entries: LibraryEntry[],
  isAllProfiles: boolean,
) {
  const missing = entry.remotes.filter(
    (remote) =>
      !entries.some(
        (e) =>
          e.kind === 'connector' &&
          !!e.source &&
          isSameServer(e.source, remote.url),
      ),
  );
  return [
    ...(entry.isLinked === false
      ? ['Signed out: its tools are left out of threads until you sign in']
      : []),
    ...(isAllProfiles && !entry.profileIds.length && !entry.placements.length
      ? ['In no profile yet: pick which profiles get it']
      : []),
    ...(missing.length
      ? [
          `Connect ${LIST.format(missing.map((r) => r.name))} under Connectors for its tools`,
        ]
      : []),
    ...(entry.unsupported.length
      ? [`Left out: ${LIST.format(entry.unsupported)}`]
      : []),
    ...(entry.kind === 'plugin' && !entry.contents && !entry.remotes.length
      ? ['Nothing in it loads into threads']
      : []),
  ];
}

export const LIST = new Intl.ListFormat('en', { type: 'conjunction' });

/**
 * One item with its identity: icon tile, name, what it is, and its actions on the right; `children` open under it.
 * `status` is one muted line for a non-default state; `isDimmed` mutes the tile and name of something that won't load.
 */
export function LibraryRow({
  name,
  icon,
  letter,
  description,
  meta,
  notes = [],
  status,
  isDimmed,
  actions,
  children,
}: {
  name: string;
  icon: string | null;
  letter?: string;
  description?: string | null;
  meta?: string;
  notes?: string[];
  status?: ReactNode;
  isDimmed?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="relative flex flex-col gap-3 px-4 py-3 not-first:before:absolute not-first:before:inset-x-4 not-first:before:top-0 not-first:before:h-px not-first:before:bg-border">
      <div className="flex items-center gap-3">
        <span className={cn('flex', isDimmed && 'opacity-60')}>
          <LibraryIcon key={icon} url={icon} letter={letter ?? name} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={cn(
              'truncate type-body font-medium',
              isDimmed && 'text-muted-foreground',
            )}
          >
            {name}
          </span>
          {!!description && (
            <span className="line-clamp-2 type-caption text-muted-foreground">
              {description}
            </span>
          )}
          {!!meta && (
            <span className="truncate type-caption text-subtle-foreground">
              {meta}
            </span>
          )}
          {notes.map((note) => (
            <span key={note} className="type-caption text-warning">
              {note}
            </span>
          ))}
          {!!status && (
            <span className="type-caption text-muted-foreground">{status}</span>
          )}
        </div>
        {!!actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
      {children}
    </div>
  );
}

/** A 40px tile like a project's: the item's own image, else its first letter. */
export function LibraryIcon({
  url,
  letter,
}: {
  url: string | null;
  letter: string;
}) {
  const fallback = (
    <span className="type-body font-semibold text-muted-foreground uppercase">
      {letter.trim()[0] ?? '?'}
    </span>
  );
  return (
    <span
      aria-hidden
      className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-background"
    >
      {url ? (
        <IconImage
          src={url}
          fallback={fallback}
          className="size-7 rounded-md"
        />
      ) : (
        fallback
      )}
    </span>
  );
}

export function filterBy<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => (string | null | undefined)[],
) {
  const q = query.trim().toLowerCase();
  return q
    ? items.filter((item) =>
        fields(item).some((text) => text?.toLowerCase().includes(q)),
      )
    : [...items];
}

export function EmptyRow({ text }: { text: string }) {
  return (
    <p className="px-4 py-6 text-center type-meta text-muted-foreground">
      {text}
    </p>
  );
}

/** Install, or a quiet "In library" once it's there; which profiles get it is chosen there. */
export function InstallControl({
  entry,
  name,
  install,
}: {
  entry: LibraryEntry | undefined;
  name: string;
  install: () => Promise<boolean>;
}) {
  const [isBusy, setBusy] = useState(false);
  if (entry)
    return (
      <span className="flex h-7 w-24 items-center justify-end gap-1 type-meta text-muted-foreground">
        <CheckBadge aria-hidden className="size-3.5 text-success" />
        In library
      </span>
    );
  return (
    <Button
      variant="outline"
      size="sm"
      className="w-24"
      disabled={isBusy}
      onClick={() => {
        setBusy(true);
        void install().finally(() => setBusy(false));
      }}
      aria-label={`Install ${name}`}
    >
      {isBusy ? (
        <Spinner data-icon="inline-start" />
      ) : (
        <Download data-icon="inline-start" />
      )}
      Install
    </Button>
  );
}

export function CatalogErrorRow({
  what,
  message,
  onRetry,
}: {
  what: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <SettingsRow
      label={`Couldn’t read ${what}`}
      description={message}
      control={
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      }
    />
  );
}

export function CategoryChips({
  categories,
  value,
  onChange,
}: {
  categories: string[];
  value: string;
  onChange: (category: string) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      spacing={1}
      value={value}
      onValueChange={(v) => onChange(v || ALL)}
      className="flex-wrap"
      aria-label="Category"
    >
      {[ALL, ...categories].map((c) => (
        <ToggleGroupItem key={c} value={c} className="capitalize">
          {c}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** A group's control (every skill of a repo): its switch for the profile the page shows, else which profiles get all of it. */
export function GroupControl({
  entries,
  name,
  library,
}: {
  entries: LibraryEntry[];
  name: string;
  library: Library;
}) {
  const { profile } = useLibraryScope();
  const handed = entries.filter(isHandedOut);
  if (!handed.length) return null;
  return profile ? (
    <ProfileSwitch
      entries={handed}
      name={name}
      profile={profile}
      library={library}
    />
  ) : (
    <ProfilesMenu entries={handed} name={name} library={library} />
  );
}

/** On when the profile has every one of `entries`; flipping it sets them all. Several, partly in, says how many. */
function ProfileSwitch({
  entries,
  name,
  profile,
  library,
}: {
  entries: LibraryEntry[];
  name: string;
  profile: Space;
  library: Library;
}) {
  const on = entries.filter((e) => e.profileIds.includes(profile.id)).length;
  const setAll = async (isIn: boolean) => {
    for (const entry of entries)
      if (entry.profileIds.includes(profile.id) !== isIn)
        await library.setInProfile(entry, profile.id, isIn);
  };
  return (
    <>
      {on > 0 && on < entries.length && (
        <span className="type-caption text-subtle-foreground tabular">
          {on} of {entries.length}
        </span>
      )}
      <Switch
        checked={on === entries.length}
        onCheckedChange={(next) => void setAll(next)}
        aria-label={`${name} in ${profile.name}`}
      />
    </>
  );
}

/**
 * The profiles an item (one connector account, or every skill of a repo) is handed to: their icons on the button, a
 * checkbox each in the menu. For several items a profile is ticked once it has all of them, and says so when it has some.
 */
export function ProfilesMenu({
  entries,
  name,
  library,
}: {
  entries: LibraryEntry[];
  name: string;
  library: Library;
}) {
  const profiles = useProfiles();
  const countIn = (profileId: string) =>
    entries.filter((e) => e.profileIds.includes(profileId)).length;
  const members = profiles.filter((p) => countIn(p.id) === entries.length);
  const isMixed = profiles.some(
    (p) => countIn(p.id) > 0 && countIn(p.id) < entries.length,
  );
  const label = isMixed
    ? 'Mixed'
    : !members.length
      ? 'No profiles'
      : members.length === profiles.length
        ? 'All profiles'
        : members.length === 1
          ? members[0].name
          : `${members.length} profiles`;
  const setIn = async (profileId: string, isIn: boolean) => {
    for (const entry of entries)
      if (entry.profileIds.includes(profileId) !== isIn)
        await library.setInProfile(entry, profileId, isIn);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'max-w-40',
            !members.length && !isMixed && 'text-muted-foreground',
          )}
          aria-label={`Profiles that get ${name}: ${label}`}
        >
          {!isMixed &&
            members.length > 0 &&
            members.length < profiles.length && (
              <span className="flex -space-x-0.5">
                {members.slice(0, 3).map((p) => (
                  <SpaceIcon key={p.id} space={p} className="size-3.5" />
                ))}
              </span>
            )}
          <span className="truncate">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>
          {entries.length > 1
            ? `Profiles that get all ${entries.length}`
            : 'Profiles that get it'}
        </DropdownMenuLabel>
        {profiles.map((p) => {
          const count = countIn(p.id);
          return (
            <DropdownMenuCheckboxItem
              key={p.id}
              checked={count === entries.length}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(isIn) => void setIn(p.id, isIn)}
            >
              <SpaceIcon space={p} className="size-3.5" />
              <span className="flex-1 truncate">{p.name}</span>
              {count > 0 && count < entries.length && (
                <span className="type-caption text-subtle-foreground tabular">
                  {count} of {entries.length}
                </span>
              )}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A Claude Code or Codex skill of a like name: installing this one may only add a second copy of it. */
export function SimilarNote({ similar }: { similar: SimilarSkill[] }) {
  if (!similar.length) return null;
  const [first] = similar;
  return (
    <span className="flex items-center gap-1 type-caption text-warning">
      <ProviderMark provider={first.provider} size={12} />
      <span className="truncate">
        Similar to {HARNESSES[first.provider].name}’s {first.name}
        {similar.length > 1 && ` and ${similar.length - 1} more`}
      </span>
    </span>
  );
}

/** Looks a name up against every account's Claude Code and Codex skills, read once for the caller. */
export function useSimilarNative() {
  const accounts = useNativeItems();
  return (name: string) => similarNativeSkills(name, accounts);
}
