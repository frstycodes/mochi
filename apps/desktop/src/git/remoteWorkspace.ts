import type { BranchList } from '../host/types/git.ts';
import type { RemoteWorkspace } from '../host/types/remote.ts';

/**
 * Why a device's workspace can't start here, checked against this checkout's own branches; null when it can. The schema
 * already refused anything shaped like a path or an option, so this only asks whether the names are real here.
 */
export function workspaceProblem(
  workspace: RemoteWorkspace,
  list: BranchList,
  checkout: string,
): string | null {
  const find = (name: string) => list.branches.find((b) => b.name === name);
  if (workspace.base !== undefined && !find(workspace.base))
    return `There’s no branch ${workspace.base} here`;
  const { branch } = workspace;
  const isNew = workspace.mode === 'worktree' && !workspace.isExisting;
  if (branch === undefined)
    return workspace.isExisting ? 'Pick the branch to check out' : null;
  if (isNew)
    return find(branch)
      ? `${branch} already exists here; check it out instead`
      : null;
  const local = list.branches.find((b) => b.name === branch && !b.isRemote);
  if (!local) return `There’s no branch ${branch} here`;
  // Git allows a branch in one checkout only; the project folder itself may stay on its own branch.
  const isHeldElsewhere =
    !!local.worktree &&
    (workspace.mode === 'worktree' || local.worktree !== checkout);
  if (isHeldElsewhere)
    return `${branch} is already checked out in ${local.worktree}`;
  return null;
}
