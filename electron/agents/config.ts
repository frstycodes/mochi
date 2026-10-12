import { app, safeStorage } from 'electron';
import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { DEFAULT_SETTINGS, type AgentSettings, type ApiKeyState } from '../../src/host/types/settings.ts';
import type { Provider } from '../../src/model.ts';

/**
 * Agent settings shared by the settings UI and the Claude / Codex adapters. Main process only.
 * Adapters read through the getters; only `electron/ipc/settings.ts` writes.
 */

interface Stored extends AgentSettings {
  /** `safeStorage` ciphertext, base64. Decrypted only by `anthropicApiKey()`, never written in clear or sent to the renderer. */
  apiKey?: string;
}

const EXECUTABLES = { claude: 'claude', codex: 'codex' } satisfies Record<Provider, string>;
const listeners = new Set<(settings: AgentSettings) => void>();
let stored: Stored | undefined;

export function agentSettings(): AgentSettings {
  const { apiKey: _, ...settings } = load();
  return settings;
}

export function concurrencyCap(): number {
  return load().concurrency;
}

/** undefined → let the tool use its own configured default. */
export function defaultModel(provider: Provider): string | undefined {
  return (provider === 'claude' ? load().claudeModel : load().codexModel) || undefined;
}

/** The key the user chose to store in Harness, or undefined. Set it only as `ANTHROPIC_API_KEY` in a Claude child's env (see `agentEnv`). */
export function anthropicApiKey(): string | undefined {
  const { apiKey } = load();
  if (!apiKey || !safeStorage.isEncryptionAvailable()) return undefined;
  return safeStorage.decryptString(Buffer.from(apiKey, 'base64'));
}

/** The user's override, else the first `claude` / `codex` on the user's login-shell PATH; null when neither exists. */
export async function resolveExecutable(provider: Provider): Promise<string | null> {
  const override = provider === 'claude' ? load().claudePath : load().codexPath;
  if (override) return override;
  const names = process.platform === 'win32' ? [`${EXECUTABLES[provider]}.exe`, `${EXECUTABLES[provider]}.cmd`] : [EXECUTABLES[provider]];
  for (const dir of (await userPath()).split(delimiter))
    for (const name of names) if (await isExecutable(join(dir, name))) return join(dir, name);
  return null;
}

/**
 * Environment for a Claude or Codex child: the full `process.env` (replacing it would drop the tools' own credentials),
 * the user's login-shell PATH (apps opened from Finder get a bare PATH, and `codex` is a node script that needs `node`),
 * and `ANTHROPIC_API_KEY` for Claude only when the user stored one in Harness, which makes Claude Code bill the API.
 */
export async function agentEnv(provider: Provider): Promise<NodeJS.ProcessEnv> {
  const key = provider === 'claude' ? anthropicApiKey() : undefined;
  return { ...process.env, PATH: await userPath(), ...(key && { ANTHROPIC_API_KEY: key }) };
}

export function onAgentSettingsChange(listener: (settings: AgentSettings) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function updateAgentSettings(patch: Partial<AgentSettings>): AgentSettings {
  save({ ...load(), ...patch });
  return agentSettings();
}

export function apiKeyState(): ApiKeyState {
  const key = anthropicApiKey();
  return { isSet: !!key, last4: key?.slice(-4), canStore: safeStorage.isEncryptionAvailable() };
}

export function setAnthropicApiKey(key: string | null) {
  if (key !== null && !safeStorage.isEncryptionAvailable()) throw new Error('The OS keychain is not available, so the key cannot be stored safely');
  const { apiKey: _, ...rest } = load();
  save(key === null ? rest : { ...rest, apiKey: safeStorage.encryptString(key).toString('base64') });
}

let pathLookup: Promise<string> | undefined;

/** Memoized for the app's lifetime: a PATH change in the user's shell needs a Harness restart. */
export function userPath(): Promise<string> {
  pathLookup ??= readLoginShellPath().catch(() => process.env.PATH ?? '');
  return pathLookup;
}

// An interactive login shell, because version managers (mise, nvm) usually activate in .zshrc, not .zprofile.
// The command is a constant; markers cut away whatever the rc files print.
function readLoginShellPath(): Promise<string> {
  if (process.platform === 'win32') return Promise.resolve(process.env.PATH ?? '');
  const shell = process.env.SHELL || '/bin/zsh';
  return new Promise((resolve, reject) =>
    execFile(shell, ['-ilc', 'printf "__HARNESS_PATH__%s__HARNESS_PATH__" "$PATH"'], { timeout: 5000 }, (error, stdout) => {
      const path = stdout.match(/__HARNESS_PATH__(.*)__HARNESS_PATH__/)?.[1];
      if (path) resolve(path);
      else reject(error ?? new Error('login shell printed no PATH'));
    }),
  );
}

function load(): Stored {
  if (stored) return stored;
  try {
    stored = { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(file(), 'utf8')) };
  } catch {
    stored = { ...DEFAULT_SETTINGS };
  }
  return stored!;
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
