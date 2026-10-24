/** One Codex login, kept in its own config directory; `configDir` unset is the user's default `~/.codex`. */
export interface CodexAccount {
  id: string;
  configDir?: string;
}

export type AccountFor = (spaceId: string, provider: 'codex') => Promise<CodexAccount>;

export const accountFor: AccountFor = async (spaceId, provider) => {
  // Imported lazily: config.ts loads Electron, which the adapters' node tests don't have.
  const { account, configDir } = await (await import('../config.ts')).accountFor(spaceId, provider);
  return { id: account.id, configDir: configDir ?? undefined };
};

/** `codex` reads its login, config and thread rollouts from `CODEX_HOME` (verified: an empty one reports logged out). */
export function accountEnv(account: CodexAccount, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return account.configDir ? { ...env, CODEX_HOME: account.configDir } : env;
}

export interface CodexInstall {
  path: string;
  /** Spawn env: Harness's own plus the login shell's PATH, since npm installs of `codex` are `#!/usr/bin/env node` scripts. */
  env: NodeJS.ProcessEnv;
}

export type FindCodex = () => Promise<CodexInstall | null>;

/** The settings' path override, else the first `codex` on the user's login-shell PATH. */
export const findCodex: FindCodex = async () => {
  const { resolveExecutable, userPath } = await import('../config.ts');
  const path = await resolveExecutable('codex');
  return path ? { path, env: { ...process.env, PATH: await userPath() } } : null;
};
