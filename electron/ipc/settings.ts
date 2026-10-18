import { isAbsolute } from 'node:path';
import { CONCURRENCY_RANGE, type AgentSettingsPatch, type HarnessSettings, type SettingsHost } from '../../src/host/types/settings.ts';
import type { Provider } from '../../src/model.ts';
import { HARNESS_IDS, HARNESSES } from '../../src/settings/harnesses.ts';
import { fromClaude, SERVER_NAME, type ConfigChange, type ConfigPart } from '../../src/settings/agentConfig.ts';
import { APP_ICONS, type AppIcon } from '../../src/settings/settingOptions.ts';
import { UTILITY_TASKS, type UtilityTask } from '../../src/utility/prompts.ts';
import { applyConfig, previewConfig, readProfileConfig, testMcpServer } from '../agents/profileConfig.ts';
import { accountsState, addAccount, agentSettings, apiKeyState, linkAccount, removeAccount, renameAccount, setApiKey, updateAgentSettings } from '../agents/config.ts';
import { detect } from '../settings/detect.ts';
import { noteLogin } from '../agents/models.ts';
import { integer, MAX_MODEL_CHARS, record, string, type Handlers } from './handlers.ts';

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
    const install = await detect(account);
    noteLogin(account.id, install.login);
    return install;
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
  async agentConfig(_sender, spaceId, projectRoot) {
    return readProfileConfig(string(spaceId, 'spaceId', 128), projectRoot === undefined ? undefined : absolutePath(projectRoot, 'projectRoot') || undefined);
  },
  async previewConfig(_sender, spaceId, changes) {
    return previewConfig(string(spaceId, 'spaceId', 128), validChanges(changes));
  },
  async applyConfig(_sender, spaceId, changes, befores) {
    const paths = record(befores, 'befores');
    for (const [path, text] of Object.entries(paths)) string(text, `befores.${path}`, MAX_CONFIG_CHARS);
    return applyConfig(string(spaceId, 'spaceId', 128), validChanges(changes), paths as Record<string, string>);
  },
  async testMcp(_sender, spaceId, provider, name) {
    return testMcpServer(string(spaceId, 'spaceId', 128), validProvider(provider), string(name, 'name', 64));
  },
} satisfies Handlers<SettingsHost>;

// Large enough for the default account's `.claude.json`, which also holds Claude Code's per-project history.
const MAX_CONFIG_CHARS = 8 * 1024 * 1024;
const PARTS: ConfigPart[] = ['instructions', 'mcp', 'skills'];

function validChanges(value: unknown): ConfigChange[] {
  if (!Array.isArray(value) || value.length > 20) throw new TypeError('changes must be a list of up to 20');
  return value.map((v, n): ConfigChange => {
    const c = record(v, `changes[${n}]`);
    const provider = validProvider(c.provider);
    switch (c.kind) {
      case 'instructions':
        return { kind: 'instructions', provider, text: string(c.text, 'text', 256 * 1024) };
      case 'mcp-set': {
        const raw = record(c.server, 'server');
        const server = fromClaude(serverName(raw.name), raw);
        if (server.type === 'stdio' ? !server.command : !server.url) throw new TypeError(`${server.name} needs a ${server.type === 'stdio' ? 'command' : 'url'}`);
        return { kind: 'mcp-set', provider, server };
      }
      case 'mcp-remove':
        return { kind: 'mcp-remove', provider, name: serverName(c.name) };
      case 'mcp-enabled':
      case 'skill-enabled':
        if (typeof c.enabled !== 'boolean') throw new TypeError('enabled must be true or false');
        return { kind: c.kind, provider, name: c.kind === 'mcp-enabled' ? serverName(c.name) : string(c.name, 'name', 128), enabled: c.enabled };
      case 'skill-import':
        return { kind: 'skill-import', provider, folder: absolutePath(c.folder, 'folder') };
      case 'import': {
        const from = record(c.from, 'from');
        const parts = Array.isArray(c.parts) ? c.parts.filter((p): p is ConfigPart => PARTS.includes(p as ConfigPart)) : [];
        return { kind: 'import', provider, from: { spaceId: string(from.spaceId, 'from.spaceId', 128), provider: validProvider(from.provider) }, parts };
      }
      default:
        throw new TypeError(`Unknown change ${String(c.kind)}`);
    }
  });
}

