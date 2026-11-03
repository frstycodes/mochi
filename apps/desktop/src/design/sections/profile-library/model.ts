import { useState } from 'react';
import { toast } from '@/toast/store';
import type { Space } from '../../../model';
import {
  ACCOUNTS,
  INITIAL_ADDED,
  INITIAL_OFF,
  ITEMS,
  PROFILE_ACCOUNTS,
  PROFILES,
  type Kind,
  type LibItem,
} from '../../profileLibraryFixtures';

/**
 * One state for every variant, so a change in one shows in the others. Mochi items are added to a profile; native items
 * are on until turned off in Mochi only (PROFILES-UX.md); locked ones are always on; another account's never load.
 */
export type ItemState =
  | 'added'
  | 'not-added'
  | 'on'
  | 'off'
  | 'locked'
  | 'other-account';

export type Membership = {
  profiles: Space[];
  accounts: Record<string, string[]>;
  added: Record<string, string[]>;
  off: Record<string, string[]>;
};

export const SEEDED: Membership = {
  profiles: PROFILES,
  accounts: PROFILE_ACCOUNTS,
  added: INITIAL_ADDED,
  off: INITIAL_OFF,
};

const FIRST_RUN: Membership = {
  ...SEEDED,
  added: { personal: [], work: [], clientx: [] },
  off: { personal: [], work: [], clientx: [] },
};

export function stateIn(
  m: Membership,
  item: LibItem,
  profileId: string,
): ItemState {
  if (item.source === 'mochi')
    return m.added[profileId]?.includes(item.id) ? 'added' : 'not-added';
  if (!m.accounts[profileId]?.includes(item.accountId ?? ''))
    return 'other-account';
  if (item.lockedReason) return 'locked';
  return m.off[profileId]?.includes(item.id) ? 'off' : 'on';
}

/** Mochi items join or leave `added`; native ones leave or join `off`, the inverse. */
export function withItems(
  m: Membership,
  profileId: string,
  targets: LibItem[],
  isOn: boolean,
): Membership {
  const mochi = targets.filter((i) => i.source === 'mochi').map((i) => i.id);
  const native = targets.filter((i) => i.source !== 'mochi').map((i) => i.id);
  const edit = (ids: string[], add: string[], keep: boolean) =>
    keep
      ? [...new Set([...ids, ...add])]
      : ids.filter((id) => !add.includes(id));
  return {
    ...m,
    added: {
      ...m.added,
      [profileId]: edit(m.added[profileId] ?? [], mochi, isOn),
    },
    off: {
      ...m.off,
      [profileId]: edit(m.off[profileId] ?? [], native, !isOn),
    },
  };
}

export type ProfileLibrary = ReturnType<typeof useProfileLibrary>;

