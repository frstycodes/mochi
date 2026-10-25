import { execFile } from 'node:child_process';

// No `electron` import: Core and git/run.ts use this, and their tests run under plain node.

let pathLookup: Promise<string> | undefined;

/** Memoized for the app's lifetime: a PATH change in the user's shell needs a Harness restart. */
export function userPath(): Promise<string> {
  pathLookup ??= readLoginShellPath().catch(() => process.env.PATH ?? '');
  return pathLookup;
}

// An interactive login shell, because version managers (mise, nvm) usually activate in .zshrc, not .zprofile.
// The command is a constant; markers cut away whatever the rc files print.
function readLoginShellPath(): Promise<string> {
  if (process.platform === 'win32')
    return Promise.resolve(process.env.PATH ?? '');
  const shell = process.env.SHELL || '/bin/zsh';
  return new Promise((resolve, reject) =>
    execFile(
      shell,
      ['-ilc', 'printf "__HARNESS_PATH__%s__HARNESS_PATH__" "$PATH"'],
      { timeout: 5000 },
      (error, stdout) => {
        const path = stdout.match(/__HARNESS_PATH__(.*)__HARNESS_PATH__/)?.[1];
        if (path) resolve(path);
        else reject(error ?? new Error('login shell printed no PATH'));
      },
    ),
  );
}
