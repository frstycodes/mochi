import { useState, type ReactNode } from 'react';
import { CheckBadge, Download, Login, Refresh, Trash } from '@/icons';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { IconImage } from '../IconImage';
import { useProfiles } from '../profiles';
import { timeAgo } from '../progress';
import { SettingsCard, SettingsRow, SkeletonRows } from '../settings/parts';
import { OverflowIcon, SpaceIcon } from '../ui';
import { isSameServer } from './connectors';
import { STANDALONE_PLUGIN, type LibraryEntry } from './library';
import type { Library } from './useLibrary';

/** What the Skills, Plugins and Connectors pages share: the installed list, item rows with their icon, install buttons. */
export function InstalledList({ entries, library, query, empty }: { entries: LibraryEntry[] | undefined; library: Library; query: string; empty: ReactNode }) {
  const shown = entries && filterBy(entries, query, (e) => [e.title, e.description, e.source]);
  return (
    <SettingsCard>
      {!shown && <SkeletonRows count={2} />}
      {shown?.length === 0 && (query ? <EmptyRow text={`Nothing in your library matches “${query}”`} /> : empty)}
      {shown?.map((entry) => <EntryRow key={entry.id} entry={entry} library={library} />)}
    </SettingsCard>
  );
}

// A catalog can list hundreds of items; past this, Show more pages through them.
export const PAGE = 50;

export const ALL = 'all';

const PLURAL = new Intl.PluralRules('en');
export const countOf = (n: number, noun: string) => `${n} ${PLURAL.select(n) === 'one' ? noun : `${noun}s`}`;

const KIND_LABELS = { skill: 'Skill', plugin: 'Plugin', server: 'Local server', connector: 'Connector' } satisfies Record<LibraryEntry['kind'], string>;

export function EntryRow({ entry, library }: { entry: LibraryEntry; library: Library }) {
  return <LibraryRow name={entry.title} icon={entry.icon} description={entry.description} meta={entryMeta(entry)} notes={entryNotes(entry, library.entries ?? [])} actions={<EntryActions entry={entry} library={library} />} />;
}

