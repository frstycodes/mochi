import type { Dispatch } from 'react';
import { queuedMessage, sendMessage, shouldQueue } from '../chat/outbox.ts';
import { openedPr } from '../git/prs.ts';
import { draftFrom } from '../goals/edit.ts';
import { threadCwd } from '../host/cwd.ts';
import { host } from '../host/index.ts';
import type { CommandResult, RemoteCommand } from '../host/types/remote.ts';
import type { Thread } from '../model.ts';
import { getProfiles } from '../profiles.ts';
import { pinnedThreads, togglePin } from '../reorder.ts';
import { handoffSummary } from '../rewind/handoff.ts';
import type { Prefs } from '../settings/prefs.ts';
import type { Action, State } from '../store/index.tsx';
import { answeredBy, markAnswered } from './tap.ts';

export interface CommandEnv {
  state: Pick<State, 'threads' | 'queue'>;
  dispatch: Dispatch<Action>;
  deviceName: string;
  whileWorking: Prefs['whileWorking'];
}

const ok: CommandResult = { isOk: true };
const fail = (error: string): CommandResult => ({ isOk: false, error });

/**
 * A device's command, run through the same store action or host call the machine's own UI runs for it, so agents, schedules
 * and the action stream follow exactly as they do for a click here. Confirmations the UI asks for (push, PR) are the
 * device's to ask its own user; by the time a command arrives, its person already said yes.
 */
export async function runRemoteCommand(command: RemoteCommand, env: CommandEnv): Promise<CommandResult> {
  const { state, dispatch } = env;
  if (command.type === 'resolve') return resolve(command, env);
  if (command.type === 'create') {
    dispatch({ type: 'create', title: command.title, provider: command.provider, project: command.project, isLive: host.isDesktop, isBackground: true });
    return ok;
  }
  const thread = state.threads.find((t) => t.id === command.threadId);
  if (!thread) return fail('No such thread on this machine');
  switch (command.type) {
    case 'send':
      return send(thread, command.text, env);
    case 'interrupt':
      if (!thread.live?.isWorking) return fail('The agent isn’t working');
      dispatch({ type: 'interrupt', threadId: thread.id });
      return ok;
    case 'fork':
      dispatch({ type: 'fork', threadId: thread.id, point: command.point });
      return ok;
    case 'handoff':
      if (thread.providers[0] === command.to) return fail('The thread is already on that agent');
      dispatch({ type: 'handoff', threadId: thread.id, to: command.to, summary: handoffSummary(thread, command.to, undefined, null) });
      return ok;
    case 'rename':
      dispatch({ type: 'rename', threadId: thread.id, title: command.title });
      return ok;
    case 'edit-goal':
      dispatch({ type: 'edit-goal', threadId: thread.id, draft: { ...draftFrom(thread), goal: command.goal } });
      return ok;
    case 'pin':
      return pin(thread, command.isPinned, env);
    case 'settle':
      if ((thread.status === 'settled') !== command.isSettled) dispatch({ type: command.isSettled ? 'settle' : 'unsettle', threadId: thread.id });
      return ok;
    case 'schedule':
      return schedule(thread, command.action);
    case 'commit':
    case 'push':
    case 'open-pr':
      return ship(thread, command, dispatch);
  }
}

function resolve(command: Extract<RemoteCommand, { type: 'resolve' }>, { state, dispatch, deviceName }: CommandEnv): CommandResult {
  const by = answeredBy(command.queueId);
  if (by !== undefined) return fail(`Already answered on ${by}`);
  const item = state.queue.find((q) => q.id === command.queueId);
  if (!item) return fail('This is no longer waiting for an answer');
  // `operate` answers the agent; settling reviews, runs and collisions is the thread's own business (`manage`).
  if (item.kind !== 'approval' && item.kind !== 'question') return fail('Only approvals and questions can be answered from a device');
  if (item.kind === 'question' && !command.answers?.length) return fail('A question needs answers');
  // Before the dispatch: the store applies it on the next render, and a second answer can arrive before that.
  markAnswered(command.queueId, deviceName);
  dispatch({ type: 'answer', queueId: command.queueId, answers: command.answers });
  return ok;
}

/** The composer's path: queued behind a working agent per Settings › General › While the agent is working, otherwise sent now. */
function send(thread: Thread, text: string, { state, dispatch, whileWorking }: CommandEnv): CommandResult {
  const message = queuedMessage(text, { mentions: [], isCommand: false, typedSkills: [] });
  if (shouldQueue(thread, whileWorking, false)) dispatch({ type: 'queued-add', threadId: thread.id, message });
  else sendMessage(dispatch, state, thread, message);
  return ok;
}

/** The sidebar's pin toggle (mod Shift P), only when it changes something. */
function pin(thread: Thread, isPinned: boolean, { state, dispatch }: CommandEnv): CommandResult {
  const isPinnedNow = pinnedThreads(state.threads, thread.spaceId).some((t) => t.id === thread.id);
  if (isPinnedNow === isPinned) return ok;
  const lists = togglePin(state.threads, thread.spaceId, thread.id);
  if (!lists) return fail('Pinned is full; unpin a thread first');
  dispatch({ type: 'reorder', ...lists });
  return ok;
}

async function schedule(thread: Thread, action: Extract<RemoteCommand, { type: 'schedule' }>['action']): Promise<CommandResult> {
  const triggers = await host.schedule.list();
  if (!triggers.some((t) => t.threadId === thread.id)) return fail('This thread has no schedule');
  if (action === 'run') await host.schedule.runNow(thread.id);
  else if (action === 'remove') await host.schedule.remove(thread.id);
  else await host.schedule.setPaused(thread.id, action === 'pause');
  return ok;
}

/** The ship bar's calls, as the thread's profile's GitHub login, in the thread's own folder. */
async function ship(thread: Thread, command: Extract<RemoteCommand, { type: 'commit' | 'push' | 'open-pr' }>, dispatch: Dispatch<Action>): Promise<CommandResult> {
  const cwd = threadCwd(thread);
  if (!cwd) return fail('This thread has no folder on this machine');
  const githubUser = getProfiles().find((p) => p.id === thread.spaceId)?.github || undefined;
  if (command.type === 'commit') return { isOk: true, detail: await host.git.commit(cwd, command.message) };
  if (command.type === 'push') {
    await host.git.push(cwd, githubUser);
    return ok;
  }
  const url = await host.git.createPr(cwd, { title: command.title, body: command.body }, githubUser);
  const opened = openedPr(url, command.title);
  if (opened) dispatch({ type: 'prs-seen', threadId: thread.id, prs: [opened] });
  return { isOk: true, detail: url };
}
