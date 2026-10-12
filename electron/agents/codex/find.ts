import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface CodexInstall {
  path: string;
  /** Spawn env: Harness's own plus the login shell's PATH, since npm installs of `codex` are `#!/usr/bin/env node` scripts. */
  env: NodeJS.ProcessEnv;
}

let override: string | undefined;
let found: Promise<CodexInstall | null> | undefined;

/** Settings' "Codex path" field. Empty clears it, and the next lookup searches again. */
export function setCodexPath(file: string | undefined) {
  override = file || undefined;
  found = undefined;
}

/** The user's own `codex`: the settings override, else the login shell's PATH (an app started from Finder doesn't get it), else the usual install dirs. */
export function findCodex(): Promise<CodexInstall | null> {
  found ??= lookup().then((install) => {
    if (!install) found = undefined;
    return install;
  });
  return found;
}

const MARK = '__harness_codex__';
const COMMON_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '~/.local/bin', '~/.npm-global/bin', '~/.bun/bin', '~/.volta/bin', '~/.cargo/bin'];

async function lookup(): Promise<CodexInstall | null> {
  const shell = await loginShell();
  const env = { ...process.env, ...(shell.path && { PATH: shell.path }) };
  const candidates = [override, shell.codex, ...COMMON_DIRS.map((dir) => path.join(dir.replace(/^~/, os.homedir()), 'codex'))];
  const file = candidates.find((c) => !!c && isExecutable(c));
  if (!file) return null;
  return { path: file, env: { ...env, PATH: [env.PATH, path.dirname(file)].filter(Boolean).join(path.delimiter) } };
}

/** `-i` because version managers (mise, nvm, asdf) activate in .zshrc; the marker skips whatever the rc files print. */
function loginShell(): Promise<{ path?: string; codex?: string }> {
  const shell = process.env.SHELL || '/bin/zsh';
  return new Promise((resolve) => {
    execFile(shell, ['-ilc', `printf '${MARK}%s\\n%s\\n' "$PATH" "$(command -v codex)"`], { timeout: 5000 }, (_error, stdout) => {
      const [shellPath, codex] = (stdout ?? '').split(MARK)[1]?.split('\n') ?? [];
      resolve({ path: shellPath || undefined, codex: codex && path.isAbsolute(codex) ? codex : undefined });
    });
  });
}

function isExecutable(file: string) {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
