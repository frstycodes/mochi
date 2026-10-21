import type { MoveChanges, MoveResult, StartWorkspace } from '../host/types/agent.ts';
import type { Repo, Thread } from '../model.ts';
import { branchText } from './workspace.ts';

/** A move the agent asked for (`move_thread`), run by Mochi once its turn ends (`src/runtime/moves.ts`). */
export interface PendingMove {
  /** The project folder it moves to; with `files`, a new folder made from them. */
  root: string;
  /** Its own worktree or the project's checkout, and on which branch; unset for a folder that isn't a git repository (yet). */
  workspace?: StartWorkspace;
  changes: MoveChanges;
  files?: { from: string; transfer: 'move' | 'copy' };
  gitInit?: boolean;
}

/** Where the move put the thread: the repo it now belongs to, and main's answer. */
export interface MoveTarget {
  repo: Repo;
  result: MoveResult;
  /** The folder it worked in before; null for a chat whose agent never ran. */
  from: string | null;
}

/** What the agent is woken with after a move, behind the note saying where it is now. */
export const MOVED_PROMPT = 'Continue where you left off.';

/**
 * The thread once its agent moved: the new repo and folder, its agent woken on the same session there (`agentCalls` resumes
 * it with `moveNote`). History, session, sub-threads and PRs stay; Auto-fix stays on only while the thread is still on the same
 * project and branch, since its fixes go to the PR's branch.
 */
export function movedThread(thread: Thread, { repo, result }: MoveTarget, now: number): Thread {
  const isSameBranch = thread.repo?.path === repo.path && thread.repo?.branch === repo.branch;
  const prs = isSameBranch ? thread.prs : thread.prs.map((pr) => ({ ...pr, autofixSince: undefined }));
  const text = `Moved to ${placeText(repo, result.cwd)}${result.stash ? `; uncommitted changes stashed as "${result.stash}"` : ''}`;
  return woken({ ...thread, repo, prs, setup: undefined, ...(thread.live && { live: { ...thread.live, cwd: result.cwd } }) }, text, now);
}

/** The move didn't happen: the agent is woken where it was, told why. */
export function unmovedThread(thread: Thread, error: string, now: number): Thread {
  return woken(thread, `Couldn't move the thread: ${error}`, now);
}

/** What the agent reads first after the move: its cwd changed under it. */
export function moveNote(from: string | null, repo: Repo, { cwd, stash }: MoveResult) {
  const lines = [
    `[Mochi: the move you asked for is done; this thread is now in ${placeText(repo, cwd)}. Your working directory is ${cwd}${from && from !== cwd ? `, no longer ${from}` : ''}. Run commands and edit files there.`,
    stash && `The uncommitted changes from the old folder were stashed there as "${stash}", not brought along.`,
  ];
  return `${lines.filter(Boolean).join(' ')}]`;
}

export function moveFailedNote(error: string, cwd: string | null) {
  return `[Mochi: the move you asked for failed, so nothing moved${cwd ? ` and you are still in ${cwd}` : ''}: ${error}]`;
}

function woken(thread: Thread, text: string, now: number): Thread {
  const live = thread.live && { ...thread.live, isWorking: true, isDetached: undefined, starting: undefined, notes: undefined, restart: undefined };
  return { ...thread, move: undefined, status: 'running', ...(live && { live }), turn: { start: thread.activity.length, isAgentDriven: true }, activity: [...thread.activity, { at: now, who: 'harness', kind: 'event', text }] };
}

function placeText(repo: Repo, cwd: string) {
  const where = repo.mode === 'folder' ? 'its project folder' : `a worktree (${cwd})`;
  return repo.branch ? `${repo.project} on ${branchText(repo)}, in ${where}` : repo.project;
}
