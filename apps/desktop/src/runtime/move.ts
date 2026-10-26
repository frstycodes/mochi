import { startWorkspace } from '../git/workspace.ts';
import type { Thread } from '../model.ts';
import type { AgentCall } from './live.ts';
import { startEnv } from './startEnv.ts';

/**
 * Main's half of a folderless chat moving into a project: the folder made now (a new worktree named after the thread, or the
 * project folder) and the session readied there. Its session's provider decides whether Claude's transcript is copied.
 */
export function moveCall(thread: Thread): AgentCall[] {
  const cwd = thread.repo && startEnv().projectRoot(thread.repo);
  const workspace = startWorkspace(thread.repo);
  if (!cwd || !workspace) return [];
  return [
    {
      method: 'move',
      threadId: thread.id,
      options: {
        provider: thread.session?.provider ?? thread.providers[0],
        spaceId: thread.spaceId,
        cwd,
        workspace:
          workspace.mode === 'worktree'
            ? { ...workspace, isNew: true, title: thread.title }
            : workspace,
        ...(thread.session && { sessionId: thread.session.id }),
      },
    },
  ];
}

/** The first message after a move tells the agent where it works now and where its earlier files stayed. */
export function withMoveNote(thread: Thread, text: string) {
  const from = thread.live?.movedFrom;
  if (!from || !thread.repo) return text;
  const cwd = thread.live?.cwd ?? startEnv().threadCwd(thread);
  return `${moveNote(thread.repo.project, cwd, from)}\n\n${text}`;
}

export const moveNote = (project: string, cwd: string | null, from: string) =>
  `This thread moved into the ${project} project: you now work in ${cwd ?? 'its folder'}. Files from before the move stay in ${from}.`;
