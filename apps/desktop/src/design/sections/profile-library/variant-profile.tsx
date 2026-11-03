import { useState } from 'react';
import { Copy, Plus, X } from '@/icons';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { plural } from '@mochi/domain/lib/format';
import { SettingsCard, SettingsSection } from '../../../settings/parts';
import { OverflowIcon, SpaceIcon } from '../../../ui';
import { LibraryIcon } from '../../../library/LibraryParts';
import type { LibItem } from '../../profileLibraryFixtures';
import {
  byService,
  KINDS,
  matches,
  statusLine,
  type ProfileLibrary,
} from './model';
import {
  isTyping,
  ItemRow,
  KeyHints,
  KindChips,
  kindLabel,
  LockedMark,
  MockFrame,
  onSlashSearch,
  SearchField,
  SourceLabel,
  type KindFilter,
} from './parts';

/**
 * A · Profile first. Pick a profile, see everything it loads grouped by kind, add from the library in one picker
 * (to this profile and, optionally, others), remove in place. The profile page owns its set.
 */
export function ProfileFirstVariant({
  lib,
  isNarrow,
}: {
  lib: ProfileLibrary;
  isNarrow: boolean;
}) {
  const [profileId, setProfileId] = useState('work');
  const [kind, setKind] = useState<KindFilter>('all');
  const [query, setQuery] = useState('');
  const [isAdding, setAdding] = useState(false);
  const profile = lib.profiles.find((p) => p.id === profileId)!;
  const loadable = lib.items.filter(
    (i) =>
      lib.stateOf(i, profileId) !== 'not-added' &&
      lib.stateOf(i, profileId) !== 'other-account',
  );
  const loaded = loadable.filter((i) => lib.isIn(i, profileId));
  const offCount = loadable.length - loaded.length;
  const shown = loadable.filter(
    (i) => (kind === 'all' || i.kind === kind) && matches(i, query),
  );
  const hasMochi = loaded.some((i) => i.source === 'mochi');
  const otherAccount = lib.items.filter(
    (i) => lib.stateOf(i, profileId) === 'other-account',
  ).length;
  return (
    <MockFrame isNarrow={isNarrow}>
      <div
        className="flex flex-col gap-4"
        onKeyDown={(e) => {
          onSlashSearch(e);
          if (isTyping(e.target) || e.metaKey || e.ctrlKey) return;
          const n = Number(e.key);
          if (n >= 1 && n <= lib.profiles.length)
            setProfileId(lib.profiles[n - 1].id);
          if (e.key === 'a') {
            e.preventDefault();
            setAdding(true);
          }
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={profileId}
            onValueChange={(v) => v && setProfileId(v)}
            aria-label="Profile"
            className="min-w-0 flex-wrap"
          >
            {lib.profiles.map((p) => (
              <ToggleGroupItem key={p.id} value={p.id}>
                <SpaceIcon space={p} className="size-3.5" />
                <span className="truncate">{p.name}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ProfileMenu lib={lib} profileId={profileId} onPick={setProfileId} />
        </div>
        <p className="type-meta text-pretty text-muted-foreground tabular">
          {summary(profile.name, loaded, offCount)}
        </p>
        <div className="flex flex-col gap-2 @xl:flex-row @xl:items-center">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={`Search ${profile.name}`}
            className="@xl:w-56"
          />
          <div className="flex items-center justify-between gap-2 @xl:flex-1">
            <div className="no-scrollbar overflow-x-auto">
              <KindChips value={kind} onChange={setKind} />
            </div>
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus data-icon="inline-start" />
              Add
            </Button>
          </div>
        </div>
        {!hasMochi && !query && (
          <EmptyProfile
            lib={lib}
            profileId={profileId}
            onAdd={() => setAdding(true)}
          />
        )}
        {KINDS.filter(([k]) => kind === 'all' || kind === k).map(
          ([k, label]) => {
            const rows = shown.filter((i) => i.kind === k);
            if (!rows.length && !query) return null;
            return (
              <SettingsSection
                key={k}
                title={
                  <span className="flex items-center gap-1.5">
                    {label}
                    <span className="type-meta text-subtle-foreground tabular">
                      {rows.filter((i) => lib.isIn(i, profileId)).length}
                    </span>
                  </span>
                }
              >
                <SettingsCard>
                  {!rows.length && (
                    <Empty className="py-6">
                      <EmptyDescription>Nothing here matches</EmptyDescription>
                    </Empty>
                  )}
                  {k === 'connector'
                    ? byService(rows).map((group) => (
                        <ServiceRows
                          key={group.key}
                          lib={lib}
                          profileId={profileId}
                          members={group.members}
                        />
                      ))
                    : rows.map((item) => (
                        <ProfileRow
                          key={item.id}
                          lib={lib}
                          item={item}
                          profileId={profileId}
                        />
                      ))}
                </SettingsCard>
              </SettingsSection>
            );
          },
        )}
        {otherAccount > 0 && (
          <p className="px-1 type-caption text-muted-foreground">
            {`${otherAccount} ${plural(otherAccount, 'item', 'items')} from another Claude Code account aren’t listed: ${profile.name} never loads them.`}
          </p>
        )}
        <KeyHints
          hints={[
            ['1–3', 'Switch profile'],
            ['/', 'Search'],
            ['A', 'Add'],
            ['⌫', 'Remove the focused row'],
          ]}
        />
      </div>
      <AddDialog
        lib={lib}
        profileId={profileId}
        open={isAdding}
        onOpenChange={setAdding}
      />
    </MockFrame>
  );
}

function summary(name: string, loaded: LibItem[], offCount: number) {
  const counts = KINDS.map(([k]) => {
    const n = loaded.filter((i) => i.kind === k).length;
    return `${n} ${plural(n, k, `${k}s`)}`;
  }).join(', ');
  const off = offCount ? `. ${offCount} off in Mochi only` : '';
  return `${name} loads ${loaded.length}: ${counts}${off}.`;
}

/** One row: its kind and source, and the one action that fits it here. Delete or Backspace on the row does the same. */
function ProfileRow({
  lib,
  item,
  profileId,
}: {
  lib: ProfileLibrary;
  item: LibItem;
  profileId: string;
}) {
  const state = lib.stateOf(item, profileId);
  const name = lib.profileName(profileId);
  return (
    <ItemRow
      item={item}
      state={state}
      status={statusLine(item, state, name)}
      tabIndex={0}
      className="outline-none focus-visible:bg-accent/60"
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Backspace' || e.key === 'Delete')
          lib.setIn([item], profileId, false);
      }}
      actions={<RowAction lib={lib} item={item} profileId={profileId} />}
    />
  );
}

function RowAction({
  lib,
  item,
  profileId,
}: {
  lib: ProfileLibrary;
  item: LibItem;
  profileId: string;
}) {
  const state = lib.stateOf(item, profileId);
  if (state === 'locked') return <LockedMark reason={item.lockedReason!} />;
  if (state === 'added')
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove ${item.name} from ${lib.profileName(profileId)}`}
        onClick={() => lib.setIn([item], profileId, false)}
      >
        <X />
      </Button>
    );
  return (
    <Toggle
      size="sm"
      variant="outline"
      pressed={state === 'on'}
      onPressedChange={(isOn) => lib.setIn([item], profileId, isOn)}
      aria-label={`Load ${item.name} in ${lib.profileName(profileId)}`}
    >
      {state === 'on' ? 'On' : 'Off'}
    </Toggle>
  );
}

/** A service's accounts in this profile, under one heading row whose menu picks which accounts this profile signs in with. */
function ServiceRows({
  lib,
  profileId,
  members,
}: {
  lib: ProfileLibrary;
  profileId: string;
  members: LibItem[];
}) {
  const [first] = members;
  if (!first.service)
    return <ProfileRow lib={lib} item={first} profileId={profileId} />;
  const all = lib.items.filter((i) => i.service === first.service);
  const name = lib.profileName(profileId);
  return (
    <div className="relative flex flex-col not-first:before:absolute not-first:before:inset-x-4 not-first:before:top-0 not-first:before:h-px not-first:before:bg-border">
      <div className="flex items-center gap-3 px-4 pt-2.5">
        <LibraryIcon url={first.icon ?? null} letter={first.service} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate type-body font-medium">
            {first.service}
          </span>
          <span className="type-caption text-subtle-foreground">
            {`Connector · ${members.length} of ${all.length} ${plural(all.length, 'account', 'accounts')} in ${name}`}
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              Accounts
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>{`${first.service} accounts in ${name}`}</DropdownMenuLabel>
            {all.map((acct) => (
              <DropdownMenuCheckboxItem
                key={acct.id}
                checked={lib.isIn(acct, profileId)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(isOn) => lib.setIn([acct], profileId, isOn)}
              >
                <span className="flex-1 truncate">{acct.account}</span>
                <span className="flex items-center gap-1">
                  {lib.profiles
                    .filter((p) => p.id !== profileId && lib.isIn(acct, p.id))
                    .map((p) => (
                      <SpaceIcon
                        key={p.id}
                        space={p}
                        className="size-3 text-subtle-foreground"
                      />
                    ))}
                </span>
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <Plus />
              {`Connect another ${first.service} account`}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex flex-col pl-13">
        {members.map((acct) => (
          <ItemRow
            key={acct.id}
            item={acct}
            state={lib.stateOf(acct, profileId)}
            status={alsoIn(lib, acct, profileId)}
            isCompact
            tabIndex={0}
            className="py-1.5 pl-0 outline-none not-first:before:hidden focus-visible:bg-accent/60"
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Backspace' || e.key === 'Delete')
                lib.setIn([acct], profileId, false);
            }}
            actions={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${acct.name} from ${name}`}
                onClick={() => lib.setIn([acct], profileId, false)}
              >
                <X />
              </Button>
            }
          />
        ))}
      </div>
    </div>
  );
}

