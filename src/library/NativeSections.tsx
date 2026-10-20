import { Copy, FolderOpen } from '@/icons';
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
import { cn } from '@/lib/utils';
import { toast } from '@/toast/store';
import { copyText } from '../clipboard';
import { host } from '../host';
import type { Space } from '../model';
import { updateProfile, useProfiles } from '../profiles';
import { HARNESSES } from '../settings/harnesses';
import { SettingsCard, SettingsSection } from '../settings/parts';
import { useHarness } from '../store';
import { OverflowIcon, ProviderMark, SpaceIcon } from '../ui';
import { EmptyRow, filterBy, LibraryRow, LIST } from './LibraryParts';
import { accountDir, NATIVE_KIND_LABELS, withOff, type NativeItem, type NativeKind } from './nativeItems';
import { setAllOff } from './nativeOff';
import { useNativeItems, type NativeAccount } from './useNativeItems';

/**
 * Claude Code's and Codex's own items of one kind, a section per account after the page's "In Mochi" list. They're on by
 * default; a profile can leave one out of its Mochi threads, and the tools keep loading it (PROFILES-UX.md).
 */
export function NativeSections({ kind, query }: { kind: NativeKind; query: string }) {
  const accounts = useNativeItems();
  const spaceId = useHarness().state.spaceId;
  if (!accounts) return null;
  // The accounts the profile you're in runs on come first; the others' items can't load there.
  const sorted = accounts.toSorted((a, b) => Number(b.profileIds.includes(spaceId)) - Number(a.profileIds.includes(spaceId)));
  return sorted.map((native) => {
    const all = native.items.filter((i) => i.kind === kind);
    if (!all.length || !native.profileIds.length) return null;
    const shown = filterBy(all, query, (i) => [i.name, i.description, i.where]);
    if (query && !shown.length) return null;
    return (
      <AccountSection
        key={native.account.id}
        native={native}
        all={all}
        shown={shown}
        spaceId={spaceId}
        hasSeveral={accounts.filter((a) => a.account.provider === native.account.provider && a.profileIds.length).length > 1}
      />
    );
  });
}

function AccountSection({
  native,
  all,
  shown,
  spaceId,
  hasSeveral,
}: {
  native: NativeAccount;
  all: NativeItem[];
  shown: NativeItem[];
  spaceId: string;
  hasSeveral: boolean;
}) {
  const { account, profileIds } = native;
  const harness = HARNESSES[account.provider].name;
  const profiles = useProfiles();
  const users = profiles.filter((p) => profileIds.includes(p.id));
  const isMine = profileIds.includes(spaceId);
  // From the store's list, not profileById: the compiler would keep a module read from an earlier render.
  const profile = profiles.find((p) => p.id === spaceId) ?? profiles[0];
  const switchable = all.filter((i) => !i.isOffNatively);
  const isAllOff = !!switchable.length && switchable.every((i) => profile.nativeOff?.includes(i.id));
  const usedBy = `Read from ${accountDir(account)}, used by ${LIST.format(users.map((p) => p.name))}.`;
  return (
    <SettingsSection
      title={
        <span className="flex flex-wrap items-center gap-x-2">
          <span className="flex items-center gap-2 whitespace-nowrap">
            <ProviderMark provider={account.provider} size={14} />
            From {harness}
          </span>
          {hasSeveral && <span className="font-normal whitespace-nowrap text-muted-foreground">· {account.name} account</span>}
        </span>
      }
      action={
        isMine &&
        !!switchable.length && (
          <Button variant="ghost" size="xs" onClick={() => setAllOff(profile, switchable, !isAllOff, harness)}>
            {isAllOff ? `Turn all on in ${profile.name}` : `Turn all off in ${profile.name}`}
          </Button>
        )
      }
      footer={
        isMine
          ? `${usedBy} Turning one off leaves it out of Mochi threads only; ${harness} keeps loading it.`
          : `${usedBy} ${profile.name} runs on another ${harness} account, so none of these load there.`
      }
    >
      <SettingsCard>
        {native.error && <EmptyRow text={`Couldn’t read all of ${accountDir(account)}: ${native.error}`} />}
        {shown.map((item) => (
          <NativeRow key={item.id} item={item} harness={harness} eligible={users} profile={profile} isMine={isMine} />
        ))}
      </SettingsCard>
    </SettingsSection>
  );
}

/** A library row for a native item: where it lives, the one line explaining a non-default state, where it's off, and where it lives on disk. */
function NativeRow({ item, harness, eligible, profile, isMine }: { item: NativeItem; harness: string; eligible: Space[]; profile: Space; isMine: boolean }) {
  const isOffHere = isMine && !!profile.nativeOff?.includes(item.id);
  return (
    <LibraryRow
      name={item.name}
      icon={null}
      description={item.description}
      meta={`${NATIVE_KIND_LABELS[item.kind]} · ${item.where}`}
      notes={item.problem ? [item.problem] : []}
      isDimmed={isOffHere || item.isOffNatively}
      status={item.isOffNatively ? `Off in ${harness} itself, so no thread loads it` : isOffHere && `Off in Mochi for ${profile.name}. Still on in ${harness}.`}
      actions={
        <>
          {!item.isOffNatively && <NativeProfilesMenu item={item} harness={harness} eligible={eligible} />}
          <NativeItemMenu item={item} />
        </>
      }
    />
  );
}

/** Native items are on by default, so the button names where they're off; one checkbox per profile on the item's account. */
function NativeProfilesMenu({ item, harness, eligible }: { item: NativeItem; harness: string; eligible: Space[] }) {
  const profiles = useProfiles();
  const off = eligible.filter((p) => p.nativeOff?.includes(item.id));
  const label = !off.length
    ? 'On'
    : off.length === eligible.length
      ? 'Off in Mochi'
      : off.length === 1
        ? `Off in ${off[0].name}`
        : `Off in ${off.length} profiles`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn('max-w-44', !!off.length && 'text-muted-foreground')}
          aria-label={`Profiles that load ${item.name}: ${label}`}
        >
          {!!off.length && (
            <span className="flex -space-x-0.5">
              {off.slice(0, 3).map((p) => (
                <SpaceIcon key={p.id} space={p} className="size-3.5" />
              ))}
            </span>
          )}
          <span className="truncate">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Load in these Mochi profiles</DropdownMenuLabel>
        {profiles.map((p) => {
          const canLoad = eligible.includes(p);
          return (
            <DropdownMenuCheckboxItem
              key={p.id}
              disabled={!canLoad}
              checked={canLoad && !p.nativeOff?.includes(item.id)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(isOn) => updateProfile(p.id, { nativeOff: withOff(p.nativeOff, [item.id], !isOn) })}
            >
              <SpaceIcon space={p} className="size-3.5" />
              <span className="flex-1 truncate">{p.name}</span>
              {!canLoad && <span className="type-caption text-subtle-foreground">other account</span>}
            </DropdownMenuCheckboxItem>
          );
        })}
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 type-caption text-muted-foreground">Off in Mochi only. Still on in {harness}. Applies to new threads.</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Mochi never removes or updates a native item, so its menu only leads to where it lives. */
function NativeItemMenu({ item }: { item: NativeItem }) {
  const { path } = item;
  if (!path) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`${item.name} actions`}>
          <OverflowIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {host.isDesktop && (
          <DropdownMenuItem onSelect={() => void host.fs.reveal(path, '').catch((e: Error) => toast.error('Couldn’t show it', { description: e.message }))}>
            <FolderOpen />
            Show folder
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => copyText(path, 'Path copied')}>
          <Copy />
          Copy path
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
