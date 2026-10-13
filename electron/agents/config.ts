import { app, safeStorage } from 'electron';
import { access, constants } from 'node:fs/promises';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { DEFAULT_SETTINGS, mergeSettings, migrateSettings, type Account, type AccountId, type AccountsState, type AgentSettings, type AgentSettingsPatch, type ApiKeyState } from '../../src/host/types/settings.ts';
import type { Provider } from '../../src/model.ts';
import { DEFAULT_ACCOUNTS, linkedAccountId, newAccountId } from '../../src/settings/accounts.ts';
import { HARNESSES } from '../../src/settings/harnesses.ts';
import { userPath } from '../shellPath.ts';

export { userPath };

/**
 * Agent settings shared by the settings UI and the harness adapters. Main process only.
 * Adapters read through the getters; only `electron/ipc/settings.ts` writes.
 */

interface Stored extends AgentSettings, AccountsState {
  /** `safeStorage` ciphertext, base64, per harness. Decrypted only by `apiKeyFor()`, never written in clear or sent to the renderer. */
  apiKeys: Partial<Record<Provider, string>>;
  /** Folders used as the worktree root before the current one: their worktrees stay Mochi's for checkpoints, rewind and cleanup. */
  pastWorktreeRoots: string[];
}

const DEFAULT_WORKTREE_ROOT = join(homedir(), '.harness', 'worktrees');

const listeners = new Set<(settings: AgentSettings) => void>();
let stored: Stored | undefined;

export function agentSettings(): AgentSettings {
  const { concurrency, harnesses, worktreeRoot, shell, prDrafts, sideChatModel } = load();
  return { concurrency, harnesses, worktreeRoot, shell, prDrafts, sideChatModel };
}

/** Where new thread worktrees go: the user's folder (`~` expanded), else `~/.harness/worktrees`. */
export function worktreeRoot(): string {
  const root = expandHome(load().worktreeRoot);
  return root ? resolve(root) : DEFAULT_WORKTREE_ROOT;
}

/** The current root first, then every earlier one, so moving the folder never orphans existing worktrees. */
export function worktreeRoots(): string[] {
  return [...new Set([worktreeRoot(), ...load().pastWorktreeRoots, DEFAULT_WORKTREE_ROOT])];
}

/** The terminal's shell: the user's choice, else `$SHELL`. */
export function terminalShell(): string {
  return expandHome(load().shell) || process.env.SHELL || '/bin/zsh';
}

export function prDrafts(): boolean {
  return load().prDrafts;
}

function expandHome(path: string) {
  return path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path;
}

export function accountsState(): AccountsState {
  const { accounts, links } = load();
  return { accounts, links };
}

/**
 * The account a profile (space) runs a provider on, and how to start that tool for it. Every thread of the profile uses
 * exactly this account: nothing picks another account of the same provider (RUNTIME.md, Auth).
 */
export async function accountFor(spaceId: string, provider: Provider): Promise<{ account: Account; configDir: string | null; executable: string | null }> {
  const { accounts, links } = load();
  const id = linkedAccountId(links, spaceId, provider);
  const account = accounts.find((a) => a.id === id) ?? DEFAULT_ACCOUNTS.find((a) => a.provider === provider)!;
  return { account, configDir: account.configDir, executable: await resolveExecutable(provider) };
}

export function concurrencyCap(): number {
  return load().concurrency;
}

/** undefined → let the harness use its own configured default. */
export function defaultModel(provider: Provider): string | undefined {
  return load().harnesses[provider].model || undefined;
}

/** The model a harness gives second opinions on: its own setting, else its default thread model, else undefined (the harness picks). */
export function secondOpinionModel(provider: Provider): string | undefined {
  return load().harnesses[provider].secondOpinionModel || defaultModel(provider);
}

/** The key the user stored for this harness, or undefined. Only ever set as the harness's own variable in its child env (see `agentEnv`). */
export function apiKeyFor(provider: Provider): string | undefined {
  const cipher = load().apiKeys[provider];
  if (!cipher || !safeStorage.isEncryptionAvailable()) return undefined;
  return safeStorage.decryptString(Buffer.from(cipher, 'base64'));
}

/** The user's override, else the first matching executable on the user's login-shell PATH; null when neither exists. */
export async function resolveExecutable(provider: Provider): Promise<string | null> {
  const override = load().harnesses[provider].path;
  if (override) return override;
  const { executable } = HARNESSES[provider];
  const names = process.platform === 'win32' ? [`${executable}.exe`, `${executable}.cmd`] : [executable];
  for (const dir of (await userPath()).split(delimiter))
    for (const name of names) if (await isExecutable(join(dir, name))) return join(dir, name);
  return null;
}

