import type { Account, AccountId, AccountLinks } from '../host/types/settings.ts';
import type { Provider } from '../model.ts';
import { HARNESS_IDS, HARNESSES } from './harnesses.ts';

export const defaultAccountId = (provider: Provider): AccountId => `${provider}-default`;

/** Each harness's own default folder, always present. */
export const DEFAULT_ACCOUNTS: Account[] = HARNESS_IDS.map((provider) => ({ id: defaultAccountId(provider), provider, name: 'Default', configDir: null }));

export function linkedAccountId(links: Record<string, AccountLinks>, spaceId: string, provider: Provider): AccountId {
  return links[spaceId]?.[provider] ?? defaultAccountId(provider);
}

/** Profiles using an account, counting the implicit link every unlinked profile has to its provider's default. */
export function profilesUsing(links: Record<string, AccountLinks>, spaceIds: string[], account: Account): string[] {
  return spaceIds.filter((spaceId) => linkedAccountId(links, spaceId, account.provider) === account.id);
}

/** What the user runs in a terminal to sign this account in: the tool's own login, pointed at the account's folder. */
export function signInCommand(account: Account): string {
  const { loginCommand, configDirEnv } = HARNESSES[account.provider];
  return account.configDir ? `${configDirEnv}=${shellQuote(account.configDir)} ${loginCommand}` : loginCommand;
}

/** A readable, unique id from the name the user typed: `claude-work`, then `claude-work-2`. */
export function newAccountId(provider: Provider, name: string, taken: AccountId[]): AccountId {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'account';
  const base = `${provider}-${slug}`;
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

function shellQuote(path: string) {
  return /^[\w/.~-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`;
}
