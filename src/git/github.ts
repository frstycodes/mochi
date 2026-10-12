/**
 * A profile's GitHub account as stored in `Space.github`: a bare login for github.com (what profiles saved before hosts
 * existed), `host/login` for any other host. Neither part can contain '/', so the split is unambiguous.
 */
export interface GithubAccountRef {
  host: string;
  login: string;
}

export const GITHUB_COM = 'github.com';

export function parseGithubAccount(value: string): GithubAccountRef | null {
  if (!value) return null;
  const [host, login] = value.includes('/') ? value.split('/', 2) : [GITHUB_COM, value];
  return /^[\w.-]+$/.test(host) && /^[\w-]+$/.test(login) ? { host, login } : null;
}

export function formatGithubAccount({ host, login }: GithubAccountRef) {
  return host === GITHUB_COM ? login : `${host}/${login}`;
}

/** gh reads GH_TOKEN for github.com and GitHub Enterprise Cloud (`*.ghe.com`), GH_ENTERPRISE_TOKEN for Enterprise Server (`gh help environment`). */
export function tokenVariable(host: string) {
  return host === GITHUB_COM || host.endsWith('.ghe.com') ? 'GH_TOKEN' : 'GH_ENTERPRISE_TOKEN';
}

/** A git remote URL (scp-style SSH, ssh://, https://) → its host and `owner/repo` path; null for anything else (local paths, file://). */
export function parseRemote(url: string): { host: string; path: string } | null {
  const match = url.trim().match(/^(?:ssh:\/\/)?[\w.-]+@([\w.-]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/) ?? url.trim().match(/^https?:\/\/(?:[^@/]+@)?([\w.-]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/);
  if (!match || !/^[\w.-]+\/[\w.-]+$/.test(match[2])) return null;
  return { host: match[1].toLowerCase(), path: match[2] };
}
