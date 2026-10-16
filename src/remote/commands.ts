import type { Dispatch } from 'react';
import { queuedMessage, sendMessage, shouldQueue } from '../chat/outbox.ts';
import { openedPr } from '../git/prs.ts';
import { draftFrom } from '../goals/edit.ts';
import { threadCwd } from '../host/cwd.ts';
import { host } from '../host/index.ts';
import type { CommandResult, MachineCatalog, RemoteCommand } from '../host/types/remote.ts';
import type { Thread } from '../model.ts';
import { reviewNote } from '../git/files.ts';
import { getProfiles } from '../profiles.ts';
import { projectName, projectRef, savedProjects } from '../projects.ts';
import { rewindThread } from '../rewind/run.ts';
import { initialControls, sideChatChoice } from '../runtime/controls.ts';
import { findSetting, settingsCatalog, type SettingSources } from '../settings/catalog.ts';
import { HARNESS_IDS } from '../settings/harnesses.ts';
import { getPrefs, setPrefs } from '../settings/prefs.ts';
import { askSideChat } from '../sidechat/ask.ts';
import { chatFor } from '../store/sidechat.ts';
import { closeShell, openShell, readShell, shellOf } from './terminals.ts';
import { pinnedThreads, togglePin } from '../reorder.ts';
import { handoffSummary } from '../rewind/handoff.ts';
import type { Prefs } from '../settings/prefs.ts';
import type { Action, State } from '../store/index.tsx';
import { answeredBy, markAnswered } from './tap.ts';

export interface CommandEnv {
  state: State;
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
  if (command.type === 'catalog') return { isOk: true, data: await catalog(state) };
  if (command.type === 'create') return create(command, env);
  if (command.type === 'setting') return setting(command, env);
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
    case 'rewind': {
      const done = await rewindThread(state, dispatch, thread.id, command.point, command.mode);
      if (!done) return fail('There is nothing to rewind to there');
      return 'error' in done ? fail(done.description ? `${done.error}: ${done.description}` : done.error) : ok;
    }
    case 'side-chat':
      return sideChat(thread, command.text, env);
    case 'delete':
      dispatch({ type: 'delete', threadIds: [thread.id] });
      return ok;
    case 'comment':
      dispatch({
        type: 'say',
        threadId: thread.id,
        entry: { who: 'you', kind: 'message', text: reviewNote(command.path, command.side, command.line, command.text) },
      });
      return ok;
  }
  const cwd = threadCwd(thread);
  if (!cwd) return fail('This thread has no folder on this machine');
  return command.type.startsWith('terminal-') ? terminal(thread, cwd, command as TerminalCommand) : code(thread, cwd, command as CodeCommand);
}

type CodeCommand = Extract<RemoteCommand, { type: 'diff' | 'checkpoint-diff' | 'change' | 'files' | 'read-file' }>;
type TerminalCommand = Extract<RemoteCommand, { type: `terminal-${string}` }>;

const MAX_FILES = 10_000;
const MAX_FILE_CHARS = 512 * 1024;

/** The Changes and Files tabs' host calls, in the thread's folder as this machine resolves it. */
async function code(thread: Thread, cwd: string, command: CodeCommand): Promise<CommandResult> {
  switch (command.type) {
    case 'diff':
      return { isOk: true, data: await host.git.diff(cwd, command.scope, thread.repo?.base) };
    case 'checkpoint-diff':
      return { isOk: true, data: await host.git.checkpointDiff(cwd, thread.id, command.n) };
    case 'change':
      await host.git[command.action](cwd, command.target);
      return ok;
    case 'files': {
      const paths = await host.fs.list(cwd);
      return { isOk: true, data: { paths: paths.slice(0, MAX_FILES), isTruncated: paths.length > MAX_FILES } };
    }
    case 'read-file': {
      const file = await host.fs.read(cwd, command.path);
      if (file.kind === 'binary') return fail('This is a binary file; open it on that computer');
      if (file.text.length > MAX_FILE_CHARS) return fail('This file is too large to show here; open it on that computer');
      return { isOk: true, data: { text: file.text } };
    }
  }
}

