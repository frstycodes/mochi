import { access, constants, cp, readdir, readFile } from 'node:fs/promises';
import { basename, join, matchesGlob } from 'node:path';
import type {
  SetupChoice,
  SetupStep,
  WorktreeSetup,
} from '../../../../apps/desktop/src/host/types/agent.ts';
import {
  killTree,
  spawnFile,
  spawnShell,
} from '../../../../apps/desktop/electron/platform.ts';
import { userPath } from '../shellPath.ts';
import { runGit } from './run.ts';

export interface SetupRun {
  /** The project checkout the worktree was made from. */
  root: string;
  /** The new worktree. */
  dir: string;
  /** Patterns from Settings › Git and worktrees; the project's `.worktreeinclude` adds to them. */
  include: string;
  /** The project's setup command from Settings › Git and worktrees, if any. */
  command?: string;
  emit: (setup: WorktreeSetup) => void;
  /** After a failed step; never resolves for a setup nobody can answer, so those pass `() => Promise.resolve('skip')`. */
  choose: () => Promise<SetupChoice>;
  signal: AbortSignal;
}

/**
 * Prepares a new worktree before the agent's first turn: copies the project's ignored local files, installs dependencies from
 * the lockfile with the project's own package manager, then runs the project's setup command. A failed step waits for Retry or
 * Skip setup; an abort stops the running command and ends the setup `cancelled`. Resolves with the final status.
 */
export async function prepareWorktree(
  run: SetupRun,
): Promise<WorktreeSetup['status']> {
  const planned = await planSetup(run);
  if (!planned.length) return 'ready';
  const setup: WorktreeSetup = {
    status: 'running',
    startedAt: Date.now(),
    steps: planned.map(({ step }) => step),
  };
  const emit = throttle(() => run.emit(structuredClone(setup)));
  const finish = (status: WorktreeSetup['status']) => {
    setup.status = status;
    setup.endedAt = Date.now();
    for (const s of setup.steps)
      if (s.status === 'pending' || s.status === 'running')
        s.status = 'skipped';
    emit.now();
    return status;
  };
  emit.now();
  for (let i = 0; i < planned.length; i++) {
    const step = setup.steps[i];
    if (run.signal.aborted) return finish('cancelled');
    Object.assign(step, {
      status: 'running',
      startedAt: Date.now(),
      endedAt: undefined,
      output: undefined,
      exitCode: undefined,
    });
    emit.now();
    const ok = await planned[i]
      .run(step, emit, run.signal)
      .catch((error: Error) => {
        step.output = error.message;
        return false;
      });
    step.endedAt = Date.now();
    if (run.signal.aborted) return finish('cancelled');
    if (ok) {
      step.status = 'done';
      continue;
    }
    step.status = 'failed';
    setup.status = 'failed';
    emit.now();
    const choice = await Promise.race([run.choose(), aborted(run.signal)]);
    if (choice === 'abort') return finish('cancelled');
    if (choice === 'skip') return finish('skipped');
    setup.status = 'running';
    i--;
  }
  return finish('ready');
}

type Planned = {
  step: SetupStep;
  run: (
    step: SetupStep,
    emit: Throttled,
    signal: AbortSignal,
  ) => Promise<boolean>;
};

async function planSetup({
  root,
  dir,
  include,
  command,
}: SetupRun): Promise<Planned[]> {
  const steps: Planned[] = [];
  const files = await includedFiles(root, [
    ...includePatterns(include),
    ...includePatterns(
      await readFile(join(root, '.worktreeinclude'), 'utf8').catch(() => ''),
    ),
  ]);
  if (files.length) {
    steps.push({
      step: {
        id: 'copy',
        label: `Copy ${listNames(files)}`,
        status: 'pending',
      },
      run: async (step) => {
        // A file the agent already made in the worktree is kept.
        for (const file of files)
          await cp(join(root, file), join(dir, file), {
            recursive: true,
            force: false,
            errorOnExist: false,
          });
        step.output = files.join('\n');
        return true;
      },
    });
  }
  const install = installCommand(new Set(await listRoot(dir)));
  if (install)
    steps.push(
      commandStep(
        'install',
        `Install dependencies with ${install.manager}`,
        install.argv,
        root,
        dir,
      ),
    );
  const script =
    command ??
    ((await isFile(join(dir, MOCHI_SETUP_SCRIPT)))
      ? `bash ${MOCHI_SETUP_SCRIPT}`
      : undefined);
  if (script)
    steps.push(commandStep('script', 'Run setup command', script, root, dir));
  return steps;
}

/** A project's own setup script, run when Settings › Git and worktrees has no command for the project. */
export const MOCHI_SETUP_SCRIPT = '.mochi/setup.sh';

function commandStep(
  id: string,
  label: string,
  command: string[] | string,
  root: string,
  dir: string,
): Planned {
  return {
    step: {
      id,
      label,
      command: typeof command === 'string' ? command : command.join(' '),
      status: 'pending',
    },
    run: async (step, emit, signal) => {
      const env = {
        ...process.env,
        PATH: await userPath(),
        MOCHI_ROOT_PATH: root,
        MOCHI_WORKTREE_PATH: dir,
      };
      const exitCode = await runCommand(command, dir, env, signal, (chunk) => {
        step.output = tail((step.output ?? '') + chunk);
        emit();
      });
      step.exitCode = exitCode;
      return exitCode === 0;
    },
  };
}

/**
 * The install for the lockfile at the worktree's top level, in the manager's no-surprises mode: it installs what the lockfile
 * says or fails. pnpm links from its global store (`--prefer-offline` skips the registry for what the store holds), so a
 * worktree of a project you've installed before takes seconds.
 */
