import type { SettingsHost } from '../../src/host/types/settings.ts';
import { HARNESSES } from '../../src/settings/harnesses.ts';
import {
  applyConfig,
  previewConfig,
  readProfileConfig,
  testMcpServer,
} from '@mochi/core/agents/profileConfig';
import {
  copyProfileFolder,
  profileFolder,
  readProfileInstructions,
  setAccountInstructionsUsed,
  writeProfileInstructions,
} from '@mochi/core/agents/profileFolder';
import {
  accountsState,
  addAccount,
  agentSettings,
  apiKeyState,
  linkAccount,
  removeAccount,
  renameAccount,
  setApiKey,
  updateAgentSettings,
} from '@mochi/core/agents/config';
import { detect, latestVersion, updateHarness } from '../settings/detect.ts';
import { noteLogin } from '../agents/events.ts';
import { isNewerVersion } from '../../src/settings/parse.ts';
import type { Handlers } from './handlers.ts';

export const settings = {
  async get() {
    return agentSettings();
  },
  async set(_sender, patch) {
    return updateAgentSettings(patch);
  },
  async detect(_sender, accountId) {
    const account = accountsState().accounts.find((a) => a.id === accountId);
    if (!account) throw new Error('No such account');
    const install = await detect(account);
    noteLogin(account.id, install.login);
    return install;
  },
  async latestVersion(_sender, provider) {
    return latestVersion(provider);
  },
  async updateHarness(_sender, provider) {
    await updateHarness(provider);
    const account = accountsState().accounts.find(
      (a) => a.provider === provider && !a.configDir,
    )!;
    const install = await detect(account);
    const latest = await latestVersion(provider);
    if (isNewerVersion(latest, install.version))
      throw new Error(
        `Update finished, but Mochi still finds ${HARNESSES[provider].name} ${install.version ?? 'at an unknown version'} at ${install.path ?? 'the configured path'}. Check that this is the executable your package manager updated.`,
      );
    return install;
  },
  async accounts() {
    return accountsState();
  },
  async addAccount(_sender, provider, name) {
    return addAccount(provider, name);
  },
  async renameAccount(_sender, id, name) {
    return renameAccount(id, name);
  },
  async removeAccount(_sender, id) {
    return removeAccount(id);
  },
  async linkAccount(_sender, spaceId, provider, id) {
    return linkAccount(spaceId, provider, id);
  },
  async apiKey(_sender, provider) {
    return apiKeyState(provider);
  },
  async setApiKey(_sender, provider, key) {
    setApiKey(provider, key);
    return apiKeyState(provider);
  },
  async profileFolder(_sender, spaceId) {
    return profileFolder(spaceId);
  },
  async readInstructions(_sender, spaceId, name) {
    return readProfileInstructions(spaceId, name);
  },
  async writeInstructions(_sender, spaceId, name, text) {
    await writeProfileInstructions(spaceId, name, text);
  },
  async setAccountInstructions(_sender, spaceId, provider, isUsed) {
    await setAccountInstructionsUsed(spaceId, provider, isUsed);
  },
  async copyProfileFolder(_sender, fromId, toId) {
    await copyProfileFolder(fromId, toId);
  },
  async agentConfig(_sender, spaceId, projectRoot) {
    return readProfileConfig(spaceId, projectRoot || undefined);
  },
  async previewConfig(_sender, spaceId, changes) {
    return previewConfig(spaceId, changes);
  },
  async applyConfig(_sender, spaceId, changes, befores) {
    return applyConfig(spaceId, changes, befores);
  },
  async testMcp(_sender, spaceId, provider, name) {
    return testMcpServer(spaceId, provider, name);
  },
} satisfies Handlers<SettingsHost>;