/**
 * Environment for a harness child of this profile: the full `process.env` (replacing it would drop the tools' own
 * credentials), the user's login-shell PATH (apps opened from Finder get a bare PATH, and `codex` is a node script that
 * needs `node`), the profile's account folder (`CLAUDE_CONFIG_DIR` / `CODEX_HOME`), and the harness's API key variable
 * (`ANTHROPIC_API_KEY`) only when the user stored one in Harness, which bills the API whatever account is signed in.
 */
export async function agentEnv(provider: Provider, spaceId: string): Promise<NodeJS.ProcessEnv> {
  const { configDir } = await accountFor(spaceId, provider);
  const keyEnv = HARNESSES[provider].apiKey?.env;
  const key = keyEnv && apiKeyFor(provider);
  return { ...accountEnv(provider, configDir), PATH: await userPath(), ...(keyEnv && key && { [keyEnv]: key }) };
}

/** `process.env` pointed at an account's folder; an inherited folder variable is dropped for the default account. */
export function accountEnv(provider: Provider, configDir: string | null): NodeJS.ProcessEnv {
  const variable = HARNESSES[provider].configDirEnv;
  const { [variable]: _, ...env } = process.env;
  return configDir ? { ...env, [variable]: configDir } : env;
}

export function onAgentSettingsChange(listener: (settings: AgentSettings) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function updateAgentSettings(patch: AgentSettingsPatch): AgentSettings {
  const previousRoot = worktreeRoot();
  const next = { ...load(), ...mergeSettings(load(), patch) };
  save({ ...next, pastWorktreeRoots: [...new Set([previousRoot, ...next.pastWorktreeRoots])] });
  return agentSettings();
}

export function addAccount(provider: Provider, name: string): AccountsState {
  const stored = load();
  const id = newAccountId(provider, name, stored.accounts.map((a) => a.id));
  const configDir = join(homedir(), '.harness', 'accounts', id);
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  save({ ...stored, accounts: [...stored.accounts, { id, provider, name, configDir }] });
  return accountsState();
}

export function renameAccount(id: AccountId, name: string): AccountsState {
  const stored = load();
  if (!stored.accounts.some((a) => a.id === id)) throw new Error('No such account');
  save({ ...stored, accounts: stored.accounts.map((a) => (a.id === id ? { ...a, name } : a)) });
  return accountsState();
}

export function removeAccount(id: AccountId): AccountsState {
  const stored = load();
  if (DEFAULT_ACCOUNTS.some((a) => a.id === id)) throw new Error('The default account cannot be removed');
  if (Object.values(stored.links).some((l) => Object.values(l).includes(id))) throw new Error('A profile still uses this account. Link that profile to another account first');
  save({ ...stored, accounts: stored.accounts.filter((a) => a.id !== id) });
  return accountsState();
}

export function linkAccount(spaceId: string, provider: Provider, id: AccountId): AccountsState {
  const stored = load();
  if (stored.accounts.find((a) => a.id === id)?.provider !== provider) throw new Error(`No ${provider} account ${id}`);
  save({ ...stored, links: { ...stored.links, [spaceId]: { ...stored.links[spaceId], [provider]: id } } });
  return accountsState();
}

export function apiKeyState(provider: Provider): ApiKeyState {
  const key = apiKeyFor(provider);
  return { isSet: !!key, last4: key?.slice(-4), canStore: safeStorage.isEncryptionAvailable() };
}

export function setApiKey(provider: Provider, key: string | null) {
  if (key !== null && !safeStorage.isEncryptionAvailable()) throw new Error('The OS keychain is not available, so the key cannot be stored safely');
  const { [provider]: _, ...apiKeys } = load().apiKeys;
  save({ ...load(), apiKeys: key === null ? apiKeys : { ...apiKeys, [provider]: safeStorage.encryptString(key).toString('base64') } });
}

function load(): Stored {
  if (stored) return stored;
  let saved: Partial<Stored> = {};
  try {
    saved = migrateSettings(JSON.parse(readFileSync(file(), 'utf8'))) as Partial<Stored>;
  } catch {}
  // Merged per harness, so a harness added to the registry later gets its defaults; default accounts always exist.
  const settings = mergeSettings(DEFAULT_SETTINGS, saved);
  const accounts = [...DEFAULT_ACCOUNTS.filter((d) => !saved.accounts?.some((a) => a.id === d.id)), ...(saved.accounts ?? [])];
  stored = { ...settings, accounts, links: saved.links ?? {}, apiKeys: saved.apiKeys ?? {}, pastWorktreeRoots: saved.pastWorktreeRoots ?? [] };
  return stored;
}

function save(next: Stored) {
  stored = next;
  writeFileSync(file(), JSON.stringify(next, null, 2), { mode: 0o600 });
  const settings = agentSettings();
  for (const listener of listeners) listener(settings);
}

function file() {
  return join(app.getPath('userData'), 'agent-settings.json');
}

async function isExecutable(path: string) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