export function installCommand(
  files: ReadonlySet<string>,
): { manager: string; argv: string[] } | undefined {
  if (files.has('pnpm-lock.yaml'))
    return {
      manager: 'pnpm',
      argv: ['pnpm', 'install', '--frozen-lockfile', '--prefer-offline'],
    };
  if (files.has('bun.lock') || files.has('bun.lockb'))
    return { manager: 'bun', argv: ['bun', 'install', '--frozen-lockfile'] };
  // Yarn 2+ (Berry) has a .yarnrc.yml and spells it --immutable; Yarn 1 doesn't know that flag.
  if (files.has('yarn.lock'))
    return {
      manager: 'yarn',
      argv: files.has('.yarnrc.yml')
        ? ['yarn', 'install', '--immutable']
        : ['yarn', 'install', '--frozen-lockfile'],
    };
  if (files.has('package-lock.json'))
    return { manager: 'npm', argv: ['npm', 'ci'] };
  if (files.has('uv.lock'))
    return { manager: 'uv', argv: ['uv', 'sync', '--frozen'] };
  if (files.has('poetry.lock'))
    return { manager: 'Poetry', argv: ['poetry', 'install'] };
  if (files.has('Gemfile.lock'))
    return { manager: 'Bundler', argv: ['bundle', 'install'] };
  if (files.has('go.sum'))
    return { manager: 'Go', argv: ['go', 'mod', 'download'] };
  if (files.has('Cargo.lock'))
    return { manager: 'Cargo', argv: ['cargo', 'fetch', '--locked'] };
}

/** Patterns split by commas or lines; blank lines and `#` comments dropped. */
export function includePatterns(text: string) {
  return text
    .split(/[\n,]/)
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith('#'));
}

/**
 * Whether gitignore-style `patterns` take `path` (relative, `/`-separated, a trailing `/` for a folder): a pattern without a
 * slash matches the name at any depth, one with a slash matches from the top, `!` takes a match back, the last match wins.
 */
export function matchesInclude(path: string, patterns: string[]) {
  const isDir = path.endsWith('/');
  const clean = path.replace(/\/$/, '');
  let isIncluded = false;
  for (const raw of patterns) {
    const isNegated = raw.startsWith('!');
    let pattern = isNegated ? raw.slice(1) : raw;
    if (pattern.endsWith('/')) {
      if (!isDir) continue;
      pattern = pattern.slice(0, -1);
    }
    const isAnchored = pattern.includes('/');
    const hit = isAnchored
      ? matchesGlob(clean, pattern.replace(/^\//, ''))
      : matchesGlob(basename(clean), pattern);
    if (hit) isIncluded = !isNegated;
  }
  return isIncluded;
}

// Only ignored files: a tracked file is already in the worktree, and copying an ignored one can never end up in a commit.
// `--directory` lists a wholly ignored folder (node_modules/) as one entry instead of walking it.
async function includedFiles(root: string, patterns: string[]) {
  if (!patterns.length) return [];
  const ignored = await runGit(root, [
    'ls-files',
    '-z',
    '--others',
    '--ignored',
    '--exclude-standard',
    '--directory',
    '--no-empty-directory',
  ]).catch(() => '');
  return ignored
    .split('\0')
    .filter((p) => p && matchesInclude(p, patterns))
    .map((p) => p.replace(/\/$/, ''));
}

const listRoot = (dir: string) => readdir(dir).catch(() => []);

const isFile = (path: string) =>
  access(path, constants.R_OK).then(
    () => true,
    () => false,
  );

function listNames(files: string[]) {
  const shown = files.slice(0, 3).join(', ');
  return files.length > 3 ? `${shown} and ${files.length - 3} more` : shown;
}

/** Runs in Core, which stops the whole process tree on an abort (pnpm's lifecycle scripts). A string runs through the shell. */
function runCommand(
  command: string[] | string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  onOutput: (chunk: string) => void,
) {
  return new Promise<number>((resolve, reject) => {
    const options = { cwd, env };
    const child =
      typeof command === 'string'
        ? spawnShell(command, options)
        : spawnFile(command[0], command.slice(1), options);
    const stop = () => killTree(child);
    signal.addEventListener('abort', stop, { once: true });
    child.stdout?.setEncoding('utf8').on('data', onOutput);
    child.stderr?.setEncoding('utf8').on('data', onOutput);
    child.on('error', (error: NodeJS.ErrnoException) => {
      signal.removeEventListener('abort', stop);
      reject(
        error.code === 'ENOENT'
          ? new Error(
              `${typeof command === 'string' ? command.split(' ')[0] : command[0]} isn't installed or isn't on your PATH`,
            )
          : error,
      );
    });
    child.on('close', (code) => {
      signal.removeEventListener('abort', stop);
      resolve(code ?? 1);
    });
  });
}

const OUTPUT_CHARS = 16_000;
const tail = (text: string) =>
  text.length > OUTPUT_CHARS ? text.slice(-OUTPUT_CHARS) : text;

const aborted = (signal: AbortSignal) =>
  new Promise<'abort'>((resolve) =>
    signal.aborted
      ? resolve('abort')
      : signal.addEventListener('abort', () => resolve('abort'), {
          once: true,
        }),
  );

type Throttled = (() => void) & { now: () => void };

// Install output arrives in bursts of hundreds of lines; the renderer needs a few updates a second, not one per line.
const EMIT_MS = 250;

function throttle(fn: () => void): Throttled {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const later = () => {
    timer ??= setTimeout(() => {
      timer = undefined;
      fn();
    }, EMIT_MS);
  };
  return Object.assign(later, {
    now: () => {
      clearTimeout(timer);
      timer = undefined;
      fn();
    },
  });
}
