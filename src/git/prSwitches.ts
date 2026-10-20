import { host } from '../host/index.ts';
import { refreshRef } from '../chat/useRefState.ts';
import type { Thread } from '../model.ts';
import { useHarness } from '../store';
import { toast } from '../toast/store.ts';
import { canAutofix, setAutofix } from './autofixToggle.ts';
import { useGithubScope, type ThreadPr } from './useThreadPrs.ts';

export type PrSwitchId = 'autofix' | 'merge' | 'archive';

export interface PrSwitch {
  id: PrSwitchId;
  label: string;
  hint: string;
  isOn: boolean;
  set: (isOn: boolean) => void;
}

/**
 * A PR's three switches, in Claude's order, while Mochi can watch it: Auto-fix and Auto-archive are Mochi's, Merge when ready is
 * GitHub's auto-merge (read from GitHub, and only on an open PR: GitHub refuses it on a draft).
 */
export function usePrSwitches(thread: Thread, item: ThreadPr): PrSwitch[] {
  const { dispatch } = useHarness();
  const scope = useGithubScope(thread);
  const { pr, state, githubRef } = item;
  if (!canAutofix(thread, pr)) return [];
  const setMerge = (isOn: boolean) => {
    if (!scope.cwd) return;
    host.git.setAutoMerge(scope.cwd, pr.number, isOn, scope.githubUser).then(
      () => githubRef && refreshRef(githubRef, scope, { isAutoMerge: isOn }),
      (error: Error) => toast.error(isOn ? 'Couldn’t turn on Merge when ready' : 'Couldn’t turn off Merge when ready', { description: error.message }),
    );
  };
  const autofix: PrSwitch = { id: 'autofix', label: 'Auto-fix', hint: 'Fixes CI and conflicts, weighs reviews', isOn: !!pr.autofixSince, set: (isOn) => setAutofix(dispatch, thread, pr, isOn) };
  const merge: PrSwitch = { id: 'merge', label: 'Merge when ready', hint: 'Merges once checks and reviews pass', isOn: state.isAutoMerge, set: setMerge };
  const archive: PrSwitch = {
    id: 'archive',
    label: 'Auto-archive on merge or close',
    hint: 'Once every PR is done and the agent is idle',
    isOn: !!pr.autoArchive,
    set: (isOn) => dispatch({ type: 'auto-archive-set', threadId: thread.id, pr: pr.number, isOn }),
  };
  return state.status === 'open' ? [autofix, merge, archive] : [autofix, archive];
}
