import { execFile } from 'node:child_process';
import { relative, resolve, sep } from 'node:path';
import { userPath } from '../shellPath.ts';

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

export const runGit = (cwd: string, args: string[], options?: Parameters<typeof run>[3]) => run('git', cwd, ['-c', 'core.quotePath=false', ...args], options);

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