/** Sign in (a signed-out account), the profiles that get it, and the ⋯ menu: what every installed item can do. */
export function EntryActions({ entry, library }: { entry: LibraryEntry; library: Library }) {
  const [isSigningIn, setSigningIn] = useState(false);
  const signIn = () => {
    setSigningIn(true);
    void library.signIn(entry).finally(() => setSigningIn(false));
  };
  return (
    <>
      {entry.isLinked === false && (
        <Button variant="outline" size="sm" disabled={isSigningIn} onClick={signIn}>
          {isSigningIn ? <Spinner data-icon="inline-start" /> : <Login data-icon="inline-start" />}
          Sign in
        </Button>
      )}
      <ProfilesMenu entry={entry} library={library} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`${entry.title} actions`}>
            <OverflowIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {entry.autoUpdate !== null && (
            <>
              <DropdownMenuItem onSelect={() => void library.update(entry)}>
                <Refresh />
                Update now
              </DropdownMenuItem>
              <DropdownMenuCheckboxItem checked={entry.autoUpdate} onCheckedChange={(isOn) => void library.setAutoUpdate(entry, isOn)}>
                Update automatically
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem variant="destructive" onSelect={() => void library.remove(entry)}>
            <Trash />
            {entry.kind === 'connector' ? 'Remove account' : 'Remove from library'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function entryMeta(entry: LibraryEntry) {
  const updated = entry.updatedAt && `updated ${timeAgo((Date.now() - entry.updatedAt) / 60_000)}`;
  const pinned = entry.autoUpdate === false && 'pinned';
  const name = entry.kind === 'skill' && `/${STANDALONE_PLUGIN}:${entry.name}`;
  return [KIND_LABELS[entry.kind], name, entry.contents, entry.source, updated, pinned].filter(Boolean).join(' · ');
}

function entryNotes(entry: LibraryEntry, entries: LibraryEntry[]) {
  const missing = entry.remotes.filter((remote) => !entries.some((e) => e.kind === 'connector' && !!e.source && isSameServer(e.source, remote.url)));
  return [
    ...(entry.isLinked === false ? ['Signed out: its tools are left out of threads until you sign in'] : []),
    ...(!entry.profileIds.length ? ['In no profile yet: pick which profiles get it'] : []),
    ...(missing.length ? [`Connect ${LIST.format(missing.map((r) => r.name))} under Connectors for its tools`] : []),
    ...(entry.unsupported.length ? [`Left out: ${LIST.format(entry.unsupported)}`] : []),
    ...(entry.kind === 'plugin' && !entry.contents && !entry.remotes.length ? ['Nothing in it loads into threads'] : []),
  ];
}

export const LIST = new Intl.ListFormat('en', { type: 'conjunction' });

/** One item with its identity: icon tile, name, what it is, and its actions on the right; `children` open under it. */
export function LibraryRow({ name, icon, letter, description, meta, notes = [], actions, children }: { name: string; icon: string | null; letter?: string; description?: string | null; meta?: string; notes?: string[]; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="relative flex flex-col gap-3 px-4 py-3 not-first:before:absolute not-first:before:inset-x-4 not-first:before:top-0 not-first:before:h-px not-first:before:bg-border">
      <div className="flex items-center gap-3">
        <LibraryIcon key={icon} url={icon} letter={letter ?? name} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate type-body font-medium">{name}</span>
          {!!description && <span className="line-clamp-2 type-caption text-muted-foreground">{description}</span>}
          {!!meta && <span className="truncate type-caption text-subtle-foreground">{meta}</span>}
          {notes.map((note) => (
            <span key={note} className="type-caption text-warning">
              {note}
            </span>
          ))}
        </div>
        {!!actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** A 40px tile like a project's: the item's own image, else its first letter. */
export function LibraryIcon({ url, letter }: { url: string | null; letter: string }) {
  const fallback = <span className="type-body font-semibold text-muted-foreground uppercase">{letter.trim()[0] ?? '?'}</span>;
  return (
    <span aria-hidden className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-background">
      {url ? <IconImage src={url} fallback={fallback} className="size-7 rounded-md" /> : fallback}
    </span>
  );
}

export function filterBy<T>(items: readonly T[], query: string, fields: (item: T) => (string | null | undefined)[]) {
  const q = query.trim().toLowerCase();
  return q ? items.filter((item) => fields(item).some((text) => text?.toLowerCase().includes(q))) : [...items];
}

export function EmptyRow({ text }: { text: string }) {
  return <p className="px-4 py-6 text-center type-meta text-muted-foreground">{text}</p>;
}

/** Install, or a quiet "Installed" once it's in the library; which profiles get it is chosen there. */
export function InstallControl({ entry, name, install }: { entry: LibraryEntry | undefined; name: string; install: () => Promise<boolean> }) {
  const [isBusy, setBusy] = useState(false);
  if (entry)
    return (
      <span className="flex h-7 w-24 items-center justify-end gap-1 type-meta text-muted-foreground">
        <CheckBadge aria-hidden className="size-3.5 text-success" />
        Installed
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
      {isBusy ? <Spinner data-icon="inline-start" /> : <Download data-icon="inline-start" />}
      Install
    </Button>
  );
}

export function CatalogErrorRow({ what, message, onRetry }: { what: string; message: string; onRetry: () => void }) {
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

export function CategoryChips({ categories, value, onChange }: { categories: string[]; value: string; onChange: (category: string) => void }) {
  return (
    <ToggleGroup type="single" size="sm" variant="outline" spacing={1} value={value} onValueChange={(v) => onChange(v || ALL)} className="flex-wrap" aria-label="Category">
      {[ALL, ...categories].map((c) => (
        <ToggleGroupItem key={c} value={c} className="capitalize">
          {c}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}


/** The profiles an item (or one connector account) is handed to: their icons on the button, a checkbox each in the menu. */
export function ProfilesMenu({ entry, library }: { entry: LibraryEntry; library: Library }) {
  const profiles = useProfiles();
  const members = profiles.filter((p) => entry.profileIds.includes(p.id));
  const label = !members.length ? 'No profiles' : members.length === profiles.length ? 'All profiles' : members.length === 1 ? members[0].name : `${members.length} profiles`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn('max-w-40', !members.length && 'text-muted-foreground')} aria-label={`Profiles that get ${entry.title}: ${label}`}>
          {members.length > 0 && members.length < profiles.length && (
            <span className="flex -space-x-0.5">
              {members.slice(0, 3).map((p) => (
                <SpaceIcon key={p.id} space={p} className="size-3.5" />
              ))}
            </span>
          )}
          <span className="truncate">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Profiles that get it</DropdownMenuLabel>
        {profiles.map((p) => (
          <DropdownMenuCheckboxItem key={p.id} checked={entry.profileIds.includes(p.id)} onSelect={(e) => e.preventDefault()} onCheckedChange={(isIn) => void library.setInProfile(entry, p.id, isIn)}>
            <SpaceIcon space={p} className="size-3.5" />
            {p.name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
