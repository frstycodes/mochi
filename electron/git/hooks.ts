import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Where Mochi's git hooks live; agents' git points here through env config, never through the repo's own config. */
export const HOOKS_DIR = join(homedir(), '.harness', 'hooks');

// Every hook git runs: ours checks commit messages, the rest only hand over to the repo's own (husky, lefthook, …).
const HOOK_NAMES = ['applypatch-msg', 'pre-applypatch', 'post-applypatch', 'pre-commit', 'pre-merge-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit', 'pre-rebase', 'post-checkout', 'post-merge', 'pre-push', 'post-rewrite', 'pre-auto-gc'];

// The repo's own hooks: its core.hooksPath (read with our env override switched off), else the common .git/hooks.
const CHAIN = `top=$(git rev-parse --show-toplevel 2>/dev/null) && cd "$top"
own=$(GIT_CONFIG_COUNT=0 git config --get core.hooksPath || echo "$(git rev-parse --git-common-dir)/hooks")
[ -x "$own/$(basename "$0")" ] && exec "$own/$(basename "$0")" "$@"
exit 0
`;

const TYPES = 'feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert';
const MAX_SUBJECT = 72;

// Read the message before chaining: `cd` above changes the directory and $1 may be relative.
const COMMIT_MSG = `msg=$(cat "$1")
subject=$(printf '%s\\n' "$msg" | grep -v '^#' | sed -n '/./{p;q;}')
if ! printf '%s' "$subject" | grep -Eq '^(${TYPES})(\\([a-z0-9._/-]+\\))?!?: [^ ]'; then
  echo "Mochi: the commit subject must follow Conventional Commits, like 'fix(auth): keep the session cookie'." >&2
  echo "Types: ${TYPES.replaceAll('|', ', ')}. Got: $subject" >&2
  exit 1
fi
if [ \${#subject} -gt ${MAX_SUBJECT} ]; then
  echo "Mochi: the commit subject is \${#subject} characters; keep it under ${MAX_SUBJECT}." >&2
  exit 1
fi
`;

/** Writes the hooks (idempotent; cheap enough to run before every agent start). */
export async function installHooks(dir = HOOKS_DIR) {
  await mkdir(dir, { recursive: true });
  await Promise.all(
    HOOK_NAMES.map(async (name) => {
      const path = join(dir, name);
      await writeFile(path, `#!/bin/sh\n# Written by Mochi. Edits are overwritten.\n${name === 'commit-msg' ? COMMIT_MSG : ''}${CHAIN}`);
      await chmod(path, 0o755);
    }),
  );
}

/** Env that points git at Mochi's hooks for one process tree, appended after any env config already there. */
export function hooksEnv(env: NodeJS.ProcessEnv, dir = HOOKS_DIR): NodeJS.ProcessEnv {
  const n = Number(env.GIT_CONFIG_COUNT ?? 0) || 0;
  return { ...env, GIT_CONFIG_COUNT: String(n + 1), [`GIT_CONFIG_KEY_${n}`]: 'core.hooksPath', [`GIT_CONFIG_VALUE_${n}`]: dir };
}
