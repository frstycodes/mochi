import { execFile, spawn } from 'node:child_process';
import { dirname, normalize, relative, resolve, sep } from 'node:path';
import { parseWorktrees } from '../../src/git/parse.ts';
import { userPath } from '@mochi/core/shellPath';

const ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1', GIT_EDITOR: 'true' };

/**
 * execFile, never a shell: args go to the binary verbatim. `okCodes` lists non-zero exits that still carry a result;
 * `stderr` resolves with what went to stderr instead, for tools that print their report there (`gh auth status`).
 */
export function run(
  cmd: 'git' | 'gh' | 'du',
  cwd: string,
  args: string[],
  { input, okCodes = [0], env, stderr: wantsStderr }: { input?: string; okCodes?: number[]; env?: Record<string, string>; stderr?: boolean } = {},
) {
  // A Finder-launched app gets launchd's PATH, which lacks Homebrew's `gh`; the login shell's PATH has it.
  return userPath().then((PATH) => new Promise<string>((done, fail) => {
    const child = execFile(cmd, args, { cwd, env: { ...ENV, PATH, ...env }, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error || (typeof error.code === 'number' && okCodes.includes(error.code))) return done(wantsStderr ? stderr : stdout);
      fail(new Error(stderr.trim() || error.message));
    });
    if (input !== undefined) child.stdin?.end(input);
  }));
}

/**
 * `run` for long commands that report progress (a clone): each line it prints, `\r` redraws included, goes to `onLine` as it
 * comes. On failure the error holds what it printed, progress bars left out.
 */
export function runStreaming(cmd: 'git' | 'gh', cwd: string, args: string[], onLine: (line: string) => void, env?: Record<string, string>) {
  return userPath().then((PATH) => new Promise<void>((done, fail) => {
    const child = spawn(cmd, args, { cwd, env: { ...ENV, PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    const printed: string[] = [];
    const line = (text: string) => {
      if (!text.trim()) return;
      onLine(text.trimEnd());
      if (!isProgress(text)) printed.push(text.trimEnd());
    };
    // A chunk can end mid-line; each stream keeps its unfinished line for the next chunk.
    const reader = () => {
      let rest = '';
      return (chunk: Buffer) => {
        const lines = (rest + chunk.toString()).split(/[\r\n]/);
        rest = lines.pop() ?? '';
        lines.forEach(line);
      };
    };
    child.stdout.on('data', reader());
    child.stderr.on('data', reader());
    child.on('error', fail);
    child.on('close', (code) => (code === 0 ? done() : fail(new Error(printed.slice(-20).join('\n') || `${cmd} exited with ${code}`))));
  }));
}

/** git's redrawn counters: "Receiving objects:  42% (420/1000)". */
const isProgress = (line: string) => /:\s+\d+% \(\d+\/\d+\)/.test(line);

export const runGit = (cwd: string, args: string[], options?: Parameters<typeof run>[3]) => run('git', cwd, ['-c', 'core.quotePath=false', ...args], options);

/** Every worktree of the repo at `top`, its main checkout included. git prints `C:/…` on Windows; paths come back the way the OS writes them. */
export async function listWorktrees(top: string) {
  return parseWorktrees(await runGit(top, ['worktree', 'list', '--porcelain'])).map((w) => ({ ...w, path: normalize(w.path) }));
}

/** The work tree's top level; throws when `cwd` is not inside a git work tree. */
export async function topLevel(cwd: string) {
  return (await runGit(resolve(cwd), ['rev-parse', '--show-toplevel'])).trim();
}

/** `file` relative to `top`; throws when it resolves outside it. */
export function inside(top: string, file: string) {
  const abs = resolve(top, file);
  if (!abs.startsWith(top + sep)) throw new Error(`${file} is outside the worktree`);
  return relative(top, abs);
}

// Worktrees share the main repo's common dir; worktree commands run from the main checkout.
export async function mainRepo(path: string) {
  const common = (await runGit(await topLevel(path), ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim();
  return dirname(common);
}
