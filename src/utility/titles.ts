import { isConcrete } from '../drift.ts';
import { firstPrompt, type Thread } from '../model.ts';
import { titlePrompt } from './prompts.ts';

/**
 * The prompt main names a new thread with while its worktree is set up, so the agent starts on the named branch: its first
 * message alone. Undefined unless the thread is on its temp branch and that message says what it's about.
 */
export function startTitleRequest(t: Thread) {
  const asked = firstPrompt(t);
  return hasTempBranch(t) && !t.isTitleRenamed && isConcrete(asked) ? titlePrompt(asked) : undefined;
}

/**
 * The prompt that names a live thread once its first real exchange is over, when naming it before the start didn't: null while
 * it's working, after only small talk (a thread started with "hi"), and once a title was generated or you renamed it.
 */
export function titleRequest(t: Thread) {
  if (!t.live || t.live.isWorking || t.isTitleRenamed || t.isTitleGenerated) return null;
  const asked = t.goal || t.activity.find((e) => e.who === 'you' && e.kind === 'message' && isConcrete(e.text))?.text;
  if (!asked) return null;
  const reply = t.activity.find((e) => e.who !== 'you' && e.who !== 'harness' && e.kind === 'message');
  return reply?.text ? titlePrompt(asked, reply.text.slice(0, 2000)) : null;
}

/** Still on the temp branch Mochi made for it, so its title may rename it (`renameAutoBranch` also refuses a pushed one). */
export function hasTempBranch(t: Thread) {
  const repo = t.repo;
  return !!repo?.autoBranch && repo.branch === repo.autoBranch && repo.mode !== 'folder' && !repo.isExisting && !repo.isDetached;
}
