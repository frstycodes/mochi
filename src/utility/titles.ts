import { branchName } from '../git/workspace.ts';
import { isConcrete } from '../drift.ts';
import type { Thread } from '../model.ts';
import { titlePrompt } from './prompts.ts';

/**
 * The prompt that names a live thread once its first real exchange is over; null while it's working, after only small talk
 * (a thread started with "hi"), and once a title was generated or you renamed it.
 */
export function titleRequest(t: Thread) {
  if (!t.live || t.live.isWorking || t.isTitleRenamed || t.isTitleGenerated) return null;
  const asked = t.goal || t.activity.find((e) => e.who === 'you' && e.kind === 'message' && isConcrete(e.text))?.text;
  if (!asked) return null;
  const reply = t.activity.find((e) => e.who !== 'you' && e.who !== 'harness' && e.kind === 'message');
  return reply?.text ? titlePrompt(asked, reply.text.slice(0, 2000)) : null;
}

export function automaticBranchTitle(t: Thread, title: string) {
  const repo = t.repo;
  if (!repo?.autoBranch || repo.branch !== repo.autoBranch || repo.mode === 'folder' || repo.isExisting || repo.isDetached) return null;
  const slug = branchName('', title, '').split('/').at(-1);
  if (!slug) return null;
  return repo.branch.slice(0, repo.branch.lastIndexOf('/') + 1) + slug;
}
