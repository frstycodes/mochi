import { host } from '../host/index.ts';
import type { PrAction } from '../host/types/remote.ts';

/** The PR tab's writes, in `cwd` as `githubUser`: here for this computer's threads, on the owner for another's (`pr`). */
export async function runPrAction(
  cwd: string,
  number: number,
  action: PrAction,
  githubUser: string | undefined,
): Promise<void> {
  switch (action.kind) {
    case 'comment':
      return host.git.commentPr(cwd, number, action.body, githubUser);
    case 'review':
      return host.git.reviewPr(
        cwd,
        number,
        action.verdict,
        action.body,
        githubUser,
      );
    case 'merge':
      return host.git.mergePr(
        cwd,
        number,
        action.method,
        action.mode,
        githubUser,
      );
    case 'reply':
      return host.git.replyThread(
        cwd,
        action.reviewThreadId,
        action.body,
        githubUser,
      );
    case 'resolve':
      return host.git.resolveThread(
        cwd,
        action.reviewThreadId,
        action.isResolved,
        githubUser,
      );
  }
}
