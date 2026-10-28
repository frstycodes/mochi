import type { Dispatch } from 'react';
import type { Project } from '@mochi/domain/host/types/projects';
import { runPrAction } from '../git/prAction.ts';
import { worktreePath } from '../git/worktrees.ts';
import { threadCwd } from '../host/cwd.ts';
import { host } from '../host/index.ts';
import type {
  CommandResult,
  PrAction,
  ThreadOpCommand,
} from '../host/types/remote.ts';
import { firstPrompt, type Thread } from '../model.ts';
import { getProfiles } from '../profiles.ts';
import { triggerInput } from '../schedule/calls.ts';
import type { Action, State } from '../store/index.tsx';
import { canAttach } from '../store/threads.ts';

const ok: CommandResult = { isOk: true };
const fail = (error: string): CommandResult => ({ isOk: false, error });
const data = (value: NonNullable<CommandResult & { isOk: true }>['data']) =>
  ({ isOk: true, data: value }) satisfies CommandResult;

const THREAD_OP_TYPES = new Set<string>([
  'pr-status',
  'pr-review',
  'pr',
  'sync',
  'disk-usage',
  'schedules',
  'schedule-set',
  'attach-project',
  'ports',
  'port-kill',
  'rewind-preview',
] satisfies ThreadOpCommand['type'][]);

export const isThreadOp = (command: {
  type: string;
}): command is ThreadOpCommand => THREAD_OP_TYPES.has(command.type);

/** As the ship bar: the thread's profile's GitHub login here. */
export const githubUserOf = (thread: Pick<Thread, 'spaceId'>) =>
  getProfiles().find((p) => p.id === thread.spaceId)?.github || undefined;

/** Every trigger here, without the history a badge or the editor never reads. */
async function schedulesHere(state: State): Promise<CommandResult> {
  const triggers = await host.schedule.list();
  return data(
    triggers
      .filter((t) => state.threads.some((th) => th.id === t.threadId))
      .map(({ runs: _runs, seen: _seen, ...t }) => ({ ...t, runs: [] })),
  );
}

/**
 * A thread's own PR tab, worktree, schedule, project, dev servers and rewind preview, through the same host calls its screen
 * here makes. Each acts only on what the thread has: one of its PRs, its folder, a port listening in it.
 */
export async function runThreadOp(
  command: ThreadOpCommand,
  state: State,
  dispatch: Dispatch<Action>,
  projects: () => Promise<Project[]>,
): Promise<CommandResult> {
  if (command.type === 'schedules') return schedulesHere(state);
  const thread = state.threads.find((t) => t.id === command.threadId);
  if (!thread) return fail('No such thread on this machine');
  switch (command.type) {
    case 'schedule-set':
      return setSchedule(command, thread);
    case 'attach-project':
      return attachProject(command.project, thread, dispatch, projects);
    case 'rewind-preview': {
      // A files rewind restores the thread's own worktree; the project folder only rewinds its transcript.
      const cwd = worktreePath(thread.id);
      if (!cwd) return fail('This thread has no worktree of its own');
      return data(await host.git.rewindPreview(cwd, thread.id, command.n));
    }
  }
  const cwd = threadCwd(thread);
  if (!cwd) return fail('This thread has no folder on this machine');
  switch (command.type) {
    case 'pr-status':
    case 'pr-review':
    case 'pr':
      return prOp(command, thread, cwd);
    case 'sync':
      return data(await host.git.sync(cwd, thread.repo?.base));
    case 'disk-usage':
      return data({ bytes: await host.git.diskUsage(cwd) });
    case 'ports': {
      const [listing] = await host.ports.list([cwd]);
      return data(listing ?? { ports: [] });
    }
    case 'port-kill':
      return killPort(cwd, command.pid);
  }
}

async function setSchedule(
  command: Extract<ThreadOpCommand, { type: 'schedule-set' }>,
  thread: Thread,
): Promise<CommandResult> {
  const input = triggerInput(thread, {
    when: command.when,
    missed: command.missed,
    name: command.name.trim() || thread.title,
    prompt: command.prompt.trim() || firstPrompt(thread),
  });
  if (!input)
    return fail('This thread’s project folder isn’t on this computer');
  await host.schedule.set(input);
  return ok;
}

/** Add to project's move, into one of this profile's projects here by id: a device never names a folder. */
async function attachProject(
  projectId: string,
  thread: Thread,
  dispatch: Dispatch<Action>,
  projects: () => Promise<Project[]>,
): Promise<CommandResult> {
  const project = (await projects()).find(
    (p) => p.id === projectId && !p.isMissing,
  );
  if (!project) return fail('That project isn’t on this machine');
  if (thread.repo) return fail('This thread is already in a project');
  if (!canAttach(thread))
    return fail('Available once the agent finishes this turn');
  dispatch({
    type: 'attach-project',
    threadId: thread.id,
    project: project.path,
  });
  return ok;
}

/** Only a process the latest listing shows listening in the thread's folder (`host.ports.kill`'s own rule). */
async function killPort(cwd: string, pid: number): Promise<CommandResult> {
  const [listing] = await host.ports.list([cwd]);
  if (!listing || !('ports' in listing))
    return fail(listing?.error ?? 'Couldn’t list this thread’s servers');
  if (!listing.ports.some((p) => p.pid === pid))
    return fail('That process isn’t listening in this thread’s folder');
  await host.ports.kill(pid);
  return ok;
}

async function prOp(
  command: Extract<ThreadOpCommand, { type: 'pr-status' | 'pr-review' | 'pr' }>,
  thread: Thread,
  cwd: string,
): Promise<CommandResult> {
  const githubUser = githubUserOf(thread);
  if (command.type === 'pr-status') {
    const found = await host.git.pr(cwd, githubUser);
    return found ? data(found) : ok;
  }
  if (!(await isThreadPr(thread, cwd, command.number, githubUser)))
    return fail('That pull request isn’t this thread’s');
  if (command.type === 'pr')
    return pr(cwd, command.number, command.action, githubUser);
  const review = await host.git.prReview(cwd, command.number, githubUser);
  return review ? data(review) : fail('No such pull request');
}

/** One the thread recorded, or the one open on its branch before it has recorded any (the PR tab's own choices). */
async function isThreadPr(
  thread: Thread,
  cwd: string,
  number: number,
  githubUser: string | undefined,
) {
  if (thread.prs.some((p) => p.number === number)) return true;
  return (await host.git.pr(cwd, githubUser))?.number === number;
}

/** A reply or resolve names a review thread by its GitHub id, which could be any; only this PR's are the device's to touch. */
async function pr(
  cwd: string,
  number: number,
  action: PrAction,
  githubUser: string | undefined,
): Promise<CommandResult> {
  if (action.kind === 'reply' || action.kind === 'resolve') {
    const review = await host.git.prReview(cwd, number, githubUser);
    if (!review?.threads.some((t) => t.id === action.reviewThreadId))
      return fail('That review thread isn’t on this pull request');
  }
  await runPrAction(cwd, number, action, githubUser);
  return ok;
}
