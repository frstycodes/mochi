import { useEffect, useState } from 'react';
import { host } from '../host';
import type { Account } from '../host/types/settings';
import { useProfiles } from '../profiles';
import { linkedAccountId } from '../settings/accounts';
import { nativeItemsOf, type NativeItem } from './nativeItems';

/** One Claude Code or Codex account the profiles run on, its own items, and the profiles that load them. */
export interface NativeAccount {
  account: Account;
  profileIds: string[];
  items: NativeItem[];
  error?: string;
}

/** Every account some profile runs on, read from its own config folder; undefined while reading. Read again when the window regains focus, since the tools change these files too. */
export function useNativeItems(): NativeAccount[] | undefined {
  const profiles = useProfiles();
  const [accounts, setAccounts] = useState<NativeAccount[]>();
  const profileKey = profiles.map((p) => p.id).join();
  useEffect(() => {
    let isCurrent = true;
    const read = () =>
      void readAll(profiles.map((p) => p.id)).then(
        (next) => isCurrent && setAccounts(next),
        () => isCurrent && setAccounts([]),
      );
    read();
    addEventListener('focus', read);
    return () => {
      isCurrent = false;
      removeEventListener('focus', read);
    };
  }, [profileKey]);
  return accounts;
}

/** Each profile's config holds its two accounts; profiles sharing an account read the same folder, so each account is kept once. */
async function readAll(profileIds: string[]): Promise<NativeAccount[]> {
  const { links } = await host.settings.accounts();
  const configs = await Promise.all(profileIds.map((id) => host.settings.agentConfig(id).then((config) => ({ id, config }))));
  const byAccount = new Map<string, NativeAccount>();
  for (const { config } of configs)
    for (const provider of Object.values(config)) {
      if (byAccount.has(provider.account.id)) continue;
      const users = profileIds.filter((id) => linkedAccountId(links, id, provider.provider) === provider.account.id);
      byAccount.set(provider.account.id, {
        account: provider.account,
        profileIds: users,
        items: nativeItemsOf(provider),
        ...(provider.error && { error: provider.error }),
      });
    }
  return [...byAccount.values()];
}
