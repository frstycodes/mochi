import { DEFAULT_SETTINGS, mergeSettings, type AgentSettings, type SettingsHost } from '../types/settings.ts';
import { DEFAULT_ACCOUNTS } from '../../settings/accounts.ts';

// The web build has no processes to detect, folders to create or keychain to store in; the settings page explains that instead of calling these.
let current: AgentSettings = { ...DEFAULT_SETTINGS };
const desktopOnly = async (): Promise<never> => {
  throw new Error('Needs the desktop app');
};

export const settings: SettingsHost = {
  async get() {
    return current;
  },
  async set(patch) {
    current = mergeSettings(current, patch);
    return current;
  },
  async detect(accountId) {
    const provider = DEFAULT_ACCOUNTS.find((a) => a.id === accountId)?.provider ?? 'claude';
    return { provider, accountId, path: null, version: null, login: { state: 'unknown', reason: 'Needs the desktop app' } };
  },
  async accounts() {
    return { accounts: DEFAULT_ACCOUNTS, links: {} };
  },
  addAccount: desktopOnly,
  renameAccount: desktopOnly,
  removeAccount: desktopOnly,
  linkAccount: desktopOnly,
  async apiKey() {
    return { isSet: false, canStore: false };
  },
  setApiKey: desktopOnly,
};
