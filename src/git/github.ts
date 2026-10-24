import { GITHUB_COM } from '@mochi/core/github/account';

export { formatGithubAccount, GITHUB_COM, parseGithubAccount, parseRemote, type GithubAccountRef } from '@mochi/core/github/account';

/** gh reads GH_TOKEN for github.com and GitHub Enterprise Cloud (`*.ghe.com`), GH_ENTERPRISE_TOKEN for Enterprise Server (`gh help environment`). */
export function tokenVariable(host: string) {
  return host === GITHUB_COM || host.endsWith('.ghe.com') ? 'GH_TOKEN' : 'GH_ENTERPRISE_TOKEN';
}
