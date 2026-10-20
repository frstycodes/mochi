import type { CommitStat, PrStat } from '../../src/host/types/usage.ts';
import type { GithubAccountRef } from '../../src/git/github.ts';
import { runGh } from '../git/gh.ts';
import { runGit } from '../git/run.ts';

/** Generated files that would swamp the line counts. */
const LOCKFILE = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|Cargo\.lock|Gemfile\.lock|poetry\.lock|composer\.lock|go\.sum|uv\.lock)$/;
const PR_LIMIT = 1000;
const RECORD = '\u001e';

/**
 * Your commits on the repo's default branch (origin's HEAD, else the checked-out one), merges counted apart: what shipped,
 * not every local branch. "Yours" is the repo's `user.email`; every author when it has none.
 */
export async function commitStats(repo: string, since: number | null): Promise<CommitStat[]> {
  if (!(await isRepo(repo))) return [];
  const ref = (await runGit(repo, ['rev-parse', '--abbrev-ref', 'origin/HEAD']).catch(() => 'HEAD')).trim() || 'HEAD';
  const email = (await runGit(repo, ['config', 'user.email']).catch(() => '')).trim();
  const args = ['log', ref, `--format=${RECORD}%at %P`, '--numstat', '--no-renames'];
  if (since !== null) args.push(`--since=@${Math.floor(since / 1000)}`);
  if (email) args.push(`--author=${email}`);
  return parseLog(repo, await runGit(repo, args));
}

export function parseLog(repo: string, out: string): CommitStat[] {
  return out
    .split(RECORD)
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const [head, ...files] = chunk.split('\n');
      const [at, ...parents] = head.trim().split(' ');
      let added = 0;
      let removed = 0;
      for (const line of files) {
        const [a, r, path] = line.split('\t');
        // Binary files show `-` for both counts.
        if (!path || a === '-' || LOCKFILE.test(path)) continue;
        added += Number(a);
        removed += Number(r);
      }
      return { repo, at: Number(at) * 1000, added, removed, isMerge: parents.filter(Boolean).length > 1 };
    });
}

/** Pull requests you opened in the repo. */
export async function prStats(repo: string, since: number | null, account: GithubAccountRef | undefined): Promise<PrStat[]> {
  // A folder that isn't a repo, or one never pushed anywhere, has no pull requests to ask GitHub about.
  if (!(await runGit(repo, ['remote', 'get-url', 'origin']).catch(() => ''))) return [];
  const args = ['pr', 'list', '--state', 'all', '--author', '@me', '--limit', String(PR_LIMIT), '--json', 'number,state,createdAt,mergedAt'];
  if (since !== null) args.push('--search', `created:>=${new Date(since).toISOString().slice(0, 10)}`);
  const rows = JSON.parse(await runGh(repo, args, account)) as { number: number; state: PrStat['state']; createdAt: string; mergedAt: string | null }[];
  return rows.map((r) => ({ repo, number: r.number, state: r.state, createdAt: Date.parse(r.createdAt), mergedAt: r.mergedAt ? Date.parse(r.mergedAt) : null }));
}

const isRepo = (path: string) =>
  runGit(path, ['rev-parse', '--is-inside-work-tree']).then(
    () => true,
    () => false,
  );
