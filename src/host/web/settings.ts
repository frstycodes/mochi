import { DEFAULT_SETTINGS, type AgentSettings, type SettingsHost } from '../types/settings.ts';

// The web build has no processes to detect or keychain to store in; the Settings view explains that instead of calling these.
let current: AgentSettings = { ...DEFAULT_SETTINGS };

export const settings: SettingsHost = {
  async get() {
    return current;
  },
  async set(patch) {
    current = { ...current, ...patch };
    return current;
  },
  async detect(provider) {
    return { provider, path: null, version: null, login: { state: 'unknown', reason: 'Needs the desktop app' } };
  },
  async apiKey() {
    return { isSet: false, canStore: false };
  },
  async setApiKey() {
    throw new Error('Storing an API key needs the desktop app');
  },
};
