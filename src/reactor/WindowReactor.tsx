import { useEffect, type Dispatch } from 'react';
import { Effect, Fiber } from 'effect';
import type { WindowCommand } from '@mochi/core/reactor/commands';
import { clearDraft, threadDraftKey } from '../chat/drafts.ts';
import { compactFocus, sendCompactInstructions } from '../chat/compact.ts';
import { sendMessage } from '../chat/outbox.ts';
import { useAllPins } from '../chat/pins.ts';
import { gatherIdle } from '../goals/idleChecks.ts';
import { refreshThreadPrs, usePrSync } from '../git/usePrSync.ts';
import { worktreePath } from '../git/worktrees.ts';
import { host } from '../host/index.ts';
import type { Thread } from '../model.ts';
import { coreClient } from '../host/desktop/rpc.ts';
import { useRemoteBridge } from '../remote/useRemoteBridge.ts';
import { dueQueued, dueReports, dueWakes } from '../runtime/due.ts';
import { dueResumes } from '../runtime/limits.ts';
import { autoSimplify } from '../simplify/useSimplify.ts';
import { useDispatch, useGetState, type Action, type State } from '../store/index.tsx';
import { hasTempBranch } from '../utility/titles.ts';

/**
 * Carries out what Core's reactor decides (packages/core/src/reactor/rules.ts), in the window that owns the store, until Core
 * owns it. Also the window-side pieces that read state Core doesn't hold yet: PR records, device commands, pin changes.
 */
export function WindowReactor() {
  const getState = useGetState();
  const dispatch = useDispatch();
  const pins = useAllPins();
  useEffect(() => {
    if (!host.isDesktop) return;
    const served = Promise.all([coreClient(), import('@mochi/core/hostClient')]).then(([client, { serveCapabilities }]) =>
      Effect.runFork(serveCapabilities(client, ['reactor'], async (call) => runCommand(call.args[0] as WindowCommand, getState(), dispatch))),
    );
    return () => void served.then((fiber) => Effect.runFork(Fiber.interrupt(fiber)));
  }, [getState, dispatch]);
  // Core sends a thread's instructions when its goal changes; a pin change only this window sees.
  useEffect(() => {
    for (const thread of getState().threads) sendCompactInstructions(thread, pins[thread.id] ?? []);
  }, [pins, getState]);
  usePrSync();
  useRemoteBridge(getState, dispatch);
  return null;
}

/**
 * Each command re-checks against this window's state, which can be ahead of the save Core decided on. `skipped`: not due here,
 * so Core forgets it and asks again once a save shows it due. A throw retries it: a turn's end Core logged before this window applied it.
 */
function runCommand(command: WindowCommand, state: State, dispatch: Dispatch<Action>): 'skipped' | void {
  const thread = state.threads.find((t) => t.id === command.threadId);
  if (command.type === 'drafts.prune') return clearDraft(threadDraftKey(command.threadId));
  if (!thread) return 'skipped';
  switch (command.type) {
    case 'queue.send': {
      const message = dueQueued(state).find((due) => due.message.id === command.messageId)?.message;
      if (!message) return 'skipped';
      const focus = compactFocus(message.draft);
      if (focus !== null) return dispatch({ type: 'compact', threadId: thread.id, focus, queuedId: message.id });
      return sendMessage(dispatch, state, thread, message, { queuedId: message.id });
    }
    case 'delegate.report':
      if (!dueReports([thread]).some((due) => due.subagent.id === command.subagentId)) return 'skipped';
      return dispatch({ type: 'delegate-report', threadId: thread.id, subagentId: command.subagentId });
    case 'subthread.wake':
      if (!dueWakes(state).includes(thread)) return 'skipped';
      return dispatch({ type: 'subthread-wake', threadId: thread.id });
    case 'limit.resume':
      if (!dueResumes([thread]).length || thread.live?.limit?.resetsAt !== command.resetsAt) return 'skipped';
      return dispatch({ type: 'resume', threadId: thread.id, atReset: true });
    case 'title.apply':
      return void applyTitle(thread, command.title, dispatch);
    case 'idle.gather':
      if (thread.live?.isWorking) throw new Error('The turn has not ended in this window yet');
      return gatherIdle(thread, dispatch);
    case 'simplify.auto':
      if (thread.live?.isWorking) throw new Error('The turn has not ended in this window yet');
      return autoSimplify(thread, dispatch);
    case 'compact.instructions':
      return sendCompactInstructions(thread);
    case 'pr.refresh':
      return refreshThreadPrs(state.threads, thread.id);
  }
}

/** A rename while the model was out wins, title and branch both; the branch follows the title while it's still the temp name. */
async function applyTitle(thread: Thread, title: string, dispatch: Dispatch<Action>) {
  if (thread.isTitleRenamed) return;
  dispatch({ type: 'title-generated', threadId: thread.id, title });
  const cwd = worktreePath(thread.id);
  if (!hasTempBranch(thread) || !cwd) return;
  try {
    const branch = await host.git.renameAutoBranch(cwd, thread.repo!.branch, title);
    if (branch) dispatch({ type: 'repo-head', threadId: thread.id, head: { branch, isDetached: false }, worktree: cwd });
  } catch (error) {
    console.warn('Automatic branch not renamed', error);
  }
}