function serverName(value: unknown) {
  const name = string(value, 'name', 64);
  if (!SERVER_NAME.test(name)) throw new TypeError('Server names use letters, digits, - _ or .');
  return name;
}

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

/** Empty (use the default), absolute, or under `~/`. */
function absolutePath(value: unknown, name: string) {
  const path = string(value, name).trim();
  if (path && !isAbsolute(path) && path !== '~' && !path.startsWith('~/')) throw new TypeError('The path must be absolute or start with ~/');
  return path;
}

function validPatch(p: Record<string, unknown>): AgentSettingsPatch {
  const patch: AgentSettingsPatch = {};
  if (p.concurrency !== undefined) patch.concurrency = integer(p.concurrency, 'concurrency', CONCURRENCY_RANGE.min, CONCURRENCY_RANGE.max);
  if (p.worktreeRoot !== undefined) patch.worktreeRoot = absolutePath(p.worktreeRoot, 'worktreeRoot');
  if (p.shell !== undefined) patch.shell = absolutePath(p.shell, 'shell');
  if (p.prDrafts !== undefined) {
    if (typeof p.prDrafts !== 'boolean') throw new TypeError('prDrafts must be true or false');
    patch.prDrafts = p.prDrafts;
  }
  if (p.prepareWorktrees !== undefined) {
    if (typeof p.prepareWorktrees !== 'boolean') throw new TypeError('prepareWorktrees must be true or false');
    patch.prepareWorktrees = p.prepareWorktrees;
  }
  if (p.appIcon !== undefined) {
    if (!APP_ICONS.some((icon) => icon.value === p.appIcon)) throw new TypeError(`appIcon must be one of ${APP_ICONS.map((icon) => icon.value).join(', ')}`);
    patch.appIcon = p.appIcon as AppIcon;
  }
  if (p.worktreeInclude !== undefined) patch.worktreeInclude = string(p.worktreeInclude, 'worktreeInclude', 4096);
  if (p.setupCommands !== undefined) {
    patch.setupCommands = {};
    for (const [folder, command] of Object.entries(record(p.setupCommands, 'setupCommands'))) {
      const text = string(command, 'setup command', 4096).trim();
      if (text) patch.setupCommands[absolutePath(folder, 'project folder')] = text;
    }
  }
  if (p.sideChatModel !== undefined) {
    const side = record(p.sideChatModel, 'sideChatModel');
    const model = string(side.model, 'sideChatModel.model', MAX_MODEL_CHARS).trim();
    if (!model) throw new TypeError('Pick a side chat model');
    patch.sideChatModel = { provider: validProvider(side.provider as string), model };
  }
  if (p.utilityModels !== undefined) {
    patch.utilityModels = {};
    for (const [task, value] of Object.entries(record(p.utilityModels, 'utilityModels'))) {
      if (!(UTILITY_TASKS as readonly string[]).includes(task)) throw new TypeError(`utilityModels.${task} is not a background task`);
      const choice = record(value, `utilityModels.${task}`);
      const model = string(choice.model, `utilityModels.${task}.model`, MAX_MODEL_CHARS).trim();
      if (!model) throw new TypeError('Pick a model');
      patch.utilityModels[task as UtilityTask] = { provider: validProvider(choice.provider as string), model };
    }
  }
  if (p.harnesses === undefined) return patch;
  patch.harnesses = {};
  for (const [id, value] of Object.entries(record(p.harnesses, 'harnesses'))) {
    const h = record(value, `harnesses.${validProvider(id)}`);
    const next: Partial<HarnessSettings> = {};
    if (h.path !== undefined) {
      next.path = string(h.path, 'path').trim();
      if (next.path && !isAbsolute(next.path)) throw new TypeError('The path must be absolute');
    }
    if (h.model !== undefined) next.model = string(h.model, 'model', MAX_MODEL_CHARS).trim();
    if (h.secondOpinionModel !== undefined) next.secondOpinionModel = string(h.secondOpinionModel, 'secondOpinionModel', MAX_MODEL_CHARS).trim();
    patch.harnesses[id as Provider] = next;
  }
  return patch;
}
