import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

/** Every thread worktree lives here, never inside the project, so the project's own `git status` stays clean. */
export const WORKTREE_ROOT = join(homedir(), '.harness', 'worktrees');

// GAP: a Finder-launched app gets launchd's PATH, which lacks Homebrew; `gh` then fails with ENOENT. Fine under `pnpm electron:dev`.
const ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1', GIT_EDITOR: 'true' };

/** execFile, never a shell: args go to the binary verbatim. `okCodes` lists non-zero exits that still carry a result. */
export function run(cmd: 'git' | 'gh' | 'du', cwd: string, args: string[], { input, okCodes = [0], env }: { input?: string; okCodes?: number[]; env?: Record<string, string> } = {}) {
  return new Promise<string>((done, fail) => {
    const child = execFile(cmd, args, { cwd, env: { ...ENV, ...env }, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error || (typeof error.code === 'number' && okCodes.includes(error.code))) return done(stdout);
      fail(new Error(stderr.trim() || error.message));
    });
    if (input !== undefined) child.stdin?.end(input);
  });
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

export function insideWorktreeRoot(path: string) {
  const abs = resolve(path);
  if (!abs.startsWith(WORKTREE_ROOT + sep)) throw new Error(`${path} is not a Harness worktree`);
  return abs;
}
