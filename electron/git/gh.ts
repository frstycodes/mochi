import { homedir } from 'node:os';
import { formatGithubAccount, parseGithubAccount, parseRemote, tokenVariable, type GithubAccountRef } from '../../src/git/github.ts';
import { parseGhAuthStatus } from '../../src/git/parse.ts';
import { run, runGit } from './run.ts';

// Tokens stay in the main process: read from gh's own store per login, handed to one child process in its environment,
// never put in arguments (visible in `ps`) and never sent to the renderer.
const tokens = new Map<string, string>();

/** gh's logins on every host. `gh auth status` exits 1 when any stored login is broken, and still prints them all. */
export async function ghAccounts() {
  return parseGhAuthStatus(await run('gh', homedir(), ['auth', 'status'], { okCodes: [0, 1], stderr: true }));
}

/** `githubUser` from the renderer → an account ref; throws on anything that isn't `login` or `host/login`. */
export function githubAccount(value: unknown): GithubAccountRef | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const ref = typeof value === 'string' && value.length <= 128 ? parseGithubAccount(value) : null;
  if (!ref) throw new TypeError('githubUser must be a GitHub login, or host/login for GitHub Enterprise');
  return ref;
}

/** `gh <args>` in `cwd` as the profile's account, or as gh's active account when there is none. */
export async function runGh(cwd: string, args: string[], account: GithubAccountRef | undefined, options: Omit<Parameters<typeof run>[3] & object, 'env'> = {}) {
  if (!account) return run('gh', cwd, args, options);
  await originOn(cwd, account);
  return asAccount(account, (token) => run('gh', cwd, args, { ...options, env: { [tokenVariable(account.host)]: token } }));
}

/** `gh <args>` as the account outside any repository (listing or creating repositories), on the account's host. */
export function runGhOn(account: GithubAccountRef | undefined, args: string[], cwd = homedir()) {
  if (!account) return run('gh', cwd, args);
  return asAccount(account, (token) => run('gh', cwd, args, { env: { [tokenVariable(account.host)]: token, GH_HOST: account.host } }));
}

/**
 * `git -c … <args>` with the account's token supplied over HTTPS by a credential helper reading it from the environment.
 * `exec` runs git another way (streaming a clone's progress) with the args and environment it's given.
 */
export function runGitAs(account: GithubAccountRef, cwd: string, args: string[], exec: (args: string[], env: Record<string, string>) => Promise<unknown> = (a, env) => runGit(cwd, a, { env })) {
  return asAccount(account, (token) =>
    exec(
      [
        // The empty entry drops helpers from the user's config (osxkeychain would otherwise offer, or store, its own login).
        '-c',
        'credential.helper=',
        '-c',
        'credential.helper=!f() { test "$1" = get && echo username=x-access-token && echo "password=$MOCHI_GIT_TOKEN"; }; f',
        ...args,
      ],
      { MOCHI_GIT_TOKEN: token },
    ),
  );
}

/**
 * `git push -u origin HEAD` as the profile's account: over HTTPS to origin's repository (whatever protocol origin uses),
 * with the token supplied by a credential helper that reads it from the environment. Upstream still tracks `origin`.
 */
export async function pushAs(top: string, account: GithubAccountRef | undefined) {
  if (!account) return void (await runGit(top, ['push', '-u', 'origin', 'HEAD']));
  const { path } = await originOn(top, account);
  await runGitAs(account, top, ['-c', `remote.origin.pushurl=https://${account.host}/${path}.git`, 'push', '-u', 'origin', 'HEAD']);
}

/** origin's host and path; refuses when origin lives on another host than the account. */
async function originOn(cwd: string, account: GithubAccountRef) {
  const url = (await runGit(cwd, ['remote', 'get-url', 'origin']).catch(() => '')).trim();
  const remote = parseRemote(url);
  if (!remote) throw new Error(`origin (${url || 'none'}) isn't a GitHub remote, so the profile's GitHub account can't be used here.`);
  if (remote.host !== account.host)
    throw new Error(`This repository is on ${remote.host}, but the profile's GitHub account ${formatGithubAccount(account)} is on ${account.host}. Pick a ${remote.host} account in Settings › Profiles.`);
  return remote;
}

async function asAccount<T>(account: GithubAccountRef, use: (token: string) => Promise<T>) {
  const name = formatGithubAccount(account);
  const token = await tokenFor(account);
  try {
    return await use(token);
  } catch (error) {
    const message = (error as Error).message;
    // A revoked or rotated token: the next call reads gh's store again. Other failures ("no pull requests found") keep it.
    if (/HTTP 401|Bad credentials|authentication|Authentication failed/i.test(message)) tokens.delete(name);
    // gh's GraphQL wording, and git's over HTTPS, for "this login can't see or write the repository".
    if (/Could not resolve to a Repository|Repository not found|Permission to .* denied|returned error: 403/.test(message))
      throw new Error(`${account.login} can't reach this repository on ${account.host}. Give ${account.login} access, or pick another GitHub account in Settings › Profiles.`, { cause: error });
    throw error;
  }
}

async function tokenFor(account: GithubAccountRef) {
  const name = formatGithubAccount(account);
  const cached = tokens.get(name);
  if (cached) return cached;
  const token = (
    await run('gh', homedir(), ['auth', 'token', '--hostname', account.host, '--user', account.login]).catch(() => {
      throw new Error(`gh has no working login for ${name}. Sign in with gh auth login, or pick another GitHub account in Settings › Profiles.`);
    })
  ).trim();
  tokens.set(name, token);
  return token;
}
