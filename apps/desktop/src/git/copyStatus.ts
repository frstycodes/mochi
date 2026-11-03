import { plural } from '@mochi/domain/lib/format';
import { host } from '../host/index.ts';
import type { CopyStatus } from '../host/types/remote.ts';

export type SyncDirection = 'pull' | 'push';

/**
 * Pull or push a project's checked-out branch where the folder is. A pull only fast-forwards from `origin/<branch>`
 * (`git.sync` fetches it first), so a copy never stops half-merged: one with commits of its own is refused. Resolves to
 * what it did, in words.
 */
export async function syncCopy(
  path: string,
  direction: SyncDirection,
  githubUser: string | undefined,
): Promise<string> {
  const { branch, upstream } = await host.git.status(path);
  if (direction === 'push') {
    await host.git.push(path, githubUser);
    return `Pushed ${branch}`;
  }
  if (!upstream) throw new Error(`${branch} has no upstream to pull from`);
  if (upstream.ahead > 0)
    throw new Error(
      `${branch} has commits that aren’t pushed; push them or merge in a terminal`,
    );
  const { conflicts } = await host.git.sync(path, `origin/${branch}`);
  // GAP: unreachable for a fast-forward; kept so a surprise never reads as a success.
  if (conflicts.length > 0)
    throw new Error(`Pulling ${branch} stopped on conflicts`);
  return upstream.behind > 0
    ? `Pulled ${plural(upstream.behind, '1 commit', `${upstream.behind} commits`)} into ${branch}`
    : `${branch} is up to date`;
}

/** The git state a project's folder reports: its branch, changed files and where it stands against its upstream; null for a plain folder. */
export async function copyStatus(path: string): Promise<CopyStatus | null> {
  const status = await host.git.status(path).catch(() => undefined);
  if (!status) return null;
  return {
    branch: status.branch,
    changed: status.files.length,
    ...(status.upstream && { upstream: status.upstream }),
  };
}