/** Switch to a profile past the first three, copy another's set into this one, or start a new profile from it. */
function ProfileMenu({
  lib,
  profileId,
  onPick,
}: {
  lib: ProfileLibrary;
  profileId: string;
  onPick: (id: string) => void;
}) {
  const name = lib.profileName(profileId);
  const others = lib.profiles.filter((p) => p.id !== profileId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`${name} actions`}>
          <OverflowIcon vertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Copy />
            {`Make ${name} match…`}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {others.map((p) => (
              <DropdownMenuItem
                key={p.id}
                onSelect={() => lib.copyAll(p.id, profileId)}
              >
                <SpaceIcon space={p} />
                {p.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onSelect={() => onPick(lib.duplicate(profileId))}>
          <Plus />
          {`New profile from ${name}`}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Nothing from Mochi's library yet: add from it, or start from another profile's set. */
function EmptyProfile({
  lib,
  profileId,
  onAdd,
}: {
  lib: ProfileLibrary;
  profileId: string;
  onAdd: () => void;
}) {
  const name = lib.profileName(profileId);
  const source = lib.profiles.find(
    (p) =>
      p.id !== profileId &&
      lib.items.some((i) => i.source === 'mochi' && lib.isIn(i, p.id)),
  );
  return (
    <Empty className="rounded-xl border border-dashed py-8">
      <EmptyHeader>
        <EmptyTitle>
          {lib.isFirstRun
            ? 'Mochi’s library is empty'
            : `Nothing from Mochi in ${name} yet`}
        </EmptyTitle>
        <EmptyDescription>
          {lib.isFirstRun
            ? 'Your Claude Code and Codex setup loads as it is. Add skills, plugins and connectors from Discover, then pick which profiles get them.'
            : `${name} loads your Claude Code and Codex setup. Add from the library, or start from another profile.`}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center">
        <Button size="sm" onClick={onAdd}>
          {lib.isFirstRun ? 'Open Discover' : 'Add from library'}
        </Button>
        {!!source && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => lib.copyAll(source.id, profileId)}
          >
            {`Copy from ${source.name}`}
          </Button>
        )}
      </EmptyContent>
    </Empty>
  );
}

/**
 * The library picker: everything this profile doesn't load yet, ticked with Enter or a click, added with ⌘Enter. The
 * row of profile toggles adds the same picks to other profiles at once.
 */
function AddDialog({
  lib,
  profileId,
  open,
  onOpenChange,
}: {
  lib: ProfileLibrary;
  profileId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [alsoTo, setAlsoTo] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const name = lib.profileName(profileId);
  const candidates = lib.items.filter(
    (i) =>
      lib.canChange(i, profileId) &&
      !lib.isIn(i, profileId) &&
      matches(i, query),
  );
  const toggle = (id: string) =>
    setPicked((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  const close = () => {
    setPicked([]);
    setAlsoTo([]);
    setQuery('');
    onOpenChange(false);
  };
  const add = () => {
    const items = lib.items.filter((i) => picked.includes(i.id));
    lib.setIn(items, [profileId, ...alsoTo], true);
    close();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : close())}>
      <DialogContent className="gap-3 p-0 sm:max-w-lg">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>{`Add to ${name}`}</DialogTitle>
          <DialogDescription>
            Enter ticks, ⌘Enter adds. Claude Code and Codex items listed here
            are off in Mochi only.
          </DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false} className="px-2">
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search the library"
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                (e.metaKey || e.ctrlKey) &&
                picked.length
              )
                add();
            }}
          />
          <CommandList className="h-80 max-h-[50vh]">
            <CommandEmpty>
              {lib.isFirstRun
                ? 'Nothing in the library yet. Try Discover.'
                : `Nothing else to add${query ? ` matches “${query}”` : ''}`}
            </CommandEmpty>
            {KINDS.map(([k, label]) => {
              const rows = candidates.filter((i) => i.kind === k);
              if (!rows.length) return null;
              return (
                <CommandGroup key={k} heading={label}>
                  {rows.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      data-checked={picked.includes(item.id)}
                      onSelect={() => toggle(item.id)}
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{item.name}</span>
                        <span className="block truncate type-caption text-subtle-foreground">
                          {kindLabel(item)} ·{' '}
                          <SourceLabel source={item.source} />
                        </span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
        <DialogFooter className="flex-col items-stretch gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="type-caption text-muted-foreground">
              Also add to
            </span>
            {lib.profiles
              .filter((p) => p.id !== profileId)
              .map((p) => (
                <Toggle
                  key={p.id}
                  size="sm"
                  variant="outline"
                  pressed={alsoTo.includes(p.id)}
                  onPressedChange={(isOn) =>
                    setAlsoTo((ids) =>
                      isOn ? [...ids, p.id] : ids.filter((x) => x !== p.id),
                    )
                  }
                >
                  <SpaceIcon space={p} />
                  {p.name}
                </Toggle>
              ))}
          </div>
          <Button size="sm" disabled={!picked.length} onClick={add}>
            {picked.length ? `Add ${picked.length}` : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Where else this account signs in, so the same login in two profiles is never a surprise. */
function alsoIn(lib: ProfileLibrary, item: LibItem, profileId: string) {
  const others = lib.profiles.filter(
    (p) => p.id !== profileId && lib.isIn(item, p.id),
  );
  return others.length
    ? `Also in ${others.map((p) => p.name).join(', ')}`
    : `Only in ${lib.profileName(profileId)}`;
}
