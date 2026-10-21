import { useEffect, useRef, type Dispatch } from 'react';
import { gitError } from '../git/useGit.ts';
import type { MoveTarget, PendingMove } from '../git/moveThread.ts';
import { tempBranch, workspaceMode } from '../git/workspace.ts';
import type { StartWorkspace } from '../host/types/agent.ts';
import type { BranchList } from '../host/types/git.ts';
import type { Prefs } from '../settings/prefs.ts';
import type { Args } from './tools.ts';
import { setWorktreePath } from '../git/worktrees.ts';
import { host } from '../host/index.ts';
import { threadCwd } from '../host/cwd.ts';
import type { Repo, Thread } from '../model.ts';
import { isAbsolutePath, projectName, projectRef, refreshProjects } from '../projects.ts';
import type { Action } from '../store/index.tsx';

/** Runs each thread's `move_thread` once its agent's turn is over, then wakes the agent on the same session (`agentCalls`). */
export function useThreadMoves(threads: Thread[], dispatch: Dispatch<Action>) {
  const running = useRef(new Set<string>());
  useEffect(() => {
    for (const thread of threads) {
      if (!thread.move || thread.live?.isWorking || running.current.has(thread.id)) continue;
      running.current.add(thread.id);
      void runMove(thread, thread.move)
        .then(
          (to) => dispatch({ type: 'move', threadId: thread.id, to }),
          (error: unknown) => dispatch({ type: 'move-failed', threadId: thread.id, error: gitError(error) }),
        )
        .finally(() => running.current.delete(thread.id));
    }
  }, [threads, dispatch]);
}

/** Makes `move.root` a listed project (from the files, with `git init`, as asked), then has main move the agent there. */
async function runMove(thread: Thread, move: PendingMove): Promise<MoveTarget> {
  const from = (thread.repo ? threadCwd(thread) : thread.agent?.cwd) ?? null;
  const project = await host.projects.adopt(thread.spaceId, move.root, { ...move.files, gitInit: move.gitInit });
  refreshProjects(thread.spaceId);
  const { workspace } = move;
  const result = await host.agent.move(thread.id, { from, root: project.path, workspace, changes: move.changes });
  setWorktreePath(thread.id, workspace?.mode === 'worktree' ? result.cwd : null);
  const repo: Repo = {
    project: projectName(project.path),
    path: project.path,
    branch: result.head?.branch ?? '',
    ...(result.head?.isDetached && { isDetached: true }),
    ...(workspace?.mode !== 'worktree' && { mode: 'folder' as const }),
    ...(workspace?.base && { base: workspace.base }),
  };
  return { repo, result, from };
}

export type MoveArgs = Args<'move_thread'>;

export interface MoveChecks {
  isFolder: (path: string) => Promise<boolean>;
  branches: (root: string) => Promise<BranchList>;
  branchNameError: (root: string, name: string) => Promise<string | null>;
  prefs: Pick<Prefs, 'workspaceMode' | 'branchPrefix'>;
}

/** A `move_thread` call checked against the disk now, so a bad one fails on the call instead of after the turn. */
export async function planMove(thread: Thread, args: MoveArgs, checks: MoveChecks): Promise<PendingMove> {
  if (!thread.live) throw new Error('Only a thread with a live agent can move');
  if (!isAbsolutePath(args.project)) throw new Error(`project must be an absolute path, not "${args.project}"`);
  const gitInit = args.gitInit ? { gitInit: true } : {};
  if (args.fromFolder) {
    if (!(await checks.isFolder(args.fromFolder))) throw new Error(`${args.fromFolder} isn't a folder`);
    if (await checks.isFolder(args.project)) throw new Error(`${args.project} already exists; pick a new folder, or leave out fromFolder to move into it as it is`);
    if (args.workspace === 'worktree' || args.branch) throw new Error("A new project has no commits yet, so it has no branches or worktrees; move into its folder, commit, then move again");
    return { root: args.project, changes: 'stash', files: { from: args.fromFolder, transfer: args.transfer ?? 'move' }, ...gitInit };
  }
  if (!(await checks.isFolder(args.project))) throw new Error(`${args.project} isn't a folder; pass fromFolder to make it from another folder's files`);
  const isSameProject = args.project === projectRef(thread.repo);
  const changes = args.changes ?? (isSameProject ? 'bring' : 'stash');
  const list = await checks.branches(args.project).catch(() => null);
  if (!list) {
    if (args.workspace === 'worktree' || args.branch) throw new Error(`${args.project} isn't a git repository, so it has no branches or worktrees`);
    return { root: args.project, changes, ...gitInit };
  }
  const workspace = await planWorkspace(thread, args, list, isSameProject, checks);
  if (isSameProject && isWhereItIs(thread, workspace)) throw new Error(`This thread already works in ${args.project} on ${workspace.branch}`);
  return { root: args.project, workspace, changes };
}

async function planWorkspace(thread: Thread, args: MoveArgs, list: BranchList, isSameProject: boolean, checks: MoveChecks): Promise<StartWorkspace> {
  const mode = args.workspace ?? checks.prefs.workspaceMode;
  if (mode === 'folder') {
    const branch = args.branch ?? list.current;
    if (!branch) throw new Error(`${args.project} is on a detached HEAD; pass the branch to switch it to`);
    return { mode, branch, ...(branch !== list.current && { isExisting: true }) };
  }
  if (args.existingBranch) {
    if (!args.branch) throw new Error('existingBranch needs the branch to check out');
    return { mode, branch: args.branch, isExisting: true };
  }
  const branch = args.branch ?? tempBranch(checks.prefs.branchPrefix, `${thread.spaceId}/${thread.id}/move/${Date.now()}`);
  const nameError = await checks.branchNameError(args.project, branch);
  if (nameError) throw new Error(nameError);
  const base = args.base ?? (isSameProject ? thread.repo?.branch : undefined);
  return { mode, branch, ...(base && { base }) };
}

function isWhereItIs(thread: Thread, { mode, branch, isExisting }: StartWorkspace) {
  if (!thread.repo || branch !== thread.repo.branch) return false;
  return mode === 'folder' ? workspaceMode(thread.repo) === 'folder' : workspaceMode(thread.repo) === 'worktree' && !!isExisting;
}
