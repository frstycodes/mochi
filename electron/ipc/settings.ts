import { isAbsolute } from 'node:path';
import { CONCURRENCY_RANGE, type AgentSettingsPatch, type HarnessSettings, type SettingsHost } from '../../src/host/types/settings.ts';
import type { Provider } from '../../src/model.ts';
import { HARNESS_IDS, HARNESSES } from '../../src/settings/harnesses.ts';
import { accountsState, addAccount, agentSettings, apiKeyState, linkAccount, removeAccount, renameAccount, setApiKey, updateAgentSettings } from '../agents/config.ts';
import { detect } from '../settings/detect.ts';
import { integer, record, string, type Handlers } from './handlers.ts';

export const settings = {
  async get() {
    return agentSettings();
  },
  async set(_sender, patch) {
    return updateAgentSettings(validPatch(record(patch, 'patch')));
  },
  async detect(_sender, accountId) {
    const account = accountsState().accounts.find((a) => a.id === string(accountId, 'accountId', 128));
    if (!account) throw new Error('No such account');
    return detect(account);
  },
  async accounts() {
    return accountsState();
  },
  async addAccount(_sender, provider, name) {
    return addAccount(validProvider(provider), accountName(name));
  },
  async renameAccount(_sender, id, name) {
    return renameAccount(string(id, 'id', 128), accountName(name));
  },
  async removeAccount(_sender, id) {
    return removeAccount(string(id, 'id', 128));
  },
  async linkAccount(_sender, spaceId, provider, id) {
    return linkAccount(string(spaceId, 'spaceId', 128), validProvider(provider), string(id, 'id', 128));
  },
  async apiKey(_sender, provider) {
    return apiKeyState(keyedProvider(provider));
  },
  // Errors here must never echo the key: messages name the field, not its value.
  async setApiKey(_sender, provider, key) {
    const id = keyedProvider(provider);
    if (key === null) setApiKey(id, null);
    else {
      const trimmed = string(key, 'key', 512).trim();
      if (!/^[\w-]{20,}$/.test(trimmed)) throw new TypeError(`That does not look like an ${HARNESSES[id].apiKey!.label}`);
      setApiKey(id, trimmed);
    }
    return apiKeyState(id);
  },
} satisfies Handlers<SettingsHost>;

function validProvider(value: unknown): Provider {
  if (!HARNESS_IDS.includes(value as Provider)) throw new TypeError(`provider must be one of ${HARNESS_IDS.join(', ')}`);
  return value as Provider;
}

function keyedProvider(value: unknown): Provider {
  const id = validProvider(value);
  if (!HARNESSES[id].apiKey) throw new TypeError(`${HARNESSES[id].name} takes no API key`);
  return id;
}

function accountName(value: unknown) {
  const name = string(value, 'name', 64).trim();
  if (!name) throw new TypeError('Give the account a name');
  return name;
}

function validPatch(p: Record<string, unknown>): AgentSettingsPatch {
  const patch: AgentSettingsPatch = {};
  if (p.concurrency !== undefined) patch.concurrency = integer(p.concurrency, 'concurrency', CONCURRENCY_RANGE.min, CONCURRENCY_RANGE.max);
  if (p.harnesses === undefined) return patch;
  patch.harnesses = {};
  for (const [id, value] of Object.entries(record(p.harnesses, 'harnesses'))) {
    const h = record(value, `harnesses.${validProvider(id)}`);
    const next: Partial<HarnessSettings> = {};
    if (h.path !== undefined) {
      next.path = string(h.path, 'path').trim();
      if (next.path && !isAbsolute(next.path)) throw new TypeError('The path must be absolute');
    }
    if (h.model !== undefined) next.model = string(h.model, 'model', 128).trim();
    patch.harnesses[id as Provider] = next;
  }
  return patch;
}
