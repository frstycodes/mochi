/** One Claude Code login, kept in its own config directory; `configDir` unset is the user's default `~/.claude`. */
export interface ClaudeAccount {
  id: string;
  configDir?: string;
}

export type AccountFor = (spaceId: string, provider: 'claude') => Promise<ClaudeAccount>;

// GAP: `accountFor` from `electron/agents/config.ts` (session `settings`) replaces this once it lands; until then every
// profile runs on the default install's login.
export const accountFor: AccountFor = async () => ({ id: 'default' });

/** The child environment for an account, or none for the default one (the SDK then inherits `process.env` as is). */
export function accountEnv(account: ClaudeAccount): Record<string, string | undefined> | undefined {
  // `env` replaces the child environment, so PATH, HOME and the rest must be spread in.
  return account.configDir ? { ...process.env, CLAUDE_CONFIG_DIR: account.configDir } : undefined;
}
