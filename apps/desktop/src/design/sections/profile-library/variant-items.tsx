import { useState } from 'react';
import { ChevronDown, Download } from '@/icons';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { SettingsCard, SettingsSection } from '../../../settings/parts';
import { SpaceIcon } from '../../../ui';
import type { Space } from '../../../model';
import { LibraryIcon } from '../../../library/LibraryParts';
import {
  DISCOVER,
  type Kind,
  type LibItem,
} from '../../profileLibraryFixtures';
import { byService, KINDS, matches, type ProfileLibrary } from './model';
import {
  isTyping,
  ItemRow,
  KeyHints,
  LockedMark,
  MockFrame,
  onSlashSearch,
  ProfileIcons,
  SearchField,
} from './parts';

const ANY = 'any';
const NONE = 'none';

/**
 * B · Item first, improved. Today's Skills, Plugins and Connectors pages without the page-wide profile picker: every
 * row says which profiles load it and edits them in one multi-select, the same control for Mochi and native items.
 */
export function ItemFirstVariant({
  lib,
  currentId,
  isNarrow,
}: {
  lib: ProfileLibrary;
  currentId: string;
  isNarrow: boolean;
}) {
  const [kind, setKind] = useState<Kind>('skill');
  const [query, setQuery] = useState('');
  const [inProfile, setInProfile] = useState(ANY);
  const keep = (i: LibItem) =>
    i.kind === kind &&
    matches(i, query) &&
    (inProfile === ANY ||
      (inProfile === NONE
        ? !lib.profiles.some((p) => lib.isIn(i, p.id))
        : lib.isIn(i, inProfile)));
  const mochi = lib.items.filter((i) => i.source === 'mochi' && keep(i));
  const native = lib.items.filter((i) => i.source !== 'mochi' && keep(i));
  const isFiltered = !!query || inProfile !== ANY;
  const noun = KINDS.find(([k]) => k === kind)![1].toLowerCase();
  return (
    <MockFrame isNarrow={isNarrow}>
      <div className="flex flex-col gap-4" onKeyDown={onSlashSearch}>
        <Tabs value={kind} onValueChange={(v) => setKind(v as Kind)}>
          <TabsList
            variant="line"
            aria-label="Kind"
            className="w-full justify-start"
          >
            {KINDS.map(([k, label]) => (
              <TabsTrigger key={k} value={k} className="flex-none px-2">
                {label}
                <span className="text-subtle-foreground tabular">
                  {lib.items.filter((i) => i.kind === k).length}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex flex-col gap-2 @lg:flex-row">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={`Search ${noun}`}
            className="@lg:flex-1"
          />
          <Select value={inProfile} onValueChange={setInProfile}>
            <SelectTrigger size="sm" className="@lg:w-44" aria-label="Show">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>In any profile</SelectItem>
              {lib.profiles.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <SpaceIcon space={p} />
                  {`In ${p.name}`}
                </SelectItem>
              ))}
              <SelectItem value={NONE}>In no profile</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <SettingsSection title="In Mochi">
          <SettingsCard>
            {!mochi.length &&
              (isFiltered || !lib.isFirstRun ? (
                <Empty className="py-6">
                  <EmptyDescription>Nothing here matches</EmptyDescription>
                </Empty>
              ) : (
                <FirstRun noun={noun} />
              ))}
            {kind === 'connector'
              ? byService(mochi).map((g) => (
                  <ServiceBlock key={g.key} lib={lib} members={g.members} />
                ))
              : mochi.map((item) => (
                  <ItemsRow key={item.id} lib={lib} item={item} />
                ))}
          </SettingsCard>
        </SettingsSection>
        <SettingsSection
          title="From Claude Code and Codex"
          footer="On in every profile on their account until you turn one off. Off in Mochi only: Claude Code and Codex keep loading them."
        >
          <SettingsCard>
            {!native.length && (
              <Empty className="py-6">
                <EmptyDescription>Nothing here matches</EmptyDescription>
              </Empty>
            )}
            {native.map((item) => (
              <ItemsRow key={item.id} lib={lib} item={item} />
            ))}
          </SettingsCard>
        </SettingsSection>
        {!query && (
          <DiscoverStrip lib={lib} kind={kind} currentId={currentId} />
        )}
        <KeyHints
          hints={[
            ['/', 'Search'],
            ['1–3', 'Toggle a profile on the focused row'],
            ['↵', 'Open its profiles'],
          ]}
        />
      </div>
    </MockFrame>
  );
}

function ItemsRow({
  lib,
  item,
  isCompact,
}: {
  lib: ProfileLibrary;
  item: LibItem;
  isCompact?: boolean;
}) {
  const isAnywhere = lib.profiles.some((p) => lib.isIn(item, p.id));
  return (
    <ItemRow
      item={item}
      state={isAnywhere ? 'added' : 'not-added'}
      status={rowStatus(item)}
      isCompact={isCompact}
      tabIndex={0}
      className={cn(
        'outline-none focus-visible:bg-accent/60',
        isCompact && 'py-1.5 pl-0 not-first:before:hidden',
      )}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || isTyping(e.target)) return;
        const profile = lib.profiles[Number(e.key) - 1];
        if (profile) lib.setIn([item], profile.id, !lib.isIn(item, profile.id));
        if (e.key === 'Enter')
          e.currentTarget
            .querySelector<HTMLButtonElement>('[data-profiles-button]')
            ?.click();
      }}
      actions={
        item.lockedReason ? (
          <LockedMark reason={item.lockedReason} />
        ) : (
          <ProfilesButton lib={lib} item={item} />
        )
      }
    />
  );
}

