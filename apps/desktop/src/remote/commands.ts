import type { Dispatch } from 'react';
import { openedPr } from '../git/prs.ts';
import { threadCwd } from '../host/cwd.ts';
import { host } from '../host/index.ts';
import type {
  CommandResult,
  MachineCatalog,
  RemoteCommand,
} from '../host/types/remote.ts';
import type { Project } from '@mochi/domain/host/types/projects';
import type { Thread } from '../model.ts';
import { getProfiles } from '../profiles.ts';
import {
  byRecentUse,
  cloneProject,
  createProject,
  loadProjects,
} from '../projects.ts';
import { rewindThread } from '../rewind/run.ts';
import { sideChatChoice } from '../runtime/controls.ts';
import {
  findSetting,
  settingsCatalog,
  type SettingSources,
  type SettingWrite,
} from '../settings/catalog.ts';
import { HARNESS_IDS } from '../settings/harnesses.ts';
import { getPrefs, setPrefs } from '../settings/prefs.ts';
import { askSideChat } from '../sidechat/ask.ts';
import { chatFor } from '../store/sidechat.ts';
import { closeShell, openShell, shellOf } from './terminals.ts';
import { handoffBlocker } from '../rewind/handoff.ts';
import { handOffHere } from '../rewind/runHandoff.ts';
import type { Action, State } from '../store/index.tsx';
import { storeCommand, type StoreCommand } from './storeCommands.ts';

export interface CommandEnv {
  state: State;
  dispatch: Dispatch<Action>;
  deviceName: string;
}

const ok: CommandResult = { isOk: true };

/** A store command's actions, here; a send's late drift verdict as the composer's would come. */
function applyStored(
  { result, actions, verdict }: StoreCommand,
  dispatch: Dispatch<Action>,
): CommandResult {
  for (const action of actions) dispatch(action);
  void verdict?.verdict.then(
    (v) =>
      v.kind !== 'off-goal' &&
      dispatch({
        type: 'drift-verdict',
        threadId: verdict.threadId,
        text: verdict.text,
        drift: v.kind,
        reason: v.reason,
      }),
  );
  return result;
}
const fail = (error: string): CommandResult => ({ isOk: false, error });

/**
 * A device's command, run through the same store action or host call the machine's own UI runs for it, so agents, schedules
 * and the action stream follow exactly as they do for a click here. Confirmations the UI asks for (push, PR) are the
 * device's to ask its own user; by the time a command arrives, its person already said yes.
 */
export async function runRemoteCommand(
  command: RemoteCommand,
  env: CommandEnv,
): Promise<CommandResult> {
  const { state, dispatch } = env;
  const stored = storeCommand(command, state, env.deviceName);
  if (stored) return applyStored(stored, dispatch);
  if (command.type === 'catalog')
    return { isOk: true, data: await catalog(state) };
  if (command.type === 'settings')
    return { isOk: true, data: writableValues(await machineSources(state)) };
  if (command.type === 'projects')
    return { isOk: true, data: (await projectsHere(state)).map(withSmallIcon) };
  if (command.type === 'add-project' || command.type === 'clone-project')
    return addProject(command, state);
  if (command.type === 'create') return create(command, env);
  if (command.type === 'setting') return setting(command, env);
  const thread = state.threads.find(
    (t) => t.id === (command as { threadId?: string }).threadId,
  );
  if (!thread) return fail('No such thread on this machine');
  switch (command.type) {
    case 'handoff': {
      const blocker = handoffBlocker(thread, command.to);
      if (blocker) return fail(blocker);
      handOffHere(thread, dispatch, command.to);
      return ok;
    }
    case 'schedule':
      return schedule(thread, command.action);
    case 'commit':
    case 'push':
    case 'open-pr':
      return ship(thread, command, dispatch);
    case 'rewind': {
      const done = await rewindThread(
        state,
        dispatch,
        thread.id,
        command.point,
        command.mode,
      );
      if (!done) return fail('There is nothing to rewind to there');
      return 'error' in done
        ? fail(
            done.description
              ? `${done.error}: ${done.description}`
              : done.error,
          )
        : ok;
    }
    case 'side-chat':
      return sideChat(thread, command.text, env);
  }
  const cwd = threadCwd(thread);
  if (!cwd) return fail('This thread has no folder on this machine');
  return command.type.startsWith('terminal-')
    ? terminal(thread, cwd, command as TerminalCommand)
    : code(thread, cwd, command as CodeCommand);
}

type CodeCommand = Extract<
  RemoteCommand,
  { type: 'diff' | 'checkpoint-diff' | 'change' | 'files' | 'read-file' }
