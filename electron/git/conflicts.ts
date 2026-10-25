import { runGit } from './run.ts';

// Without `-z`, git still C-quotes a path holding a newline, tab, `"` or `\` despite runGit's core.quotePath=false.
export async function conflictedPaths(top: string) {
  return (await runGit(top, ['diff', '--name-only', '--diff-filter=U', '-z']))
    .split('\0')
    .filter(Boolean);
}
