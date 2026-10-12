import type { AgentLogin } from '../../src/host/types/settings.ts';
import type { AgentModel } from '../../src/host/types/agent.ts';
import type { Provider } from '../../src/model.ts';
import { CLAUDE_FALLBACK_MODELS } from '../../src/runtime/models.ts';
import { claudeModels } from './claude/map.ts';
import { claudeSupportedModels } from './claude/oneshot.ts';
import type { CodexAdapter } from './codex/adapter.ts';
import { accountFor } from './config.ts';

/** Per account: its model list, and the login it was read under. A failed read isn't kept, so the next call tries again. */
const cache = new Map<string, Promise<AgentModel[]>>();
const logins = new Map<string, string>();

/** The models `provider` offers the profile's account. Claude falls back to a built-in list; a Codex failure throws. */
export async function models(codex: CodexAdapter, provider: Provider, spaceId: string): Promise<AgentModel[]> {
  const { account } = await accountFor(spaceId, provider);
  let list = cache.get(account.id);
  if (!list) {
    list = provider === 'claude' ? claudeSupportedModels(spaceId).then(claudeModels) : codex.models(spaceId);
    cache.set(account.id, list);
    list.catch(() => cache.get(account.id) === list && cache.delete(account.id));
  }
  if (provider === 'codex') return list;
  return list.catch((error: unknown) => {
    console.warn('Claude supportedModels() failed, using the built-in list', error);
    return CLAUDE_FALLBACK_MODELS;
  });
}

/** Detection saw this account's login: a different one than before (signed in, out, or into another plan) drops its list. */
export function noteLogin(accountId: string, login: AgentLogin) {
  const key = JSON.stringify(login);
  if (logins.get(accountId) !== key) cache.delete(accountId);
  logins.set(accountId, key);
}
