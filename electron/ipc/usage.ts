import { app } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { UsageHost, UsageReport } from '../../src/host/types/usage.ts';
import type { Provider } from '../../src/model.ts';
import { HARNESSES } from '../../src/settings/harnesses.ts';
import { accountsState } from '../agents/config.ts';
import { githubAccount } from '../git/gh.ts';
import { claudeRecords } from '../usage/claude.ts';
import { codexRecords } from '../usage/codex.ts';
import { commitStats, prStats } from '../usage/git.ts';
import { priceBook } from '../usage/prices.ts';
import { summarize } from '../usage/records.ts';
import type { Handlers } from './handlers.ts';

export const usage = {
  async report(_sender, query) {
    const roots = withoutTrailingSlash(query.roots);
    const repos = withoutTrailingSlash(query.repos);
    const { since } = query;
    const account = githubAccount(query.githubUser);
    const errors: string[] = [];
    const settle = <T,>(work: Promise<T[]>, failure: string) =>
      work.catch((error: Error) => {
        errors.push(`${failure}: ${error.message.split('\n')[0]}`);
        return [] as T[];
      });

    const [claude, codex, commits, prs] = await Promise.all([
      settle(claudeRecords(homes('claude'), roots, since), 'Claude Code logs'),
      settle(codexRecords(homes('codex'), roots, since), 'Codex logs'),
      Promise.all(repos.map((repo) => settle(commitStats(repo, since), `Commits in ${repo}`))).then((r) => r.flat()),
      Promise.all(repos.map((repo) => settle(prStats(repo, since, account), `Pull requests in ${repo}`))).then((r) => r.flat()),
    ]);
    const price = await priceBook(join(app.getPath('userData'), 'model-prices.json'));
    return { ...summarize([...claude, ...codex], roots, since, price), commits, prs, errors } satisfies UsageReport;
  },
} satisfies Handlers<UsageHost>;

/** Every config folder the harness logs into: the default one and each profile account's own. */
function homes(provider: Provider) {
  const fallback = join(homedir(), HARNESSES[provider].defaultFolder.replace(/^~\//, ''));
  const own = accountsState().accounts.filter((a) => a.provider === provider).map((a) => a.configDir ?? fallback);
  return [...new Set([fallback, ...own])];
}

function withoutTrailingSlash(paths: string[]) {
  return paths.map((p) => p.replace(/\/+$/, ''));
}
