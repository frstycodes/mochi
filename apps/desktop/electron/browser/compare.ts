import { existsSync, lstatSync, symlinkSync, unlinkSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { CompareBase } from '@mochi/domain/host/types/browser';
import { devTarget, pickPort } from '../../src/terminal/lsof.ts';
import { worktreeRoot } from '@mochi/core/agents/config';
import { baseRef, localName } from '../git/branches.ts';
import { mainRepo, runGit, topLevel } from '../git/run.ts';
import { isFree, listeningPorts, runTargets } from '../ipc/ports.ts';
import { killTree, spawnShell } from '../platform.ts';
import type { CoreChild } from '@mochi/core/runClient';
import { userPath } from '@mochi/core/shellPath';

interface Session {
  dir: string;
  main: string;
  child: CoreChild | null;
}

const FIRST_COMPARE_PORT = 5400;
const BOOT_TIMEOUT_MS = 90_000;
const POLL_MS = 500;
const LOG_TAIL = 2000;

const sessions = new Map<string, Session>();

/**
 * Serves the thread's base branch next to the thread: reuses a dev server already running in the project's own checkout when that
 * checkout is on the base branch, else checks the base out into a temporary worktree and runs the project's dev script there.
 */
export async function startCompare(
  threadId: string,
  cwd: string,
  base?: string,
): Promise<CompareBase> {
  await stopCompare(threadId);
  const main = await mainRepo(cwd);
  const branch = base ?? (await baseRef(main));
  const checkedOut = (
    await runGit(main, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')
  ).trim();
  if (checkedOut === (await localName(main, branch))) {
    const [running] = await listeningPorts(main);
    if (running)
      return {
        origin: `http://localhost:${running.port}`,
        branch,
        isReused: true,
      };
  }

  const dir = join(worktreeRoot(), basename(main), `compare-${threadId}`);
  const session: Session = { dir, main, child: null };
  sessions.set(threadId, session);
  try {
    return await serve(threadId, session, cwd, branch);
  } catch (error) {
    if (sessions.get(threadId) === session) await stopCompare(threadId);
    throw error;
  }
}

async function serve(
  threadId: string,
  session: Session,
  cwd: string,
  branch: string,
): Promise<CompareBase> {
  const { dir, main } = session;
  if (!existsSync(dir)) {
    await mkdir(dirname(dir), { recursive: true });
    await runGit(main, ['worktree', 'add', '--detach', dir, branch]);
  }
  // GAP: borrows the project's installed deps; a base branch whose dependencies differ needs its own install.
  const deps = [
    join(main, 'node_modules'),
    join(await topLevel(cwd), 'node_modules'),
  ].find(existsSync);
  if (deps && !existsSync(join(dir, 'node_modules')))
    symlinkSync(deps, join(dir, 'node_modules'), 'junction');

  const target = devTarget(runTargets(dir));
  if (!target)
    throw new Error(
      `${branch} has no dev script (package.json "dev", "start", "serve" or "preview", or .claude/launch.json) to serve it with`,
    );
  const port =
    target.port ?? (await pickPort(FIRST_COMPARE_PORT, new Set(), isFree));
  const child = spawnShell(target.command, {
    cwd: dir,
    env: {
      ...process.env,
      PATH: await userPath(),
      PORT: String(port),
      BROWSER: 'none',
    },
  });
  session.child = child;
  let log = '';
  const keep = (chunk: Buffer) =>
    (log = (log + chunk.toString()).slice(-LOG_TAIL));
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);

  // Not every dev server honours PORT (Vite picks its own), so the port is whatever the process ends up listening on.
  const start = Date.now();
  while (Date.now() - start < BOOT_TIMEOUT_MS) {
    if (sessions.get(threadId) !== session)
      throw new Error('Compare was closed');
    if (child.hasExited)
      throw new Error(
        `\`${target.command}\` exited with ${child.exitCode}\n${log.trim()}`,
      );
    const [listening] = await listeningPorts(dir);
    if (listening)
      return {
        origin: `http://localhost:${listening.port}`,
        branch,
        isReused: false,
      };
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(
    `\`${target.command}\` opened no port within ${BOOT_TIMEOUT_MS / 1000}s\n${log.trim()}`,
  );
}

/** Stops the base's dev server and removes its temporary worktree. A reused server is left running. */
export async function stopCompare(threadId: string) {
  const session = sessions.get(threadId);
  if (!session) return;
  sessions.delete(threadId);
  killGroup(session.child);
  // Unlinked first so removing the worktree can never reach into the project's own node_modules.
  const deps = join(session.dir, 'node_modules');
  if (lstatSync(deps, { throwIfNoEntry: false })?.isSymbolicLink())
    unlinkSync(deps);
  await runGit(session.main, [
    'worktree',
    'remove',
    '--force',
    session.dir,
  ]).catch(() => {});
}

/** On quit: servers stop now; worktrees are reused by the next compare of the same thread, or pruned by git. */
export function stopAllCompares() {
  for (const session of sessions.values()) killGroup(session.child);
}

function killGroup(child: CoreChild | null) {
  if (child) killTree(child);
}