function terminal(thread: Thread, cwd: string, command: TerminalCommand): Promise<CommandResult> | CommandResult {
  if (command.type === 'terminal-open')
    return openShell(thread.id, cwd, command.cols, command.rows).then((terminalId) => ({ isOk: true, data: { terminalId } }));
  const shell = shellOf(command.terminalId, thread.id);
  if (!shell) return fail('That terminal is closed');
  switch (command.type) {
    case 'terminal-read':
      return { isOk: true, data: readShell(shell, command.after) };
    case 'terminal-write':
      return host.pty.write(command.terminalId, command.data).then(() => ok);
    case 'terminal-resize':
      return host.pty.resize(command.terminalId, command.cols, command.rows).then(() => ok);
    case 'terminal-close':
      closeShell(command.terminalId);
      return ok;
  }
}

/** Where a new thread can start here: this profile's projects as the picker lists them, and each harness's models. */
async function catalog(state: State): Promise<MachineCatalog> {
  const settings = await host.settings.get();
  const models = await Promise.all(HARNESS_IDS.map(async (h) => [h, await host.agent.models(h, state.spaceId).catch(() => [])] as const));
  return {
    projects: machineProjects(state).map((ref) => ({ ref, name: projectName(ref) })),
    models: Object.fromEntries(models),
    defaults: { claude: settings.harnesses.claude.model, codex: settings.harnesses.codex.model },
  };
}

/** `useRecentProjects` outside React: saved folders first, then those of the profile's threads, newest first. */
function machineProjects(state: State) {
  const threads = state.threads.filter((t) => t.spaceId === state.spaceId).sort((a, b) => b.startedAt - a.startedAt);
  return [...new Set([...savedProjects(state.spaceId), ...threads.flatMap((t) => (t.repo ? [projectRef(t.repo)!] : []))])];
}

/** The new-thread page's start, in the background. A project has to be one `catalog` listed: a device never names a folder. */
function create(command: Extract<RemoteCommand, { type: 'create' }>, { state, dispatch }: CommandEnv): CommandResult {
  if (command.project !== null && !machineProjects(state).includes(command.project)) return fail('That project isn’t on this machine');
  const controls = command.model === undefined ? undefined : initialControls(command.provider, command.model);
  dispatch({
    type: 'create',
    title: command.title,
    provider: command.provider,
    project: command.project,
    ...(controls && { controls }),
    isLive: host.isDesktop,
    isBackground: true,
  });
  return ok;
}

/** Side chats a device asks live in their own tab here, beside the thread's own. */
export const REMOTE_SIDE_CHAT_TAB = 'remote';

/** Asked now; the answer streams to the device with the store. */
async function sideChat(thread: Thread, text: string, { state, dispatch }: CommandEnv): Promise<CommandResult> {
  const chat = chatFor(state, thread.id, REMOTE_SIDE_CHAT_TAB);
  const model = chat.model ?? sideChatChoice((await host.settings.get()).sideChatModel);
  void askSideChat(thread, REMOTE_SIDE_CHAT_TAB, chat, model, text, dispatch);
  return ok;
}

/**
 * A Settings row's value, written where Settings writes it. Only what stays on this machine: Devices, accounts, profiles and
 * the theme are changed here only, and the demo switch reloads the app.
 */
async function setting({ key, value }: Extract<RemoteCommand, { type: 'setting' }>, { state, dispatch }: CommandEnv): Promise<CommandResult> {
  const row = findSetting(settingsCatalog(), key);
  if (!row) return fail(`No setting ${key}`);
  const sources: SettingSources = { prefs: getPrefs(), theme: '', quiet: state.notifications.quiet, host: await host.settings.get() };
  const write = row.write(value, sources);
  if (!write) return fail(`“${value}” isn’t a value of ${row.label}`);
  const refused = fail(`${row.label} can only be changed on that computer`);
  switch (write.to) {
    case 'prefs':
      if ('demoData' in write.patch) return refused;
      setPrefs(write.patch);
      return ok;
    case 'quiet':
      dispatch({ type: 'notify-quiet', quiet: { ...state.notifications.quiet, ...write.patch } });
      return ok;
    case 'host':
      await host.settings.set(write.patch);
      return ok;
    default:
      return refused;
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