>;
type TerminalCommand = Extract<RemoteCommand, { type: `terminal-${string}` }>;

const MAX_FILES = 10_000;
const MAX_FILE_CHARS = 512 * 1024;

/** The Changes and Files tabs' host calls, in the thread's folder as this machine resolves it. */
async function code(
  thread: Thread,
  cwd: string,
  command: CodeCommand,
): Promise<CommandResult> {
  switch (command.type) {
    case 'diff':
      return {
        isOk: true,
        data: await host.git.diff(cwd, command.scope, thread.repo?.base),
      };
    case 'checkpoint-diff':
      return {
        isOk: true,
        data: await host.git.checkpointDiff(cwd, thread.id, command.n),
      };
    case 'change':
      await host.git[command.action](cwd, command.target);
      return ok;
    case 'files': {
      const paths = await host.fs.list(cwd);
      return {
        isOk: true,
        data: {
          paths: paths.slice(0, MAX_FILES),
          isTruncated: paths.length > MAX_FILES,
        },
      };
    }
    case 'read-file': {
      const file = await host.fs.read(cwd, command.path);
      if (file.kind === 'binary')
        return fail('This is a binary file; open it on that computer');
      if (file.text.length > MAX_FILE_CHARS)
        return fail(
          'This file is too large to show here; open it on that computer',
        );
      return { isOk: true, data: { text: file.text } };
    }
  }
}

function terminal(
  thread: Thread,
  cwd: string,
  command: TerminalCommand,
): Promise<CommandResult> | CommandResult {
  if (command.type === 'terminal-open')
    return openShell(thread.id, cwd, command.cols, command.rows).then(
      (terminalId) => ({ isOk: true, data: { terminalId } }),
    );
  const shell = shellOf(command.terminalId, thread.id);
  if (!shell) return fail('That terminal is closed');
  switch (command.type) {
    case 'terminal-write':
      return host.pty.write(command.terminalId, command.data).then(() => ok);
    case 'terminal-resize':
      return host.pty
        .resize(command.terminalId, command.cols, command.rows)
        .then(() => ok);
    case 'terminal-close':
      closeShell(command.terminalId);
      return ok;
  }
}

/** Where a new thread can start here: this profile's projects as the picker lists them, by id, and each harness's models. */
async function catalog(state: State): Promise<MachineCatalog> {
  const settings = await host.settings.get();
  const models = await Promise.all(
    HARNESS_IDS.map(
      async (h) =>
        [h, await host.agent.models(h, state.spaceId).catch(() => [])] as const,
    ),
  );
  return {
    projects: (await projectsHere(state))
      .filter((p) => !p.isMissing)
      .map((p) => ({ ref: p.id, name: p.name })),
    models: Object.fromEntries(models),
    defaults: {
      claude: settings.harnesses.claude.model,
      codex: settings.harnesses.codex.model,
    },
  };
}

/** `useProjects` outside React: the registry, most recently used first. */
async function projectsHere(state: State) {
  const threads = state.threads.filter((t) => t.spaceId === state.spaceId);
  return byRecentUse(await loadProjects(state.spaceId, threads), threads);
}

/** A favicon past this stays home: a list of projects shouldn't cost a device megabytes. */
const MAX_REMOTE_ICON_CHARS = 64 * 1024;
const withSmallIcon = (project: Project): Project =>
  project.icon && project.icon.url.length > MAX_REMOTE_ICON_CHARS
    ? { ...project, icon: null }
    : project;

/** Add project's own calls, into this computer's projects folder as this profile's GitHub login. */
async function addProject(
  command: Extract<RemoteCommand, { type: 'add-project' | 'clone-project' }>,
  state: State,
): Promise<CommandResult> {
  try {
    const project =
      command.type === 'clone-project'
        ? await cloneProject(state.spaceId, command.source)
        : await createProject(state.spaceId, command.name, command.publish);
    return { isOk: true, data: { ref: project.id, name: project.name } };
  } catch (error) {
    return fail((error as Error).message);
  }
}

/** The new-thread page's start, in the background. A project has to be one `catalog` listed, by id: a device never names a folder. */
async function create(
  command: Extract<RemoteCommand, { type: 'create' }>,
  { state, dispatch }: CommandEnv,
): Promise<CommandResult> {
  const project =
    command.project === null
      ? null
      : (await projectsHere(state)).find(
          (p) => p.id === command.project && !p.isMissing,
        );
  if (project === undefined) return fail('That project isn’t on this machine');
  dispatch({
    type: 'create',
    title: command.title,
    provider: command.provider,
    project: project?.path ?? null,
    ...(command.controls && { controls: command.controls }),
    ...(command.images && { images: command.images }),
    isLive: host.isDesktop,
    isBackground: true,
  });
  return ok;
}

