import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { Copy, ExternalLink, FileCode, Folder, FolderOpen, Info, Lock, Refresh, SearchAlt, Trash, WarningAlt } from '@/icons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { toast } from '@/toast/store';
import { countOf, EmptyRow, LibraryIcon } from '../../library/LibraryParts';
import type { Provider } from '../../model';
import { HARNESS_IDS, HARNESSES } from '../../settings/harnesses';
import { SettingsCard, SettingsRow, SettingsSection, SettingsSelect } from '../../settings/parts';
import { OverflowIcon, ProviderMark, SpaceIcon } from '../../ui';
import { Block, Grid, Section } from '../layout';
import { ACCOUNTS, accountOf, eligibleProfiles, isOnIn, ITEMS, KIND_LABELS, KIND_PAGE, PROFILE_ACCOUNTS, PROFILES, type ItemPage, type ProfileItem } from '../nativeItemFixtures';

type Items = { items: ProfileItem[]; setItems: Dispatch<SetStateAction<ProfileItem[]>> };
type NewItemsMode = 'on' | 'off';

/** Profiles: Claude Code's and Codex's own items, turned off per profile inside Mochi only (PROFILES-UX.md). Fixture data, local state. */
export function NativeItemsSection() {
  const [items, setItems] = useState(ITEMS);
  const [profileId, setProfileId] = useState('personal');
  const shared = { items, setItems, profileId };
  return (
    <Section
      id="profiles"
      title="Profiles: native items"
      intro="Mockups for PROFILES-UX.md on fixture data. Claude Code’s and Codex’s own skills, plugins, subagents, hooks and servers are on by default and can be turned off per profile, in Mochi only. One state drives every block, so a change in A shows up in B, C and the thread."
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="type-meta text-muted-foreground">You’re in</span>
        <ProfilePicker value={profileId} onChange={setProfileId} />
        <span className="type-caption text-subtle-foreground">Stands in for the sidebar’s profile icons. Latitude runs on the Work Claude Code account; Personal and Liane share the default one.</span>
      </div>
      <Grid>
        <Block title="A · Recommended: on the library pages, per harness" use="Settings › Skills, Plugins, Connectors. Mochi’s items first, then one section per harness account. Each native row keeps the profiles button library items have; it reads as where the item is off." wide>
          <LibraryPagesMock {...shared} />
        </Block>
        <Block title="Profile settings: bulk and new items" use="Settings › Profiles › <profile>. One row per harness from the registry: what it loads, Turn all off, and what new items do.">
          <ProfileHarnessRows {...shared} />
        </Block>
        <Block title="In a thread: what it loaded" use="The summary’s Environment card names the profile and opens what loaded, grouped by source, with what was off.">
          <ThreadLoadedMock {...shared} />
        </Block>
        <Block title="First run, empty and missing" use="A one-time note the first time native items show; an empty harness keeps its section; a harness that isn’t installed has none." wide>
          <FirstRunMock />
        </Block>
        <Block title="B · Alternative: one list per profile" use="Settings › Profiles › <profile> › What it loads: a switch per item for that profile. Fast for building one profile; every item lives on two pages." wide>
          <ProfileListMock {...shared} />
        </Block>
        <Block title="C · Alternative: compare profiles" use="A matrix of items × profiles. Best for comparing; cramped past four profiles and on phones." wide>
          <CompareMatrixMock {...shared} />
        </Block>
      </Grid>
    </Section>
  );
}

function ProfilePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <ToggleGroup type="single" variant="outline" size="sm" value={value} onValueChange={(v) => v && onChange(v)} aria-label="Profile you’re in">
      {PROFILES.map((p) => (
        <ToggleGroupItem key={p.id} value={p.id}>
          <SpaceIcon space={p} className="size-3.5" />
          {p.name}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

// {A: LIBRARY PAGES}

type Filter = 'all' | 'off' | 'new' | 'problems';

const PAGES = [
  ['skills', 'Skills'],
  ['plugins', 'Plugins'],
  ['connectors', 'Connectors'],
] as const satisfies readonly (readonly [ItemPage, string])[];

const PAGE_NOUNS = { skills: 'skills', plugins: 'plugins, subagents and hooks', connectors: 'servers and connectors' } satisfies Record<ItemPage, string>;

function LibraryPagesMock({ items, setItems, profileId }: Items & { profileId: string }) {
  const [page, setPage] = useState<ItemPage>('skills');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const profile = PROFILES.find((p) => p.id === profileId)!;
  const onPage = items.filter((i) => KIND_PAGE[i.kind] === page);
  const shown = filterItems(onPage, filter, search, profileId);
  const mochi = shown.filter((i) => i.source === 'mochi');
  const isFiltered = !!search || filter !== 'all';
  // The accounts the profile you're in runs on come first; the others' items can't load there.
  const accounts = [...ACCOUNTS].sort((a, b) => Number(isUsedBy(b.id, profileId)) - Number(isUsedBy(a.id, profileId)));
  return (
    <MockFrame>
      <Tabs value={page} onValueChange={(v) => setPage(v as ItemPage)}>
        <TabsList variant="line" aria-label="Settings page">
          {PAGES.map(([id, label]) => (
            <TabsTrigger key={id} value={id} className="flex-none px-2">
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ToggleGroup type="single" variant="outline" size="sm" value={filter} onValueChange={(v) => setFilter((v || 'all') as Filter)} aria-label="Show">
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="off">Off in {profile.name}</ToggleGroupItem>
          <ToggleGroupItem value="new">New</ToggleGroupItem>
          <ToggleGroupItem value="problems">Problems</ToggleGroupItem>
        </ToggleGroup>
        <InputGroup className="h-8 sm:w-56">
          <InputGroupAddon>
            <SearchAlt />
          </InputGroupAddon>
          <InputGroupInput value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setSearch('')} placeholder={`Search ${page}`} aria-label={`Search ${PAGE_NOUNS[page]}`} />
        </InputGroup>
      </div>
      <SettingsSection title="In Mochi">
        <SettingsCard>
          {mochi.map((item) => (
            <ItemRow key={item.id} item={item} profileId={profileId} setItems={setItems} />
          ))}
          {!mochi.length && <EmptyRow text={isFiltered ? 'Nothing here matches' : `No ${page} in Mochi’s library yet`} />}
        </SettingsCard>
      </SettingsSection>
      {accounts.map((account) => {
        const all = onPage.filter((i) => i.accountId === account.id);
        if (!all.length) return null;
        return <HarnessSection key={account.id} accountId={account.id} rows={shown.filter((i) => i.accountId === account.id)} all={all} profileId={profileId} setItems={setItems} isFiltered={isFiltered} />;
      })}
    </MockFrame>
  );
}

const isUsedBy = (accountId: string, profileId: string) => Object.values(PROFILE_ACCOUNTS[profileId]).includes(accountId);

function filterItems(items: ProfileItem[], filter: Filter, search: string, profileId: string) {
  const q = search.trim().toLowerCase();
  return items.filter((i) => {
    if (q && ![i.name, i.description, i.where].some((t) => t.toLowerCase().includes(q))) return false;
    if (filter === 'off') return eligibleProfiles(i).some((p) => p.id === profileId) && !isOnIn(i, profileId);
    if (filter === 'new') return !!i.isNew;
    if (filter === 'problems') return !!i.error;
    return true;
  });
}

/** One harness account's items: a heading with its mark, Turn all off for the profile you're in, the rows, and where they're read from. */
function HarnessSection({ accountId, rows, all, profileId, setItems, isFiltered }: { accountId: string; rows: ProfileItem[]; all: ProfileItem[]; profileId: string; setItems: Items['setItems']; isFiltered: boolean }) {
  const account = accountOf(accountId)!;
  const harness = HARNESSES[account.provider].name;
  const users = PROFILES.filter((p) => PROFILE_ACCOUNTS[p.id][account.provider] === accountId);
  const profile = PROFILES.find((p) => p.id === profileId)!;
  const isMine = users.some((p) => p.id === profileId);
  const switchable = all.filter((i) => !i.lockedReason);
  const isAllOff = switchable.every((i) => i.profileIds.includes(profileId));
  const hasSeveralAccounts = ACCOUNTS.filter((a) => a.provider === account.provider).length > 1;
  const usedBy = `Read from ${account.dir}, used by ${LIST.format(users.map((p) => p.name))}.`;
  return (
    <SettingsSection
      title={
        <span className="flex flex-wrap items-center gap-x-2">
          <span className="flex items-center gap-2 whitespace-nowrap">
            <ProviderMark provider={account.provider} size={14} />
            From {harness}
          </span>
          {hasSeveralAccounts && <span className="font-normal whitespace-nowrap text-muted-foreground">· {account.name} account</span>}
        </span>
      }
      action={
        isMine &&
        !!switchable.length && (
          <Button variant="ghost" size="xs" onClick={() => setAllOff(setItems, switchable, profileId, !isAllOff, `${harness} ${countNoun(switchable)}`, profile.name, harness)}>
            {isAllOff ? `Turn all on in ${profile.name}` : `Turn all off in ${profile.name}`}
          </Button>
        )
      }
      footer={isMine ? `${usedBy} Turning one off leaves it out of Mochi threads only; ${harness} keeps loading it.` : `${usedBy} ${profile.name} runs on another ${harness} account, so none of these load there.`}
    >
      <SettingsCard>
        {rows.map((item) => (
          <ItemRow key={item.id} item={item} profileId={profileId} setItems={setItems} />
        ))}
        {!rows.length && <EmptyRow text={isFiltered ? 'Nothing here matches' : `${harness} has none on this account`} />}
      </SettingsCard>
    </SettingsSection>
  );
}

const LIST = new Intl.ListFormat('en', { type: 'conjunction' });

function countNoun(items: ProfileItem[]) {
  const kinds = new Set(items.map((i) => i.kind));
  return kinds.size === 1 ? countOf(items.length, KIND_LABELS[items[0].kind].toLowerCase()) : countOf(items.length, 'item');
}

function setAllOff(setItems: Items['setItems'], targets: ProfileItem[], profileId: string, isOff: boolean, what: string, profileName: string, harness: string) {
  const ids = new Set(targets.map((i) => i.id));
  let before: ProfileItem[] = [];
  setItems((all) => {
    before = all;
    return all.map((i) => (ids.has(i.id) ? { ...i, profileIds: isOff ? [...new Set([...i.profileIds, profileId])] : i.profileIds.filter((id) => id !== profileId) } : i));
  });
  toast(isOff ? `Turned off ${what} in ${profileName}` : `Turned on ${what} in ${profileName}`, {
    description: isOff ? `${harness} still loads them. New threads in ${profileName} start without them.` : `New threads in ${profileName} load them again.`,
    action: { label: 'Undo', onClick: () => setItems(before) },
  });
}

/** A library row with a native item's state: its source, whether the profile you're in loads it, and why not. */
function ItemRow({ item, profileId, setItems }: { item: ProfileItem; profileId: string; setItems: Items['setItems'] }) {
  const isEligible = eligibleProfiles(item).some((p) => p.id === profileId);
  const isDimmed = isEligible && !isOnIn(item, profileId) && item.source !== 'mochi';
  return (
    // With less than ~240px for the text, the actions wrap below it instead of squeezing it.
    <div className="relative flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 not-first:before:absolute not-first:before:inset-x-4 not-first:before:top-0 not-first:before:h-px not-first:before:bg-border">
      <div className="flex min-w-60 flex-1 items-center gap-3">
        <span className={cn('contents', isDimmed && '*:opacity-60')}>
          <LibraryIcon url={item.icon ?? null} letter={item.name} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn('truncate type-body font-medium', isDimmed && 'text-muted-foreground')}>{item.name}</span>
            {item.isNew && <Badge variant="secondary">New</Badge>}
          </span>
          {!!item.description && <span className="line-clamp-2 type-caption text-muted-foreground">{item.description}</span>}
          <span className="truncate type-caption text-subtle-foreground">
            {KIND_LABELS[item.kind]} · {item.where}
          </span>
          <ItemStatus item={item} profileId={profileId} />
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <ProfilesButton item={item} setItems={setItems} />
        <ItemMenu item={item} />
      </div>
    </div>
  );
}

/** The one line that explains a non-default state; nothing for an item that's simply on. */
function ItemStatus({ item, profileId }: { item: ProfileItem; profileId: string }) {
  const profile = PROFILES.find((p) => p.id === profileId)!;
  const harness = item.source !== 'mochi' && HARNESSES[item.source].name;
  if (item.error)
    return (
      <span className="flex items-start gap-1.5 type-caption text-warning">
        <WarningAlt aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        Couldn’t load: {item.error}
      </span>
    );
  if (item.lockedReason)
    return (
      <span className="flex items-center gap-1.5 type-caption text-muted-foreground">
        <Lock aria-hidden className="size-3.5 shrink-0" />
        Always on in Mochi: {harness} loads it in every session
      </span>
    );
  if (!harness || !eligibleProfiles(item).some((p) => p.id === profileId)) return null;
  if (!isOnIn(item, profileId)) return <span className="type-caption text-muted-foreground">Off in Mochi for {profile.name}. Still on in {harness}.</span>;
  if (item.isNew) return <span className="type-caption text-muted-foreground">New in {harness}. On, because {profile.name} loads new items.</span>;
  return null;
}

/**
 * Mochi items: the profiles that get it, as the library has today. Native items are on by default, so the button names
 * where they're off; profiles on another account can't load them and show disabled.
 */
function ProfilesButton({ item, setItems }: { item: ProfileItem; setItems: Items['setItems'] }) {
  const eligible = eligibleProfiles(item);
  const isNative = item.source !== 'mochi';
  const harness = isNative && HARNESSES[item.source as Provider].name;
  if (item.lockedReason)
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {/* A disabled button gets no pointer events, so the tooltip hangs on a wrapper. */}
          <span tabIndex={0} className="rounded-md">
            <Button variant="outline" size="sm" disabled className="pointer-events-none">
              <Lock data-icon="inline-start" />
              Always on
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">{item.lockedReason}</TooltipContent>
      </Tooltip>
    );
  const marked = isNative ? eligible.filter((p) => item.profileIds.includes(p.id)) : PROFILES.filter((p) => item.profileIds.includes(p.id));
  const label = isNative ? nativeLabel(marked, eligible) : libraryLabel(marked);
  const toggle = (id: string, isOn: boolean) =>
    setItems((all) => all.map((i) => (i.id !== item.id ? i : { ...i, profileIds: isNative !== isOn ? [...i.profileIds, id] : i.profileIds.filter((p) => p !== id) })));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn('max-w-44', (isNative ? marked.length > 0 : !marked.length) && 'text-muted-foreground')} aria-label={`Profiles that load ${item.name}: ${label}`}>
          {marked.length > 0 && (isNative || marked.length < PROFILES.length) && (
            <span className="flex -space-x-0.5">
              {marked.slice(0, 3).map((p) => (
                <SpaceIcon key={p.id} space={p} className="size-3.5" />
              ))}
            </span>
          )}
          <span className="truncate">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{isNative ? 'Load in these Mochi profiles' : 'Profiles that get it'}</DropdownMenuLabel>
        {PROFILES.map((p) => {
          const canLoad = eligible.includes(p);
          return (
            <DropdownMenuCheckboxItem
              key={p.id}
              disabled={!canLoad}
              checked={canLoad && (isNative ? !item.profileIds.includes(p.id) : item.profileIds.includes(p.id))}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(isOn) => toggle(p.id, isOn)}
            >
              <SpaceIcon space={p} className="size-3.5" />
              <span className="flex-1 truncate">{p.name}</span>
              {!canLoad && <span className="type-caption text-subtle-foreground">other account</span>}
            </DropdownMenuCheckboxItem>
          );
        })}
        {!!harness && (
          <>
            <DropdownMenuSeparator />
            <p className="px-2 py-1.5 type-caption text-muted-foreground">Off in Mochi only. Still on in {harness}. Applies to new threads.</p>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function nativeLabel(off: { name: string }[], eligible: unknown[]) {
  if (!off.length) return 'On';
  if (off.length === eligible.length) return 'Off in Mochi';
  if (off.length === 1) return `Off in ${off[0].name}`;
  return `Off in ${off.length} profiles`;
}

function libraryLabel(members: { name: string }[]) {
  if (!members.length) return 'No profiles';
  if (members.length === PROFILES.length) return 'All profiles';
  if (members.length === 1) return members[0].name;
  return `${members.length} profiles`;
}

/** Native items can't be removed or updated from Mochi: their menu only leads to where they live. */
function ItemMenu({ item }: { item: ProfileItem }) {
  const say = (what: string) => () => toast(what, { description: 'Mockup: does nothing here.' });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`${item.name} actions`}>
          <OverflowIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {item.source === 'mochi' ? (
          <>
            <DropdownMenuItem onSelect={say('Update now')}>
              <Refresh />
              Update now
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={say('Remove from library')}>
              <Trash />
              Remove from library
            </DropdownMenuItem>
          </>
        ) : item.kind === 'connector' ? (
          <DropdownMenuItem onSelect={say('Opens claude.ai › Settings › Connectors')}>
            <ExternalLink />
            Manage on claude.ai
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onSelect={say('Show in Finder')}>
              <FolderOpen />
              Show in Finder
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={say('View source')}>
              <FileCode />
              View source
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={say('Path copied')}>
              <Copy />
              Copy path
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MockFrame({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-6 rounded-xl border bg-background p-4 md:p-6', className)}>{children}</div>;
}

// {PROFILE SETTINGS}

/** What a harness can only drop as a group (feasibility matrix in PROFILES-UX.md): one switch each, on by default. */
const GROUP_SWITCHES = {
  claude: [
    ['hooks', 'Hooks', 'Claude Code can’t skip one hook, so this turns off every hook in Mochi threads, plugins’ included'],
    ['claudeAi', 'Claude.ai connectors', 'The connectors your Claude.ai login brings, like Gmail and Google Calendar'],
  ],
  codex: [
    ['subagents', 'Subagents', 'Codex can’t skip one subagent, so this turns off all of them in Mochi threads'],
    ['apps', 'ChatGPT apps', 'The apps your ChatGPT login brings'],
  ],
} as const satisfies Record<Provider, readonly (readonly [string, string, string])[]>;

const NEW_ITEM_OPTIONS = [
  { value: 'on', label: 'Load them' },
  { value: 'off', label: 'Only what I add' },
] as const;

function ProfileHarnessRows({ items, setItems, profileId }: Items & { profileId: string }) {
  const [newItems, setNewItems] = useState<Record<string, NewItemsMode>>({ 'latitude:claude': 'on', 'latitude:codex': 'on', 'personal:claude': 'on', 'personal:codex': 'off', 'liane:claude': 'off', 'liane:codex': 'off' });
  const [groupsOff, setGroupsOff] = useState<string[]>([]);
  const profile = PROFILES.find((p) => p.id === profileId)!;
  return (
    <MockFrame className="gap-4">
      <SettingsSection title="Claude Code and Codex" footer={`Mochi never changes Claude Code’s or Codex’s own files. What you turn off here only leaves Mochi threads in ${profile.name}.`}>
        <SettingsCard>
          {HARNESS_IDS.map((provider) => {
            const harness = HARNESSES[provider].name;
            const account = accountOf(PROFILE_ACCOUNTS[profileId][provider])!;
            const mine = items.filter((i) => i.accountId === account.id);
            const switchable = mine.filter((i) => !i.lockedReason);
            const off = switchable.filter((i) => i.profileIds.includes(profileId));
            const isAllOff = !!switchable.length && off.length === switchable.length;
            const key = `${profileId}:${provider}`;
            return [
              <SettingsRow
                key={`${key}-all`}
                label={
                  <span className="flex items-center gap-2">
                    <ProviderMark provider={provider} size={14} />
                    Everything from {harness}
                  </span>
                }
                description={`${account.name} account · ${countOf(mine.length, 'item')}${off.length ? `, ${off.length} off in Mochi` : ''}`}
                control={
                  <Button variant="outline" size="sm" disabled={!switchable.length} onClick={() => setAllOff(setItems, switchable, profileId, !isAllOff, `everything from ${harness}`, profile.name, harness)}>
                    {isAllOff ? 'Turn all on' : 'Turn all off'}
                  </Button>
                }
              />,
              <SettingsRow
                key={`${key}-new`}
                label={`New in ${harness}`}
                description={newItems[key] === 'on' ? `What you add to ${harness} later loads here too` : `What you add to ${harness} later arrives off; turn it on here`}
                control={<SettingsSelect value={newItems[key]} options={NEW_ITEM_OPTIONS} onChange={(v) => setNewItems((m) => ({ ...m, [key]: v }))} aria-label={`New ${harness} items in ${profile.name}`} />}
              />,
              ...GROUP_SWITCHES[provider].map(([id, label, description]) => {
                const groupKey = `${key}:${id}`;
                return (
                  <SettingsRow
                    key={groupKey}
                    label={`${label} from ${harness}`}
                    description={description}
                    control={<Switch checked={!groupsOff.includes(groupKey)} onCheckedChange={(isOn) => setGroupsOff((off) => (isOn ? off.filter((k) => k !== groupKey) : [...off, groupKey]))} aria-label={`${label} from ${harness} in ${profile.name}`} />}
                  />
                );
              }),
            ];
          })}
        </SettingsCard>
      </SettingsSection>
    </MockFrame>
  );
}

// {THREAD}

function ThreadLoadedMock({ items, profileId }: { items: ProfileItem[]; profileId: string }) {
  const [isChanged, setChanged] = useState(false);
  const profile = PROFILES.find((p) => p.id === profileId)!;
  const provider: Provider = 'claude';
  const reach = items.filter((i) => i.source === 'mochi' || i.source === provider);
  const loaded = reach.filter((i) => isOnIn(i, profileId) && !i.error);
  const off = reach.filter((i) => i.source !== 'mochi' && eligibleProfiles(i).some((p) => p.id === profileId) && !isOnIn(i, profileId));
  return (
    <MockFrame className="gap-4">
      <div className="flex items-center gap-2">
        <Switch id="np-changed" checked={isChanged} onCheckedChange={setChanged} />
        <label htmlFor="np-changed" className="type-meta text-muted-foreground">
          Profile changed after the thread started
        </label>
      </div>
      <div className="w-full max-w-[300px] rounded-xl border bg-card p-1">
        <p className="px-2 pt-1.5 pb-1 type-meta font-medium">Environment</p>
        <EnvRow icon={<Folder className="size-4 text-muted-foreground" />} label="harness · ~/dev" />
        <EnvRow icon={<ProviderMark provider={provider} />} label="Opus 5.5" />
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="flex min-h-8 w-full items-center gap-2.5 rounded-lg px-2 py-1 text-left hover:bg-accent/60 focus-visible:outline-2 focus-visible:-outline-offset-2">
              <SpaceIcon space={profile} className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate type-meta">
                {profile.name}
                <span className="text-subtle-foreground">
                  {' '}
                  · {loaded.length} loaded{off.length ? `, ${off.length} off` : ''}
                </span>
              </span>
              {isChanged && <span aria-label="Changed since this thread started" className="size-1.5 shrink-0 rounded-full bg-warning" />}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-0">
            <LoadedList loaded={loaded} off={off} profileName={profile.name} isChanged={isChanged} />
          </PopoverContent>
        </Popover>
      </div>
    </MockFrame>
  );
}

function EnvRow({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex min-h-8 items-center gap-2.5 px-2 py-1">
      {icon}
      <span className="truncate type-meta">{label}</span>
    </div>
  );
}

function LoadedList({ loaded, off, profileName, isChanged }: { loaded: ProfileItem[]; off: ProfileItem[]; profileName: string; isChanged: boolean }) {
  const groups = [
    ['From Mochi', loaded.filter((i) => i.source === 'mochi')],
    ['From Claude Code', loaded.filter((i) => i.source === 'claude')],
  ] as const;
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 p-3">
        <p className="type-meta font-medium">What this thread loaded</p>
        {groups.map(([title, list]) => (
          <div key={title} className="flex flex-col gap-1">
            <p className="type-caption text-muted-foreground">
              {title} · {list.length}
            </p>
            <p className="type-caption text-pretty">{list.map((i) => i.name).join(', ') || 'Nothing'}</p>
          </div>
        ))}
        {!!off.length && (
          <div className="flex flex-col gap-1">
            <p className="type-caption text-muted-foreground">
              Off in Mochi for {profileName} · {off.length}
            </p>
            <p className="type-caption text-pretty text-muted-foreground">{off.map((i) => i.name).join(', ')}</p>
          </div>
        )}
      </div>
      {isChanged && <p className="border-t px-3 py-2 type-caption text-warning">{profileName} changed after this thread started. New threads get the new set.</p>}
      <div className="border-t p-1">
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => toast('Opens Settings › Skills')}>
          Change what {profileName} loads
        </Button>
      </div>
    </div>
  );
}

// {FIRST RUN}

function FirstRunMock() {
  const [isSeen, setSeen] = useState(false);
  return (
    <MockFrame>
      <SettingsSection
        title={
          <span className="flex items-center gap-2">
            <ProviderMark provider="claude" size={14} />
            From Claude Code
          </span>
        }
      >
        {!isSeen && (
          <Alert>
            <Info />
            <AlertTitle>Claude Code’s own skills show here now</AlertTitle>
            <AlertDescription>
              <p>Mochi found 4 skills on your Default account. They stay on in every profile. Turning one off here only changes Mochi threads; Claude Code keeps loading it.</p>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setSeen(true)}>
                Got it
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <SettingsCard>
          <ItemRow item={ITEMS.find((i) => i.id === 'cd-ui')!} profileId="personal" setItems={() => {}} />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection
        title={
          <span className="flex items-center gap-2">
            <ProviderMark provider="codex" size={14} />
            From Codex
          </span>
        }
        footer="Read from ~/.codex and ~/.agents, used by every profile."
      >
        <SettingsCard>
          <EmptyRow text="Codex has no skills on this account" />
        </SettingsCard>
      </SettingsSection>
      <p className="px-1 type-caption text-muted-foreground">A harness that isn’t installed has no section at all; Settings › Agents is where it gets set up.</p>
    </MockFrame>
  );
}

// {B: ONE LIST PER PROFILE}

const SOURCES = [['mochi', 'In Mochi'] as const, ...HARNESS_IDS.map((h) => [h, `From ${HARNESSES[h].name}`] as const)];

function ProfileListMock({ items, setItems, profileId }: Items & { profileId: string }) {
  const [tab, setTab] = useState(profileId);
  const profile = PROFILES.find((p) => p.id === tab)!;
  const toggle = (item: ProfileItem, isOn: boolean) =>
    setItems((all) => all.map((i) => (i.id !== item.id ? i : { ...i, profileIds: (item.source === 'mochi') === isOn ? [...i.profileIds, tab] : i.profileIds.filter((p) => p !== tab) })));
  return (
    <MockFrame>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="line" aria-label="Profile">
          {PROFILES.map((p) => (
            <TabsTrigger key={p.id} value={p.id} className="flex-none px-2">
              <SpaceIcon space={p} className="size-3.5" />
              {p.name}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {SOURCES.map(([source, title]) => {
        const rows = items.filter((i) => i.source === source && eligibleProfiles(i).includes(profile));
        if (!rows.length) return null;
        return (
          <SettingsSection
            key={source}
            title={
              <span className="flex items-center gap-2">
                {source !== 'mochi' && <ProviderMark provider={source} size={14} />}
                {title}
              </span>
            }
          >
            <SettingsCard>
              {rows.map((item) => (
                <SettingsRow
                  key={item.id}
                  label={item.name}
                  description={`${KIND_LABELS[item.kind]} · ${item.where}`}
                  control={
                    item.lockedReason ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0} className="flex items-center gap-1.5 type-meta text-muted-foreground">
                            <Lock className="size-3.5" aria-hidden />
                            Always on
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-64">{item.lockedReason}</TooltipContent>
                      </Tooltip>
                    ) : (
                      <Switch checked={isOnIn(item, tab)} onCheckedChange={(isOn) => toggle(item, isOn)} aria-label={`Load ${item.name} in ${profile.name}`} />
                    )
                  }
                />
              ))}
            </SettingsCard>
          </SettingsSection>
        );
      })}
    </MockFrame>
  );
}

// {C: COMPARE}

function CompareMatrixMock({ items, setItems }: Items) {
  const [isDiffOnly, setDiffOnly] = useState(false);
  const differs = (i: ProfileItem) => new Set(eligibleProfiles(i).map((p) => isOnIn(i, p.id))).size > 1;
  const toggle = (item: ProfileItem, profileId: string, isOn: boolean) =>
    setItems((all) => all.map((i) => (i.id !== item.id ? i : { ...i, profileIds: (item.source === 'mochi') === isOn ? [...i.profileIds, profileId] : i.profileIds.filter((p) => p !== profileId) })));
  return (
    <MockFrame>
      <div className="flex items-center gap-2">
        <Switch id="np-diff" checked={isDiffOnly} onCheckedChange={setDiffOnly} />
        <label htmlFor="np-diff" className="type-meta text-muted-foreground">
          Only items that differ between profiles
        </label>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="min-w-56">Item</TableHead>
              {PROFILES.map((p) => (
                <TableHead key={p.id} className="w-28 text-center">
                  <span className="inline-flex items-center gap-1.5">
                    <SpaceIcon space={p} className="size-3.5" />
                    {p.name}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {SOURCES.map(([source, title]) => {
              const rows = items.filter((i) => i.source === source && (!isDiffOnly || differs(i)));
              if (!rows.length) return null;
              return [
                <TableRow key={source} className="hover:bg-transparent">
                  <TableCell colSpan={PROFILES.length + 1} className="pt-4 type-meta font-medium">
                    <span className="flex items-center gap-2">
                      {source !== 'mochi' && <ProviderMark provider={source} size={14} />}
                      {title}
                    </span>
                  </TableCell>
                </TableRow>,
                ...rows.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <span className="flex flex-col">
                        <span className="type-meta">{item.name}</span>
                        <span className="type-caption text-subtle-foreground">{KIND_LABELS[item.kind]}</span>
                      </span>
                    </TableCell>
                    {PROFILES.map((p) => (
                      <TableCell key={p.id} className="text-center">
                        <MatrixCell item={item} profileId={p.id} onChange={(isOn) => toggle(item, p.id, isOn)} />
                      </TableCell>
                    ))}
                  </TableRow>
                )),
              ];
            })}
          </TableBody>
        </Table>
      </div>
    </MockFrame>
  );
}

function MatrixCell({ item, profileId, onChange }: { item: ProfileItem; profileId: string; onChange: (isOn: boolean) => void }) {
  const profile = PROFILES.find((p) => p.id === profileId)!;
  if (!eligibleProfiles(item).includes(profile))
    return (
      <span className="type-caption text-subtle-foreground" title="Runs on another account">
        n/a
      </span>
    );
  if (item.lockedReason)
    return (
      <span title={item.lockedReason} className="inline-flex">
        <Lock aria-label="Always on" className="size-3.5 text-muted-foreground" />
      </span>
    );
  return <Checkbox checked={isOnIn(item, profileId)} onCheckedChange={(v) => onChange(v === true)} aria-label={`Load ${item.name} in ${profile.name}`} />;
}
