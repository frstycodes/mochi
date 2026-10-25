import type { AgentLogin } from '../../../../src/host/types/settings.ts';
import type { AgentModel } from '../../../../src/host/types/agent.ts';
import type { Provider } from '../../../../src/model.ts';
import { claudeModels } from './claude/map.ts';
import { claudeSupportedModels } from './claude/oneshot.ts';
import type { CodexAdapter } from './codex/adapter.ts';
import { cached, uncache } from '../../../../electron/cache.ts';
import { accountFor } from './config.ts';

// A failed read isn't kept, so the next call tries again.
const MODELS_TTL = '365 days';
const modelsKey = (accountId: string) => `models:${accountId}`;
/** Per account, the login its list was read under. */
const logins = new Map<string, string>();

/** The models `provider` offers the profile's account; throws when the harness can't list them, so the picker hides it. */
export async function models(
  codex: CodexAdapter,
  provider: Provider,
  spaceId: string,
): Promise<AgentModel[]> {
  const { account } = await accountFor(spaceId, provider);
  return cached(modelsKey(account.id), MODELS_TTL, () =>
    provider === 'claude'
      ? claudeSupportedModels(spaceId).then(claudeModels)
      : codex.models(spaceId),
  );
}

/** Detection saw this account's login: a different one than before (signed in, out, or into another plan) drops its list. */
export function noteLogin(accountId: string, login: AgentLogin) {
  const key = JSON.stringify(login);
  if (logins.get(accountId) !== key) void uncache(modelsKey(accountId));
  logins.set(accountId, key);
}