/**
 * What a device may change: prefs, quiet hours and main's settings. Devices, accounts, profiles and the theme change on this
 * computer only, and the demo switch reloads the app.
 */
const isRemoteWrite = (
  write: SettingWrite,
): write is Extract<SettingWrite, { to: 'prefs' | 'quiet' | 'host' }> =>
  (write.to === 'prefs' && !('demoData' in write.patch)) ||
  write.to === 'quiet' ||
  write.to === 'host';

/** Each row a device may change, with its value here: a row's value written back shows where it would land. */
function writableValues(sources: SettingSources) {
  return Object.fromEntries(
    settingsCatalog().flatMap((row) => {
      const value = row.read(sources);
      const write = value === undefined ? null : row.write(value, sources);
      return value !== undefined && write && isRemoteWrite(write)
        ? [[row.key, value]]
        : [];
    }),
  );
}

/** What this machine's settings read from, as far as a device can change them. */
async function machineSources(state: State): Promise<SettingSources> {
  return {
    prefs: getPrefs(),
    theme: '',
    quiet: state.notifications.quiet,
    host: await host.settings.get(),
  };
}

/** Side chats a device asks live in their own tab here, beside the thread's own. */
export const REMOTE_SIDE_CHAT_TAB = 'remote';

/** Asked now; the answer streams to the device with the store. */
async function sideChat(
  thread: Thread,
  text: string,
  { state, dispatch }: CommandEnv,
): Promise<CommandResult> {
  const chat = chatFor(state, thread.id, REMOTE_SIDE_CHAT_TAB);
  const model =
    chat.model ?? sideChatChoice((await host.settings.get()).sideChatModel);
  void askSideChat(thread, REMOTE_SIDE_CHAT_TAB, chat, model, text, dispatch);
  return ok;
}

/** A Settings row's value, written where Settings writes it, when it's one a device may change (`isRemoteWrite`). */
async function setting(
  { key, value }: Extract<RemoteCommand, { type: 'setting' }>,
  { state, dispatch }: CommandEnv,
): Promise<CommandResult> {
  const row = findSetting(settingsCatalog(), key);
  if (!row) return fail(`No setting ${key}`);
  const sources = await machineSources(state);
  const write = row.write(value, sources);
  if (!write) return fail(`“${value}” isn’t a value of ${row.label}`);
  if (!isRemoteWrite(write))
    return fail(`${row.label} can only be changed on that computer`);
  switch (write.to) {
    case 'prefs':
      setPrefs(write.patch);
      return ok;
    case 'quiet':
      dispatch({
        type: 'notify-quiet',
        quiet: { ...state.notifications.quiet, ...write.patch },
      });
      return ok;
    case 'host':
      await host.settings.set(write.patch);
      return ok;
  }
}

async function schedule(
  thread: Thread,
  action: Extract<RemoteCommand, { type: 'schedule' }>['action'],
): Promise<CommandResult> {
  const triggers = await host.schedule.list();
  if (!triggers.some((t) => t.threadId === thread.id))
    return fail('This thread has no schedule');
  if (action === 'run') await host.schedule.runNow(thread.id);
  else if (action === 'remove') await host.schedule.remove(thread.id);
  else await host.schedule.setPaused(thread.id, action === 'pause');
  return ok;
}

/** The ship bar's calls, as the thread's profile's GitHub login, in the thread's own folder. */
async function ship(
  thread: Thread,
  command: Extract<RemoteCommand, { type: 'commit' | 'push' | 'open-pr' }>,
  dispatch: Dispatch<Action>,
): Promise<CommandResult> {
  const cwd = threadCwd(thread);
  if (!cwd) return fail('This thread has no folder on this machine');
  const githubUser =
    getProfiles().find((p) => p.id === thread.spaceId)?.github || undefined;
  if (command.type === 'commit')
    return { isOk: true, detail: await host.git.commit(cwd, command.message) };
  if (command.type === 'push') {
    await host.git.push(cwd, githubUser);
    return ok;
  }
  const url = await host.git.createPr(
    cwd,
    { title: command.title, body: command.body },
    githubUser,
  );
  const opened = openedPr(url, command.title);
  if (opened)
    dispatch({ type: 'prs-seen', threadId: thread.id, prs: [opened] });
  return { isOk: true, detail: url };
}