export function useProfileLibrary() {
  const [isFirstRun, setFirstRun] = useState(false);
  const [state, setState] = useState(SEEDED);
  const items = isFirstRun ? ITEMS.filter((i) => i.source !== 'mochi') : ITEMS;

  const stateOf = (item: LibItem, profileId: string) =>
    stateIn(state, item, profileId);
  const isIn = (item: LibItem, profileId: string) =>
    ['added', 'on', 'locked'].includes(stateOf(item, profileId));
  const canChange = (item: LibItem, profileId: string) =>
    !['locked', 'other-account'].includes(stateOf(item, profileId));

  /** Every change goes through here: it applies, and an undo toast restores what was there before. */
  const change = (
    title: string,
    next: (s: Membership) => Membership,
    description?: string,
  ) => {
    const before = state;
    setState(next);
    toast(title, {
      description,
      action: { label: 'Undo', onClick: () => setState(before) },
    });
  };

  const profileName = (id: string) =>
    state.profiles.find((p) => p.id === id)?.name ?? id;

  /**
   * Adds (or turns on) `targets` in one or several profiles, or removes (turns off) them, as one change with one undo;
   * locked and other-account items are skipped.
   */
  const setIn = (
    targets: LibItem[],
    profileIds: string | string[],
    isOn: boolean,
  ) => {
    const per = [profileIds].flat().map((id) => ({
      id,
      changing: targets.filter((i) => canChange(i, id) && isIn(i, id) !== isOn),
    }));
    const changed = per.filter((p) => p.changing.length);
    if (!changed.length) return;
    const ids = new Set(changed.flatMap((p) => p.changing.map((i) => i.id)));
    const what =
      ids.size === 1
        ? targets.find((i) => ids.has(i.id))!.name
        : `${ids.size} items`;
    const names = LIST.format(changed.map((p) => profileName(p.id)));
    const hasNative = changed.some((p) =>
      p.changing.some((i) => i.source !== 'mochi'),
    );
    change(
      isOn ? `Added ${what} to ${names}` : `Removed ${what} from ${names}`,
      (s) =>
        changed.reduce((acc, p) => withItems(acc, p.id, p.changing, isOn), s),
      hasNative && !isOn
        ? 'Off in Mochi only. Claude Code and Codex still load them. Applies to new threads.'
        : 'Applies to new threads.',
    );
  };

  /** Makes `to` load what `from` loads, for the items both can load. */
  const copyAll = (fromId: string, toId: string) => {
    const shared = items.filter(
      (i) => canChange(i, toId) && stateOf(i, fromId) !== 'other-account',
    );
    change(
      `${profileName(toId)} now matches ${profileName(fromId)}`,
      (s) =>
        withItems(
          withItems(
            s,
            toId,
            shared.filter((i) => isIn(i, fromId)),
            true,
          ),
          toId,
          shared.filter((i) => !isIn(i, fromId)),
          false,
        ),
      'Items from another Claude Code account stay as they were.',
    );
  };

  const duplicate = (fromId: string) => {
    const from = state.profiles.find((p) => p.id === fromId)!;
    const id = `${fromId}-${state.profiles.length}`;
    const copy = {
      ...from,
      id,
      name: `${from.name} copy`,
      icon: 'star' as const,
    };
    change(`Made ${copy.name} from ${from.name}`, (s) => ({
      profiles: [...s.profiles, copy],
      accounts: { ...s.accounts, [id]: s.accounts[fromId] },
      added: { ...s.added, [id]: s.added[fromId] ?? [] },
      off: { ...s.off, [id]: s.off[fromId] ?? [] },
    }));
    return id;
  };

  return {
    items,
    profiles: state.profiles,
    isFirstRun,
    setFirstRun: (isOn: boolean) => {
      setFirstRun(isOn);
      setState(isOn ? FIRST_RUN : SEEDED);
    },
    stateOf,
    isIn,
    canChange,
    setIn,
    copyAll,
    duplicate,
    profileName,
    accountsOf: (profileId: string) => state.accounts[profileId] ?? [],
  };
}

const LIST = new Intl.ListFormat('en', { type: 'conjunction' });

export const KINDS = [
  ['skill', 'Skills'],
  ['plugin', 'Plugins'],
  ['connector', 'Connectors'],
] as const satisfies readonly (readonly [Kind, string])[];

export const PART_LABELS = {
  skill: 'Skill',
  plugin: 'Plugin',
  connector: 'Connector',
  subagent: 'Subagent',
  hook: 'Hook',
  server: 'MCP server',
} satisfies Record<Kind | NonNullable<LibItem['part']>, string>;

export const STATE_LABELS = {
  added: 'Added',
  'not-added': 'Not added',
  on: 'On',
  off: 'Off in Mochi only',
  locked: 'Always on',
  'other-account': 'Other account',
} satisfies Record<ItemState, string>;

export function matches(item: LibItem, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [item.name, item.description, item.where, item.service, item.account]
    .filter(Boolean)
    .some((t) => t!.toLowerCase().includes(q));
}

/** Connector accounts gathered under their service; native servers and connectors stand alone. */
export function byService(items: LibItem[]) {
  const groups = new Map<string, LibItem[]>();
  for (const item of items) {
    const key = item.service ?? item.id;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()].map(([key, members]) => ({
    key,
    name: members[0].service ?? members[0].name,
    members,
  }));
}

export const accountName = (id: string) =>
  ACCOUNTS.find((a) => a.id === id)?.name;

/** The status line a row shows under its meta, or nothing when the item is simply in. */
export function statusLine(
  item: LibItem,
  state: ItemState,
  profileName: string,
) {
  if (item.error) return `Couldn’t load: ${item.error}`;
  const harness = item.source === 'codex' ? 'Codex' : 'Claude Code';
  if (state === 'off')
    return `Off in Mochi for ${profileName}. Still on in ${harness}.`;
  if (state === 'locked')
    return `Always on in Mochi: ${harness} loads it in every session.`;
  if (state === 'other-account')
    return `${profileName} runs on another ${harness} account, so this never loads there.`;
  if (item.isNew)
    return `New in ${harness}. On, because ${profileName} loads new items.`;
  return null;
}
