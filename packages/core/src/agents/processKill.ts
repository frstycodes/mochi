/**
 * Shell commands that kill processes by name or pattern rather than by a PID the agent started. Every Claude Code and Codex
 * process Mochi runs matches a broad pattern: one `pkill -f "cat" -n` (BSD pkill reads `-n` as a second pattern) killed seven
 * idle sessions in other threads. Both providers gate on `isPatternKill` before the command runs.
 */
import {
  describeHits,
  protectedHits,
  protectedProcesses,
} from './protectedKill.ts';

const KILL_ADVICE =
  'Kill by a PID you started instead (kill <pid>), and stop a dev server from its terminal or by restarting it with mcp__mochi__start_dev_server. BSD pkill reads every word after the first pattern as another pattern, so a trailing `-n` or `.` widens it.';

export const KILL_WARNING = `Mochi: this command kills processes by name or pattern. It can kill other threads' agents, Mochi itself and dev servers. ${KILL_ADVICE}`;

/** Refused without asking: nobody is there to answer for an agent-driven turn. */
export const KILL_REFUSED = `${KILL_WARNING} Refused: this turn was started by an agent or an automated event, so no one can approve it.`;

let isAgentDriven: (threadId: string) => boolean = () => false;

/** Set once by the agents layer: whether the thread's current turn is no one's request (`turn.isAgentDriven` in the projection). */
export const useAgentDriven = (check: (threadId: string) => boolean) =>
  void (isAgentDriven = check);

/** Refused even when the user could answer: the pattern reaches a process Mochi runs (`protectedHits`), named in the reason. */
export const protectedRefusal = (hits: string) =>
  `Mochi: refused. This command kills processes by name or pattern, and it would kill ${hits}. That ends other threads' agents or Mochi itself. ${KILL_ADVICE}`;

export type KillDecision =
  | { action: 'run' }
  | { action: 'ask' | 'refuse'; reason: string };

/**
 * What a provider's gate does with a command: run it, ask the user (`KILL_WARNING`), or refuse. It refuses when the pattern
 * matches one of Mochi's own processes, whoever started the turn, and on an agent-driven turn, where nobody can answer. A
 * delegated session (`<thread>--<agent>`) goes by its thread's turn.
 */
export function killDecision(threadId: string, command: unknown): KillDecision {
  if (typeof command !== 'string' || !isPatternKill(command))
    return { action: 'run' };
  const commands = commandsIn(command);
  // `kill -1` signals every process the user owns.
  const hits = commands.some(
    (w) => name(w[0]) === 'kill' && killTargets(w).includes('-1'),
  )
    ? protectedProcesses()
    : protectedHits(commands);
  if (hits.length)
    return { action: 'refuse', reason: protectedRefusal(describeHits(hits)) };
  return isAgentDriven(threadId.split('--')[0])
    ? { action: 'refuse', reason: KILL_REFUSED }
    : { action: 'ask', reason: KILL_WARNING };
}

// Wrappers that run the rest of their words as a command, and their options that take a value.
const WRAPPERS: Record<string, string[]> = {
  sudo: ['-u', '-g', '-p', '-C', '-U', '-r', '-t', '-D', '-h'],
  doas: ['-u', '-C'],
  xargs: ['-I', '-n', '-P', '-L', '-s', '-E', '-d', '-a', '-J', '-R'],
  env: ['-u', '-C', '-S', '-P'],
  nice: ['-n'],
  nohup: [],
  command: [],
  exec: [],
  time: [],
  caffeinate: ['-t', '-w'],
  timeout: ['-s', '-k'],
};
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'ksh']);
const PID_FINDERS = new Set(['pgrep', 'pidof']);

/** True when the command would kill processes by name or pattern: pkill, killall, pgrep piped into kill, kill -1/0/-<pgid>, osascript quitting an app. */
export function isPatternKill(command: string): boolean {
  const segments = splitCommands(command);
  const heads = segments.map(unwrap);
  const hasFinder = heads.some((w) => PID_FINDERS.has(name(w[0])));
  return heads.some((words, i) => {
    const head = name(words[0]);
    if (head === 'pkill' || head === 'killall') return true;
    if (head === 'kill')
      return (
        hasFinder || isWrappedBy(segments[i], 'xargs') || killsGroup(words)
      );
    if (head === 'osascript') return /\b(quit|kill)\b/i.test(words.join(' '));
    if (SHELLS.has(head)) return shellScripts(words).some(isPatternKill);
    if (head === 'eval') return isPatternKill(words.slice(1).join(' '));
    return false;
  });
}

