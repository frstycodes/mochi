import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { runCommand } from '@mochi/core/runClient';
import { resolveRoot } from './contain.ts';

const GIT_TIMEOUT_MS = 30_000;
const MAX_FILES = 50_000;
const SKIP_DIRS = new Set(['.git', 'node_modules']);

/** Tracked plus untracked-but-not-ignored files, so every `.gitignore` rule (nested, global, `info/exclude`) applies exactly as git sees it. */
export async function listFiles(root: string) {
  const realRoot = await resolveRoot(root);
  const files = await gitFiles(realRoot).catch(() => walk(realRoot));
  return files.sort().slice(0, MAX_FILES);
}

async function gitFiles(cwd: string) {
  const git = (...args: string[]) => runCommand('git', ['ls-files', '-z', ...args], { cwd, timeout: GIT_TIMEOUT_MS }).then((r) => r.stdout.split('\0').filter(Boolean));
  const [present, deleted] = await Promise.all([git('--cached', '--others', '--exclude-standard'), git('--deleted')]);
  const gone = new Set(deleted);
  return [...new Set(present)].filter((f) => !gone.has(f));
}

// ponytail: outside a git repo only .git and node_modules are skipped; parse .gitignore here if non-repo roots become common.
async function walk(root: string) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && !path.relative(root, e.parentPath).split(path.sep).some((part) => SKIP_DIRS.has(part)))
    .map((e) => path.relative(root, path.join(e.parentPath, e.name)).split(path.sep).join('/'));
}
