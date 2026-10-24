import type { Dispatch } from 'react';
import { threadRoot } from './root.ts';
import type { PullRequest, Thread } from '../model.ts';
import type { Action } from '../store/types.ts';

/** Main can watch it: a live, unsettled thread with a folder, and a PR that's open or a draft. */
export const canAutofix = (thread: Thread, pr: PullRequest) => !!thread.live && thread.status !== 'settled' && !!threadRoot(thread) && (pr.state === 'open' || pr.state === 'draft');

/** The PR the thread's ⋮ menu toggles: the newest one Auto-fix can watch. */
export const autofixPr = (thread: Thread) => thread.prs.findLast((pr) => canAutofix(thread, pr));

export function setAutofix(dispatch: Dispatch<Action>, thread: Thread, pr: PullRequest, isOn: boolean) {
  dispatch({ type: 'autofix-set', threadId: thread.id, pr: pr.number, ...(isOn && { since: Date.now() }) });
}
