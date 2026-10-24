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
