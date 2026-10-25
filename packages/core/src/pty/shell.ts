import { chmodSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { terminalShell } from '../agents/config.ts';

// OSC 133 marks: C when a command starts, D;<exit> when the prompt returns. The renderer turns a non-zero D into "Ask agent to fix".
// zsh only: ZDOTDIR points at wrapper rc files that source the user's own and add the hooks, the way VS Code does it.
// GAP: bash and fish shells get no marks, so failed commands there show no fix prompt.
const RC_FILES = ['.zshenv', '.zprofile', '.zshrc'];
const HOOKS = `
__harness_precmd() { print -n "\\e]133;D;$?\\a" }
__harness_preexec() { print -n "\\e]133;C\\a" }
precmd_functions=(__harness_precmd $precmd_functions)
preexec_functions+=(__harness_preexec)
# A command from the Ports tab arrives in HARNESS_COMMAND and runs as if typed at the first prompt: echoed once, highlighted, in history.
__harness_line_init() {
  [[ -z $HARNESS_COMMAND ]] && return
  BUFFER=$HARNESS_COMMAND
  unset HARNESS_COMMAND
  zle accept-line
}
autoload -Uz add-zle-hook-widget && add-zle-hook-widget line-init __harness_line_init
`;

let zdotdir: string | undefined;

export function shellLaunch(userData: string): {
  file: string;
  args: string[];
  env: Record<string, string>;
} {
  const file = terminalShell();
  if (path.basename(file) !== 'zsh') return { file, args: ['-l'], env: {} };
  zdotdir ??= writeZshRc(userData);
  return {
    file,
    args: ['-l'],
    env: {
      ZDOTDIR: zdotdir,
      HARNESS_ZDOTDIR: zdotdir,
      HARNESS_USER_ZDOTDIR: process.env.ZDOTDIR ?? process.env.HOME ?? '',
    },
  };
}

function writeZshRc(userData: string) {
  const dir = path.join(userData, 'shell-integration', 'zsh');
  mkdirSync(dir, { recursive: true });
  for (const rc of RC_FILES) {
    // Each file runs the user's own copy with ZDOTDIR set to theirs, then points ZDOTDIR back here for the next file; .zshrc hands it back for good, so .zlogin and subshells are the user's.
    const isLast = rc === '.zshrc';
    const body = [
      'ZDOTDIR=$HARNESS_USER_ZDOTDIR',
      `[[ -f $ZDOTDIR/${rc} ]] && . $ZDOTDIR/${rc}`,
      'HARNESS_USER_ZDOTDIR=$ZDOTDIR',
      isLast ? HOOKS : 'ZDOTDIR=$HARNESS_ZDOTDIR',
    ].join('\n');
    writeFileSync(path.join(dir, rc), `${body}\n`);
  }
  return dir;
}

/** node-pty's darwin prebuild ships spawn-helper without the exec bit under pnpm, which fails every spawn with `posix_spawnp failed`. */
export function ensureSpawnHelper() {
  if (process.platform !== 'darwin') return;
  const require = createRequire(import.meta.url);
  // Packaged, the helper lives in app.asar.unpacked (see scripts/after-pack.mjs); its asar entry reports the mode it had before packing.
  const helper = path
    .join(
      path.dirname(require.resolve('node-pty/package.json')),
      'prebuilds',
      `darwin-${process.arch}`,
      'spawn-helper',
    )
    .replace('app.asar', 'app.asar.unpacked');
  const stat = statSync(helper, { throwIfNoEntry: false });
  if (stat && !(stat.mode & 0o111)) chmodSync(helper, 0o755);
}
