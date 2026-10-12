import type { Provider } from '../../model.ts';
import type { Manifest } from './manifest.ts';

/** What the user's own install reports. Never carries credentials, emails or key material: only method and plan names. */
export interface AgentInstall {
  provider: Provider;
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

/** Empty strings mean "not set": find the executable on the user's PATH, let the tool pick its model. */
export interface AgentSettings {
  claudePath: string;
  codexPath: string;
  concurrency: number;
  claudeModel: string;
  codexModel: string;
}

/** The renderer only ever learns whether a key is stored and its last four characters. */
export interface ApiKeyState {
  isSet: boolean;
  last4?: string;
  /** False when the OS keychain isn't available, so a key can't be stored safely. */
  canStore: boolean;
}

export interface SettingsHost {
  get(): Promise<AgentSettings>;
  set(patch: Partial<AgentSettings>): Promise<AgentSettings>;
  detect(provider: Provider): Promise<AgentInstall>;
  apiKey(): Promise<ApiKeyState>;
  /** Pass null to remove the stored key. */
  setApiKey(key: string | null): Promise<ApiKeyState>;
}

export const settingsMethods = {
  get: 'invoke',
  set: 'invoke',
  detect: 'invoke',
  apiKey: 'invoke',
  setApiKey: 'invoke',
} satisfies Manifest<SettingsHost>;

export const DEFAULT_SETTINGS = {
  claudePath: '',
  codexPath: '',
  concurrency: 6,
  claudeModel: 'claude-opus-5-5',
  codexModel: '',
} satisfies AgentSettings;

export const CONCURRENCY_RANGE = { min: 1, max: 16 } as const;