/** The simple commands a line runs, wrappers stripped, including those inside `sh -c '…'` and `eval`. */
export function commandsIn(command: string): string[][] {
  return splitCommands(command)
    .map(unwrap)
    .flatMap((words) => {
      const head = name(words[0]);
      if (SHELLS.has(head)) return shellScripts(words).flatMap(commandsIn);
      if (head === 'eval') return commandsIn(words.slice(1).join(' '));
      return [words];
    });
}

const name = (word: string | undefined) => word?.split('/').pop() ?? '';

/** The command a segment runs once leading `VAR=value` assignments and wrappers (sudo, xargs, env…) are stripped. */
function unwrap(words: string[]): string[] {
  let rest = words;
  for (;;) {
    while (rest[0] !== undefined && /^[A-Za-z_]\w*=/.test(rest[0]))
      rest = rest.slice(1);
    const valued = WRAPPERS[name(rest[0])];
    if (!valued) return rest;
    let i = 1;
    while (rest[i]?.startsWith('-') || /^[A-Za-z_]\w*=/.test(rest[i] ?? ''))
      i += valued.includes(rest[i]) ? 2 : 1;
    // timeout's duration comes before the command.
    if (name(rest[0]) === 'timeout' && rest[i] !== undefined) i += 1;
    rest = rest.slice(i);
  }
}

const isWrappedBy = (words: string[], wrapper: string) =>
  words.some((w) => name(w) === wrapper);

/** `kill` aimed at every process (-1), the caller's group (0) or a group (-<pgid>). */
const killsGroup = (words: string[]) =>
  killTargets(words).some((t) => t === '0' || /^-\d+$/.test(t));

/** What `kill` signals: the first `-x` is the signal (`-s`/`-n` take a value), targets follow. */
function killTargets(words: string[]) {
  let i = 1;
  if (words[i] === '-s' || words[i] === '-n') i += 2;
  else if (words[i]?.startsWith('-') && words[i] !== '--') i += 1;
  if (words[i] === '--') i += 1;
  return words.slice(i);
}

/** The scripts `sh -c '…'` (or `-lc`, `-ec`…) runs. */
function shellScripts(words: string[]) {
  const flag = words.findIndex((w) => /^-[a-z]*c[a-z]*$/.test(w));
  return flag > 0 && words[flag + 1] !== undefined ? [words[flag + 1]] : [];
}

/**
 * The simple commands in a shell line, as unquoted words: split at `;`, `&`, `|`, newlines, `(`, `)`, backticks and `$(`.
 * Quoted text stays one word and is never read as a command, so `echo "pkill x"` and `grep pkill` aren't kills; a `#` that
 * starts a word comments out the rest of its line. A heuristic, not a shell: `$(…)` inside double quotes isn't looked into.
 */
export function splitCommands(line: string): string[][] {
  const segments: string[][] = [];
  let words: string[] = [];
  let word: string | undefined;
  const endWord = () => {
    if (word !== undefined) words.push(word);
    word = undefined;
  };
  const endSegment = () => {
    endWord();
    if (words.length) segments.push(words);
    words = [];
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const quoted = c === "'" || c === '"' || c === '\\';
    if (quoted) {
      const [text, end] = readQuoted(line, i);
      word = (word ?? '') + text;
      i = end;
    } else if (c === '#' && word === undefined) i = lineEnd(line, i) - 1;
    else if (c === '$' && line[i + 1] === '(') {
      endSegment();
      i++;
    } else if (';&|()`\n'.includes(c)) endSegment();
    else if (/\s/.test(c)) endWord();
    else word = (word ?? '') + c;
  }
  endSegment();
  return segments;
}

const lineEnd = (line: string, from: number) => {
  const end = line.indexOf('\n', from);
  return end < 0 ? line.length : end;
};

/** The text of a backslash escape or a quoted span starting at `start`, and the index of its last character. */
function readQuoted(line: string, start: number): [string, number] {
  const c = line[start];
  if (c === '\\') return [line[start + 1] ?? '', start + 1];
  if (c === "'") {
    const end = line.indexOf("'", start + 1);
    const close = end < 0 ? line.length : end;
    return [line.slice(start + 1, close), close];
  }
  let text = '';
  let j = start + 1;
  for (; j < line.length && line[j] !== '"'; j++) {
    if (line[j] === '\\' && j + 1 < line.length) j++;
    text += line[j];
  }
  return [text, j];
}
