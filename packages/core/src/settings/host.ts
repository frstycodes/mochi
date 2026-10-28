import type { SettingsHost } from '../../../../apps/desktop/src/host/types/settings.ts';
import { HARNESSES } from '../../../../apps/desktop/src/settings/harnesses.ts';
import { isNewerVersion } from '../../../../apps/desktop/src/settings/parse.ts';
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
} from '../agents/config.ts';
import { noteLogin } from '../agents/models.ts';
import {
  applyConfig,
  previewConfig,
  readProfileConfig,
  testMcpServer,
} from '../agents/profileConfig.ts';
import {
  copyProfileFolder,
  profileFolder,
  readProfileInstructions,
  setAccountInstructionsUsed,
  writeProfileInstructions,
} from '../agents/profileFolder.ts';
import type { HostMethods } from '../hostMethods.ts';
import { detect, latestVersion, updateHarness } from './detect.ts';

/** Main keeps the font list: fonts belong to the screen showing Mochi, and listing them on macOS takes its Swift helper. */
export type InMain = 'systemFonts';

/** `host.settings`: the agent settings document in Core's store, accounts, harness detection and each profile's files. */
export const settingsHost = {
  async get() {
    return agentSettings();
  },
  async set(_caller, patch) {
    return updateAgentSettings(patch);
  },
  async detect(_caller, accountId) {
    const account = accountsState().accounts.find((a) => a.id === accountId);
    if (!account) throw new Error('No such account');
    const install = await detect(account);
    noteLogin(account.id, install.login);
    return install;
  },
  async latestVersion(_caller, provider) {
    return latestVersion(provider);
  },
  async updateHarness(_caller, provider) {
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
  async addAccount(_caller, provider, name) {
    return addAccount(provider, name);
  },
  async renameAccount(_caller, id, name) {
    return renameAccount(id, name);
  },
  async removeAccount(_caller, id) {
    return removeAccount(id);
  },
  async linkAccount(_caller, spaceId, provider, id) {
    return linkAccount(spaceId, provider, id);
  },
  async apiKey(_caller, provider) {
    return apiKeyState(provider);
  },
  async setApiKey(_caller, provider, key) {
    setApiKey(provider, key);
    return apiKeyState(provider);
  },
  async profileFolder(_caller, spaceId) {
    return profileFolder(spaceId);
  },
  async readInstructions(_caller, spaceId, name) {
    return readProfileInstructions(spaceId, name);
  },
  async writeInstructions(_caller, spaceId, name, text) {
    await writeProfileInstructions(spaceId, name, text);
  },
  async setAccountInstructions(_caller, spaceId, provider, isUsed) {
    await setAccountInstructionsUsed(spaceId, provider, isUsed);
  },
  async copyProfileFolder(_caller, fromId, toId) {
    await copyProfileFolder(fromId, toId);
  },
  async agentConfig(_caller, spaceId, projectRoot) {
    return readProfileConfig(spaceId, projectRoot || undefined);
  },
  async previewConfig(_caller, spaceId, changes) {
    return previewConfig(spaceId, changes);
  },
  async applyConfig(_caller, spaceId, changes, befores) {
    return applyConfig(spaceId, changes, befores);
  },
  async testMcp(_caller, spaceId, provider, name) {
    return testMcpServer(spaceId, provider, name);
  },
} satisfies HostMethods<Omit<SettingsHost, InMain>>;
