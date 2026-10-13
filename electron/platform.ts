import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

const isWindows = process.platform === 'win32';

/** The shell when the user picked none and `$SHELL` is unset: PowerShell on Windows, zsh (macOS's default) or sh elsewhere. */
export function fallbackShell() {
  if (isWindows) return 'powershell.exe';
  return process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh';
}

/** `command` through your login shell (`-lc`), so it finds the same tools your terminal does; through cmd.exe on Windows, which has no login shell. */
export function spawnShell(command: string, options: SpawnOptions) {
  if (isWindows) return spawn(command, { ...options, shell: true, windowsHide: true });
  return spawn(process.env.SHELL || fallbackShell(), ['-lc', command], options);
}

/**
 * How to spawn `file` with `args`. On Windows a bare name or an npm-installed tool's `.cmd` shim needs cmd.exe (Node refuses
 * to spawn `.cmd` directly since its April 2024 security releases), so those become one quoted command line run with `shell`.
 */
export function spawnable(file: string, args: string[], onWindows = isWindows): { file: string; args: string[]; shell?: true } {
  if (!onWindows || /\.exe$/i.test(file)) return { file, args };
  return { file: [file, ...args].map(quoteForCmd).join(' '), args: [], shell: true };
}

export function spawnFile(file: string, args: string[], options: SpawnOptions) {
  const target = spawnable(file, args);
  return spawn(target.file, target.args, { ...options, shell: target.shell, windowsHide: true });
}

/**
 * Stops `child` and what it started. POSIX: its process group when it was spawned `detached` (it leads one), else just it.
 * Windows has no groups, and a `shell` child is cmd.exe with the real process under it, so the whole tree goes through taskkill.
 */
export function killTree(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return;
  if (isWindows) return void spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }).on('error', () => child.kill());
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill();
  }
}

// Quotes for cmd.exe's own parsing only: `%VAR%` still expands inside quotes, so callers pass paths and fixed flags, never user text.
function quoteForCmd(arg: string) {
  return /^[\w\-.:\\/=@+]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '""')}"`;
}
