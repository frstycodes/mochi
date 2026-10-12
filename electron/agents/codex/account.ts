/** One Codex login, kept in its own config directory; `configDir` unset is the user's default `~/.codex`. */
export interface CodexAccount {
  id: string;
  configDir?: string;
}

export type AccountFor = (spaceId: string, provider: 'codex') => Promise<CodexAccount>;

// GAP: `accountFor` from `electron/agents/config.ts` (session `settings`) replaces this once it lands; until then every
// profile runs on the default install's login.
export const accountFor: AccountFor = async () => ({ id: 'default' });

/** `codex` reads its login, config and thread rollouts from `CODEX_HOME` (verified: an empty one reports logged out). */
export function accountEnv(account: CodexAccount, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return account.configDir ? { ...env, CODEX_HOME: account.configDir } : env;
}
