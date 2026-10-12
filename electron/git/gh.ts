import { homedir } from 'node:os';
import { parseGhAuthStatus } from '../../src/git/parse.ts';
import { run } from './run.ts';

// Tokens stay in the main process: read from gh's own store per login, handed to one gh child as GH_TOKEN, never sent to the renderer.
const tokens = new Map<string, string>();

/** gh's github.com logins. `gh auth status` exits 1 when any stored login is broken, and still prints them all. */
export async function ghAccounts() {
  return parseGhAuthStatus(await run('gh', homedir(), ['auth', 'status', '--hostname', 'github.com'], { okCodes: [0, 1], stderr: true }));
}

/** `gh <args>` as `user` (a profile's GitHub account), or as gh's active account when there is none. */
export async function runGh(cwd: string, args: string[], user: string | undefined, options: Omit<Parameters<typeof run>[3] & object, 'env'> = {}) {
  if (!user) return run('gh', cwd, args, options);
  try {
    return await run('gh', cwd, args, { ...options, env: { GH_TOKEN: await tokenFor(user) } });
  } catch (error) {
    // A revoked or rotated token: the next call reads gh's store again. Other failures ("no pull requests found") keep it.
    const message = (error as Error).message;
    if (/HTTP 401|Bad credentials|authentication/i.test(message)) tokens.delete(user);
    // gh's GraphQL wording for "this login can't see the repository", private or missing.
    if (/Could not resolve to a Repository/.test(message)) throw new Error(`${user} can't see this repository on GitHub. Give ${user} access, or pick another GitHub account in Settings › Profiles.`);
    throw error;
  }
}

async function tokenFor(user: string) {
  const cached = tokens.get(user);
  if (cached) return cached;
  const token = (
    await run('gh', homedir(), ['auth', 'token', '--hostname', 'github.com', '--user', user]).catch(() => {
      throw new Error(`gh has no working login for ${user}. Sign in with gh auth login, or pick another GitHub account in Settings › Profiles.`);
    })
  ).trim();
  tokens.set(user, token);
  return token;
}
