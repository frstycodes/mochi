import { hostname } from '../agentPhase.ts';
import type { ActivityEntry } from '../model.ts';
import { parseTool } from '../summary.ts';

/** A tool call as a plain sentence for its work-group row: the agent's own description when it sent one (Claude's Bash), else one derived from the call. */
export function describeCall(entry: Pick<ActivityEntry, 'text' | 'description' | 'sent'>) {
  if (entry.description) return entry.description;
  if (entry.sent) return `Messaging ${entry.sent.title}`;
  const call = parseTool(entry.text);
  const name = call.target.split('/').pop() || call.target;
  switch (call.verb) {
    case 'Read':
      return `Read ${name}`;
    case 'Edit':
      return `Edited ${name}`;
    case 'Write':
      return `Created ${name}`;
    case 'Search':
      return `Searched the web for “${call.target}”`;
    case 'Fetch':
      return `Read ${hostname(call.target)}`;
    case 'Browser':
      return 'Used the browser';
    case 'Skill':
      return `Used the ${call.target} skill`;
    case 'Mcp': {
      const [server, tool] = call.target.split(': ');
      return tool ? `Called ${tool} on ${server}` : `Called ${server}`;
    }
    case 'Run':
      return describeCommand(call.target);
  }
}

/**
 * A shell command in plain words, deterministically (no model): the first segment that does something (`cd` and env
 * assignments skipped), matched against the commands agents run most. Anything else reads as the command itself.
 */
export function describeCommand(command: string) {
  const raw = unwrapShell(command.trim());
  // Redirections (`2>&1`, `> out.log`) aren't operands.
  const segments = commands(raw.replace(/\s\d*>&\d/g, '').replace(/\s\d*>{1,2}\s*\S+/g, '')).map(dropEnv).filter((t) => t.length > 0);
  const first = segments.find((t) => t[0] !== 'cd') ?? segments[0];
  return (first && describeArgs(first)) ?? (raw.split('\n')[0] || command);
}

// Codex runs every command as `/bin/zsh -lc '<command>'`.
function unwrapShell(command: string) {
  const match = /^(?:\S*\/)?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/.exec(command);
  return match ? match[2] : command;
}

function describeArgs(args: string[]): string | undefined {
  const [cmd, ...rest] = args;
  const operands = rest.filter((a) => !a.startsWith('-'));
  const file = operands.at(-1);
  const base = (p = '') => p.split('/').filter(Boolean).pop() ?? p;
  switch (base(cmd)) {
    case 'git':
      return describeGit(rest);
    case 'pnpm':
    case 'npm':
    case 'yarn':
    case 'bun':
      return describePackageManager(rest);
    case 'npx':
    case 'bunx':
      return describeArgs(rest.filter((a) => !a.startsWith('-')));
    case 'tsc':
      return 'Type-checked the project';
    case 'vitest':
    case 'jest':
      return 'Ran the tests';
    case 'eslint':
    case 'oxlint':
      return 'Linted the code';
    case 'prettier':
      return 'Formatted the code';
    case 'gh':
      return describeGh(rest);
    case 'ls':
    case 'tree':
      return file ? `Listed files in ${base(file)}` : 'Listed files';
    case 'cat':
    case 'head':
    case 'tail':
    case 'less':
    case 'bat':
      return file ? `Read ${base(file)}` : undefined;
    case 'sed':
      return rest.includes('-i') ? `Edited ${base(file)}` : file ? `Read part of ${base(file)}` : undefined;
    case 'grep':
    case 'rg':
    case 'ag': {
      const [pattern, ...paths] = operands;
      if (!pattern) return undefined;
      return `Searched for “${pattern}”${paths.length ? ` in ${paths.map(base).join(', ')}` : ''}`;
    }
    case 'find':
    case 'fd':
      return operands[0] && operands[0] !== '.' ? `Looked for files in ${base(operands[0])}` : 'Looked for files';
    case 'wc':
      return file ? `Counted lines in ${base(file)}` : undefined;
    case 'mkdir':
      return file ? `Created the ${base(file)} folder` : undefined;
    case 'touch':
      return file ? `Created ${base(file)}` : undefined;
    case 'rm':
      return file ? `Deleted ${base(file)}` : undefined;
    case 'mv':
      return file ? `Moved ${base(operands[0])} to ${base(file)}` : undefined;
    case 'cp':
      return file ? `Copied ${base(operands[0])} to ${base(file)}` : undefined;
    case 'curl':
    case 'wget': {
      const url = operands.find((a) => /^https?:\/\//.test(a));
      return url ? `Requested ${hostname(url)}` : undefined;
    }
    case 'sleep':
      return operands[0] ? `Waited ${operands[0]}s` : undefined;
    case 'pwd':
      return 'Checked the current folder';
    case 'which':
      return file ? `Located ${file}` : undefined;
    case 'echo':
      return 'Printed a message';
    case 'node':
    case 'python':
    case 'python3':
    case 'tsx':
    case 'deno': {
      if (rest.some((a) => a === '-e' || a === '-c' || a === '--eval')) return `Ran a ${cmd.startsWith('python') ? 'Python' : 'JavaScript'} snippet`;
      return file && /\.\w+$/.test(file) ? `Ran ${base(file)}` : undefined;
    }
  }
  return undefined;
}

const GIT = {
  status: 'Checked git status',
  log: 'Read the git log',
  show: 'Inspected a commit',
  add: 'Staged changes',
  commit: 'Committed the changes',
  push: 'Pushed the branch',
  pull: 'Pulled from the remote',
  fetch: 'Fetched from the remote',
  checkout: 'Switched branches',
  switch: 'Switched branches',
  branch: 'Listed branches',
  stash: 'Stashed changes',
  merge: 'Merged branches',
  rebase: 'Rebased the branch',
  blame: 'Read the blame',
  worktree: 'Managed worktrees',
} satisfies Record<string, string>;

function describeGit(args: string[]) {
  // `git -C dir status`: options before the subcommand.
  const sub = args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '-C');
  if (!sub) return undefined;
  if (sub === 'diff') {
    const path = args.slice(args.indexOf(sub) + 1).find((a) => !a.startsWith('-') && a.includes('.'));
    return path ? `Looked at the diff of ${path.split('/').pop()}` : 'Looked at the diff';
  }
  return GIT[sub as keyof typeof GIT] ?? `Ran git ${sub}`;
}