/**
 * Which profiles load it: their icons and a label on the button, a checkbox each in the menu, which stays open while you
 * tick. Native items name where they're off, since on is their default.
 */
function ProfilesButton({ lib, item }: { lib: ProfileLibrary; item: LibItem }) {
  const eligible = lib.profiles.filter(
    (p) => lib.stateOf(item, p.id) !== 'other-account',
  );
  const members = eligible.filter((p) => lib.isIn(item, p.id));
  const isNative = item.source !== 'mochi';
  const off = eligible.filter((p) => !lib.isIn(item, p.id));
  const label = isNative
    ? offLabel(off)
    : membersLabel(members, lib.profiles.length);
  const icons = isNative ? off : members;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          data-profiles-button
          variant="outline"
          size="sm"
          className={cn('max-w-44', !members.length && 'text-muted-foreground')}
          aria-label={`Profiles that load ${item.name}: ${label}`}
        >
          {icons.length > 0 && icons.length < lib.profiles.length && (
            <ProfileIcons profiles={icons} />
          )}
          <span className="hidden truncate @md:inline">{label}</span>
          <ChevronDown className="@md:hidden" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          {isNative ? 'Load in these Mochi profiles' : 'Profiles that load it'}
        </DropdownMenuLabel>
        {lib.profiles.map((p, n) => {
          const isOther = lib.stateOf(item, p.id) === 'other-account';
          return (
            <DropdownMenuCheckboxItem
              key={p.id}
              checked={lib.isIn(item, p.id)}
              disabled={isOther}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(isOn) => lib.setIn([item], p.id, isOn)}
            >
              <SpaceIcon space={p} />
              <span className="flex-1 truncate">{p.name}</span>
              {isOther ? (
                <span className="type-caption text-subtle-foreground">
                  Other account
                </span>
              ) : (
                <DropdownMenuShortcut>{n + 1}</DropdownMenuShortcut>
              )}
            </DropdownMenuCheckboxItem>
          );
        })}
        {isNative && (
          <>
            <DropdownMenuSeparator />
            <p className="px-2 py-1.5 type-caption text-muted-foreground">
              Off in Mochi only. Still on in{' '}
              {item.source === 'codex' ? 'Codex' : 'Claude Code'}. Applies to
              new threads.
            </p>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function offLabel(off: Space[]) {
  if (!off.length) return 'On';
  return off.length === 1
    ? `Off in ${off[0].name}`
    : `Off in ${off.length} profiles`;
}

function membersLabel(members: Space[], total: number) {
  if (!members.length) return 'No profiles';
  if (members.length === total) return 'All profiles';
  return members.length <= 2
    ? members.map((p) => p.name).join(', ')
    : `${members.length} profiles`;
}

/** A service with its accounts under it: each account is handed to profiles on its own, so "Work Gmail in Work" reads in place. */
function ServiceBlock({
  lib,
  members,
}: {
  lib: ProfileLibrary;
  members: LibItem[];
}) {
  const [first] = members;
  return (
    <div className="relative flex flex-col pb-1 not-first:before:absolute not-first:before:inset-x-4 not-first:before:top-0 not-first:before:h-px not-first:before:bg-border">
      <div className="flex items-center gap-3 px-4 pt-2.5">
        <LibraryIcon
          url={first.icon ?? null}
          letter={first.service ?? first.name}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate type-body font-medium">
            {first.service}
          </span>
          <span className="type-caption text-subtle-foreground">
            {`Connector · ${members.length} ${members.length === 1 ? 'account' : 'accounts'} · ${first.where}`}
          </span>
        </span>
      </div>
      <div className="flex flex-col pl-13">
        {members.map((acct) => (
          <ItemsRow key={acct.id} lib={lib} item={acct} isCompact />
        ))}
      </div>
    </div>
  );
}

/** A first look at Discover under the library: install goes to the profile you're in, the arrow picks others. */
function DiscoverStrip({
  lib,
  kind,
  currentId,
}: {
  lib: ProfileLibrary;
  kind: Kind;
  currentId: string;
}) {
  const [installed, setInstalled] = useState<Record<string, string[]>>({});
  const rows = DISCOVER.filter((d) => d.kind === kind);
  if (!rows.length) return null;
  const current = lib.profileName(currentId);
  return (
    <SettingsSection
      title="From Discover"
      footer="Install adds it to the profile you’re in; the arrow picks others."
    >
      <SettingsCard>
        {rows.map((item) => {
          const to = installed[item.id];
          return (
            <ItemRow
              key={item.id}
              item={item}
              state="added"
              actions={
                to ? (
                  <span className="type-caption text-muted-foreground">
                    {`In ${to.map(lib.profileName).join(', ')}`}
                  </span>
                ) : (
                  <ButtonGroup>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setInstalled((s) => ({ ...s, [item.id]: [currentId] }))
                      }
                    >
                      <Download data-icon="inline-start" />
                      <span className="hidden @md:inline">{`Install to ${current}`}</span>
                      <span className="@md:hidden">Install</span>
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label="Install to other profiles"
                        >
                          <ChevronDown />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {lib.profiles.map((p) => (
                          <DropdownMenuItem
                            key={p.id}
                            onSelect={() =>
                              setInstalled((s) => ({ ...s, [item.id]: [p.id] }))
                            }
                          >
                            <SpaceIcon space={p} />
                            {`Install to ${p.name}`}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() =>
                            setInstalled((s) => ({
                              ...s,
                              [item.id]: lib.profiles.map((p) => p.id),
                            }))
                          }
                        >
                          Install to every profile
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </ButtonGroup>
                )
              }
            />
          );
        })}
      </SettingsCard>
    </SettingsSection>
  );
}

function FirstRun({ noun }: { noun: string }) {
  return (
    <Empty className="py-8">
      <EmptyHeader>
        <EmptyTitle>{`No ${noun} in Mochi yet`}</EmptyTitle>
        <EmptyDescription>
          Install once, then tick the profiles that should load it. Your Claude
          Code and Codex {noun} are below and already on.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm">{`Discover ${noun}`}</Button>
      </EmptyContent>
    </Empty>
  );
}

/** Where an item is off already shows on its button, so the line only carries what the button can't: new, or broken. */
function rowStatus(item: LibItem) {
  const harness = item.source === 'codex' ? 'Codex' : 'Claude Code';
  if (item.error) return `Couldn’t load: ${item.error}`;
  if (item.isNew)
    return `New in ${harness}. On in every profile that loads new items.`;
  return null;
}
