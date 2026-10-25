import path from 'node:path';
import {
  spawnCommand,
  type CoreChild,
  type SpawnCommandOptions,
} from '@mochi/core/runClient';

const isWindows = process.platform === 'win32';

/** The shell when the user picked none and `$SHELL` is unset: PowerShell on Windows, zsh (macOS's default) or sh elsewhere. */
export function fallbackShell() {
  if (isWindows) return 'powershell.exe';
  return process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh';
}

/** `command` through your login shell (`-lc`), so it finds the same tools your terminal does; through cmd.exe on Windows, which has no login shell. Runs in Core. */
export function spawnShell(command: string, options: SpawnCommandOptions) {
  if (isWindows) return spawnCommand(command, [], { ...options, shell: true });
  return spawnCommand(
    process.env.SHELL || fallbackShell(),
    ['-lc', command],
    options,
  );
}

/**
 * How to spawn `file` with `args`. On Windows a bare name or an npm-installed tool's `.cmd` shim needs cmd.exe (Node refuses
 * to spawn `.cmd` directly since its April 2024 security releases), so those become one quoted command line run with `shell`.
 */
export function spawnable(
  file: string,
  args: string[],
  onWindows = isWindows,
): { file: string; args: string[]; shell?: true } {
  if (!onWindows || /\.exe$/i.test(file)) return { file, args };
  return {
    file: [file, ...args].map(quoteForCmd).join(' '),
    args: [],
    shell: true,
  };
}

export function spawnFile(
  file: string,
  args: string[],
  options: SpawnCommandOptions,
) {
  const target = spawnable(file, args);
  return spawnCommand(target.file, target.args, {
    ...options,
    shell: target.shell,
  });
}

/** Stops `child` and what it started: Core's runner kills the whole process tree, so no group or taskkill handling is left here. */
export function killTree(child: CoreChild) {
  if (!child.hasExited) child.kill();
}

/** A relative path with `/` separators, the form the renderer, git and file-collision checks compare on every platform. */
export const posixPath = (relative: string) =>
  relative.split(path.sep).join('/');

// Quotes for cmd.exe's own parsing only: `%VAR%` still expands inside quotes, so callers pass paths and fixed flags, never user text.
function quoteForCmd(arg: string) {
  return /^[\w\-.:\\/=@+]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '""')}"`;
}
