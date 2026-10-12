/** One Claude Code login, kept in its own config directory; `configDir` unset is the user's default `~/.claude`. */
export interface ClaudeAccount {
  id: string;
  configDir?: string;
}

export type AccountFor = (spaceId: string, provider: 'claude') => Promise<ClaudeAccount>;

export const accountFor: AccountFor = async (spaceId, provider) => {
  // Imported lazily: config.ts loads Electron, which the adapters' node tests don't have.
  const { account, configDir } = await (await import('../config.ts')).accountFor(spaceId, provider);
  return { id: account.id, configDir: configDir ?? undefined };
};

/** The child environment for an account, or none for the default one (the SDK then inherits `process.env` as is). */
export function accountEnv(account: ClaudeAccount): Record<string, string | undefined> | undefined {
  // `env` replaces the child environment, so PATH, HOME and the rest must be spread in.
  return account.configDir ? { ...process.env, CLAUDE_CONFIG_DIR: account.configDir } : undefined;
}
