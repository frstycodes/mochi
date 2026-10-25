import { accountFor as accountOf } from '../config.ts';

/** One Claude Code login, kept in its own config directory; `configDir` unset is the user's default `~/.claude`. */
export interface ClaudeAccount {
  id: string;
  configDir?: string;
}

export type AccountFor = (
  spaceId: string,
  provider: 'claude',
) => Promise<ClaudeAccount>;

export const accountFor: AccountFor = async (spaceId, provider) => {
  const { account, configDir } = await accountOf(spaceId, provider);
  return { id: account.id, configDir: configDir ?? undefined };
};
