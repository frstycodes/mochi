import { isAbsolute } from 'node:path';
import { CONCURRENCY_RANGE, type AgentSettings, type SettingsHost } from '../../src/host/types/settings.ts';
import { agentSettings, apiKeyState, setAnthropicApiKey, updateAgentSettings } from '../agents/config.ts';
import { detect } from '../settings/detect.ts';
import { integer, record, string, type Handlers } from './handlers.ts';

const PROVIDERS = ['claude', 'codex'];

export const settings = {
  async get() {
    return agentSettings();
  },
  async set(_sender, patch) {
    return updateAgentSettings(validPatch(record(patch, 'patch')));
  },
  async detect(_sender, provider) {
    if (!PROVIDERS.includes(provider as string)) throw new TypeError('provider must be claude or codex');
    return detect(provider as 'claude' | 'codex');
  },
  async apiKey() {
    return apiKeyState();
  },
  // Errors here must never echo the key: messages name the field, not its value.
  async setApiKey(_sender, key) {
    if (key === null) setAnthropicApiKey(null);
    else {
      const trimmed = string(key, 'key', 512).trim();
      if (!/^[\w-]{20,}$/.test(trimmed)) throw new TypeError('That does not look like an Anthropic API key');
      setAnthropicApiKey(trimmed);
    }
    return apiKeyState();
  },
} satisfies Handlers<SettingsHost>;

function validPatch(p: Record<string, unknown>): Partial<AgentSettings> {
  const patch: Partial<AgentSettings> = {};
  for (const key of ['claudePath', 'codexPath'] as const) {
    if (p[key] === undefined) continue;
    const path = string(p[key], key).trim();
    if (path && !isAbsolute(path)) throw new TypeError(`${key} must be an absolute path`);
    patch[key] = path;
  }
  for (const key of ['claudeModel', 'codexModel'] as const) if (p[key] !== undefined) patch[key] = string(p[key], key, 128).trim();
  if (p.concurrency !== undefined) patch.concurrency = integer(p.concurrency, 'concurrency', CONCURRENCY_RANGE.min, CONCURRENCY_RANGE.max);
  return patch;
}