const SCRIPTS = {
  test: 'Ran the tests',
  build: 'Built the project',
  typecheck: 'Type-checked the project',
  lint: 'Linted the code',
  format: 'Formatted the code',
  dev: 'Started the dev server',
  start: 'Started the app',
} satisfies Record<string, string>;

function describePackageManager(args: string[]): string | undefined {
  const filter = args.find((_, i) => args[i - 1] === '--filter' || args[i - 1] === '-F');
  const words = args.filter((a) => !a.startsWith('-') && a !== filter);
  const [sub, ...rest] = words[0] === 'run' ? words.slice(1) : words;
  if (!sub) return undefined;
  const scope = filter ? ` in ${filter}` : '';
  if (sub === 'install' || sub === 'i' || sub === 'ci') return `Installed dependencies${scope}`;
  if (sub === 'add') return rest.length ? `Added ${rest.join(', ')}${scope}` : undefined;
  if (sub === 'remove' || sub === 'rm') return rest.length ? `Removed ${rest.join(', ')}${scope}` : undefined;
  if (sub === 'exec' || sub === 'dlx' || sub === 'x') return describeArgs(rest);
  const known = SCRIPTS[sub as keyof typeof SCRIPTS] ?? (sub === 'tsc' ? SCRIPTS.typecheck : undefined);
  if (known) return `${known}${scope}`;
  return `Ran the ${sub} script${scope}`;
}

function describeGh(args: string[]) {
  const [area, action, target] = args.filter((a) => !a.startsWith('-'));
  const number = target && /^\d+$/.test(target) ? ` ${target}` : '';
  if (area === 'pr') {
    if (action === 'view') return `Viewed PR${number}`;
    if (action === 'list') return 'Listed pull requests';
    if (action === 'create') return 'Opened a pull request';
    if (action === 'checks') return `Checked PR${number}'s CI`;
    if (action === 'merge') return `Merged PR${number}`;
    if (action === 'diff') return `Read PR${number}'s diff`;
    if (action === 'comment') return `Commented on PR${number}`;
  }
  if (area === 'run') {
    if (action === 'watch') return 'Waited for the CI run to finish';
    if (action === 'view') return 'Inspected the CI run';
    if (action === 'list') return 'Listed CI runs';
  }
  if (area === 'issue') {
    if (action === 'view') return `Viewed issue${number}`;
    if (action === 'list') return 'Listed issues';
    if (action === 'create') return 'Opened an issue';
  }
  if (area === 'api') return 'Called the GitHub API';
  return area ? `Ran gh ${[area, action].filter(Boolean).join(' ')}` : undefined;
}

function dropEnv(tokens: string[]) {
  const i = tokens.findIndex((t) => !/^[A-Z_][A-Z0-9_]*=/.test(t));
  return i < 0 ? [] : tokens.slice(i);
}

/** The simple commands in a command line, each as its words with quotes dropped; `&&`, `||`, `|`, `;` and newlines outside quotes split them. */
function commands(line: string) {
  const result: string[][] = [[]];
  for (const m of line.matchAll(/"((?:\\.|[^"])*)"|'([^']*)'|(&&|\|\||[|;\n])|([^\s"'|;&]+|&)/g)) {
    if (m[3]) result.push([]);
    else result.at(-1)!.push(m[1] ?? m[2] ?? m[4]);
  }
  return result;
}
