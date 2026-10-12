import type { Provider } from '../../model.ts';
import { HARNESS_IDS, HARNESSES } from '../../settings/harnesses.ts';
import type { Manifest } from './manifest.ts';

/** What the user's own install reports. Never carries credentials, emails or key material: only method and plan names. */
export interface AgentInstall {
  provider: Provider;
  accountId: AccountId;
  /** null when no executable was found. */
  path: string | null;
  version: string | null;
  login: AgentLogin;
}

export type AgentLogin =
  | { state: 'logged-in'; method: string; plan?: string }
  | { state: 'logged-out' }
  /** The tool ran but its status couldn't be read (timeout, unexpected output). */
  | { state: 'unknown'; reason: string };

/** Per harness. Empty strings mean "not set": find the executable on the user's PATH, let the harness pick its model. */
export interface HarnessSettings {
  path: string;
  model: string;
}

/** Everything the main process reads. Empty strings mean "not set": the built-in worktrees folder, the user's `$SHELL`. */
export interface AgentSettings {
  concurrency: number;
  harnesses: Record<Provider, HarnessSettings>;
  worktreeRoot: string;
  shell: string;
  prDrafts: boolean;
  /** Claude model id side chat starts on; each side chat can switch. */
  sideChatModel: string;
}

/** What `set` takes: any top-level field, and per harness any of its fields. */
export type AgentSettingsPatch = Partial<Omit<AgentSettings, 'harnesses'>> & { harnesses?: Partial<Record<Provider, Partial<HarnessSettings>>> };

/** The renderer only ever learns whether a key is stored and its last four characters. */
export interface ApiKeyState {
  isSet: boolean;
  last4?: string;
  /** False when the OS keychain isn't available, so a key can't be stored safely. */
  canStore: boolean;
}

export type AccountId = string;

/** One Claude Code or Codex login, kept in its own config folder; the user signs in from the tool itself. */
export interface Account {
  id: AccountId;
  provider: Provider;
  name: string;
  /** null: the tool's own default folder (`~/.claude`, `~/.codex`). */
  configDir: string | null;
}

/** Per profile (space): at most one account per provider. A missing entry means that provider's default account. */
export type AccountLinks = Partial<Record<Provider, AccountId>>;

export interface AccountsState {
  accounts: Account[];
  links: Record<string, AccountLinks>;
}

export interface SettingsHost {
  get(): Promise<AgentSettings>;
  set(patch: AgentSettingsPatch): Promise<AgentSettings>;
  /** The install plus the login it reports for this account's config folder. */
  detect(accountId: AccountId): Promise<AgentInstall>;
  accounts(): Promise<AccountsState>;
  /** Creates the account's config folder; the user then signs in with `signInCommand`. */
  addAccount(provider: Provider, name: string): Promise<AccountsState>;
  renameAccount(id: AccountId, name: string): Promise<AccountsState>;
  /** Refused for a default account and for one any profile links. The folder (and the login in it) stays on disk. */
  removeAccount(id: AccountId): Promise<AccountsState>;
  linkAccount(spaceId: string, provider: Provider, id: AccountId): Promise<AccountsState>;
  /** Only for harnesses with an `apiKey` entry in the registry. */
  apiKey(provider: Provider): Promise<ApiKeyState>;
  /** Pass null to remove the stored key. */
  setApiKey(provider: Provider, key: string | null): Promise<ApiKeyState>;
}

export const settingsMethods = {
  get: 'invoke',
  set: 'invoke',
  detect: 'invoke',
  accounts: 'invoke',
  addAccount: 'invoke',
  renameAccount: 'invoke',
  removeAccount: 'invoke',
  linkAccount: 'invoke',
  apiKey: 'invoke',
  setApiKey: 'invoke',
} satisfies Manifest<SettingsHost>;

export const DEFAULT_SETTINGS: AgentSettings = {
  concurrency: 6,
  harnesses: Object.fromEntries(HARNESS_IDS.map((id) => [id, { path: '', model: HARNESSES[id].defaultModel }])) as AgentSettings['harnesses'],
  worktreeRoot: '',
  shell: '',
  prDrafts: false,
  sideChatModel: 'claude-sonnet-5-5',
};

/** Deep enough for this shape: harness entries merge field by field, so a patch never drops a sibling field. */
export function mergeSettings(base: AgentSettings, patch: AgentSettingsPatch): AgentSettings {
  const harnesses = { ...base.harnesses };
  for (const id of HARNESS_IDS) if (patch.harnesses?.[id]) harnesses[id] = { ...harnesses[id], ...patch.harnesses[id] };
  const { harnesses: _, ...rest } = patch;
  return { ...base, ...rest, harnesses };
}

export const CONCURRENCY_RANGE = { min: 1, max: 16 } as const;
