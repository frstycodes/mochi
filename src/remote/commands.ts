import type { Dispatch } from 'react';
import { queuedMessage, sendMessage, shouldQueue } from '../chat/outbox.ts';
import type { CommandResult, RemoteCommand } from '../host/types/remote.ts';
import type { Prefs } from '../settings/prefs.ts';
import type { Action, State } from '../store/index.tsx';
import { answeredBy, markAnswered } from './tap.ts';

export interface CommandEnv {
  state: Pick<State, 'threads' | 'queue'>;
  dispatch: Dispatch<Action>;
  deviceName: string;
  whileWorking: Prefs['whileWorking'];
}

/** A device's command, run through the same code the machine's own UI runs for it. */
export function runRemoteCommand(command: RemoteCommand, { state, dispatch, deviceName, whileWorking }: CommandEnv): CommandResult {
  if (command.type === 'resolve') {
    const by = answeredBy(command.queueId);
    if (by !== undefined) return { isOk: false, error: `Already answered on ${by}` };
    const item = state.queue.find((q) => q.id === command.queueId);
    if (!item) return { isOk: false, error: 'This is no longer waiting for an answer' };
    // `operate` answers the agent; settling reviews, runs and collisions is the thread's own business (`manage`).
    if (item.kind !== 'approval' && item.kind !== 'question') return { isOk: false, error: 'Only approvals and questions can be answered from a device' };
    if (item.kind === 'question' && !command.answers?.length) return { isOk: false, error: 'A question needs answers' };
    // Before the dispatch: the store applies it on the next render, and a second answer can arrive before that.
    markAnswered(command.queueId, deviceName);
    dispatch({ type: 'answer', queueId: command.queueId, answers: command.answers });
    return { isOk: true };
  }
  const thread = state.threads.find((t) => t.id === command.threadId);
  if (!thread) return { isOk: false, error: 'No such thread on this machine' };
  if (command.type === 'interrupt') {
    if (!thread.live?.isWorking) return { isOk: false, error: 'The agent isn’t working' };
    dispatch({ type: 'interrupt', threadId: thread.id });
    return { isOk: true };
  }
  // The composer's path: queued behind a working agent per Settings › While the agent is working, otherwise sent now.
  const message = queuedMessage(command.text, { mentions: [], isCommand: false, typedSkills: [] });
  if (shouldQueue(thread, whileWorking, false)) dispatch({ type: 'queued-add', threadId: thread.id, message });
  else sendMessage(dispatch, state, thread, message);
  return { isOk: true };
}
