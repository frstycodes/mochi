import { useEffect, type Dispatch } from 'react';
import { Effect, Fiber } from 'effect';
import type { WindowCommand } from '@mochi/core/reactor/commands';
import { clearDraft, threadDraftKey } from '../chat/drafts.ts';
import { compactFocus } from '../chat/compact.ts';
import { sendMessage } from '../chat/outbox.ts';
import { gatherIdle } from '../goals/idleChecks.ts';
import { refreshThreadPrs, usePrSync } from '../git/usePrSync.ts';
import { host } from '../host/index.ts';
import { coreClient } from '../host/desktop/rpc.ts';
import { useRemoteBridge } from '../remote/useRemoteBridge.ts';
import { dueQueued, dueReports, dueWakes } from '../runtime/due.ts';
import { dueResumes } from '../runtime/limits.ts';
import { autoSimplify } from '../simplify/useSimplify.ts';
import { useDispatch, useGetState, type Action, type State } from '../store/index.tsx';

/**
 * Carries out what Core's reactor can't do itself (packages/core/src/reactor/execute.ts): work that needs this window's host
 * or storage, and a command whose agent call is a start, which reads this window's profiles. Every window serves it; Core
 * calls the latest and falls back to the others. Also PR records and device commands, which read what only a window holds.
 */
export function WindowReactor() {
  const getState = useGetState();
  const dispatch = useDispatch();
  useEffect(() => {
    if (!host.isDesktop) return;
    const served = Promise.all([coreClient(), import('@mochi/core/hostClient')]).then(([client, { serveCapabilities }]) =>
      Effect.runFork(serveCapabilities(client, ['reactor'], async (call) => runCommand(call.args[0] as WindowCommand, getState(), dispatch))),
    );
    return () => void served.then((fiber) => Effect.runFork(Fiber.interrupt(fiber)));
  }, [getState, dispatch]);
  usePrSync();
  useRemoteBridge(getState, dispatch);
  return null;
}

/**
 * Each command re-checks against this window's state, which can be behind or ahead of the fold Core decided on. `skipped`: not due here,
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
    case 'idle.gather':
      if (thread.live?.isWorking) throw new Error('The turn has not ended in this window yet');
      return gatherIdle(thread, dispatch);
    case 'simplify.auto':
      if (thread.live?.isWorking) throw new Error('The turn has not ended in this window yet');
      return autoSimplify(thread, dispatch);
    case 'pr.refresh':
      return refreshThreadPrs(state.threads, thread.id);
  }
}
