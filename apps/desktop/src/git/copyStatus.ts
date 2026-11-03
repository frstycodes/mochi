import { host } from '../host/index.ts';
import type { CopyStatus } from '../host/types/remote.ts';

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
