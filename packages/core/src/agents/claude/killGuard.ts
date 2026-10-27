import { basename } from 'node:path';
import type {
  HookCallbackMatcher,
  HookInput,
} from '@anthropic-ai/claude-agent-sdk';

/** Command line to process name, for the Claude Code processes Mochi runs. Live ones only. */
const running = new Map<string, string>();

/** Records a spawned Claude Code process until it exits, so the guard can test kill patterns against its real command line. */
export function protect(
  command: string,
  args: readonly string[],
  child: NodeJS.EventEmitter,
) {
  const line = [command, ...args].join(' ');
  running.set(line, basename(command));
  child.once('exit', () => running.delete(line));
}

const protectedLines = () => [...running.keys(), process.argv.join(' ')];
const protectedNames = () => [...running.values(), basename(process.execPath)];

// Options that take a value, for pkill (BSD and procps) and killall (macOS and psmisc).
const PKILL_VALUE = new Set('FGgJMNPstUu');
const KILLALL_VALUE = new Set('uctsoyn');
const SIGNAL = /^-(\d+|[A-Z]{2,})$/;

export const DENY_REASON =
  "Mochi: this kill would also hit other threads' Claude Code processes (or Mochi itself). Kill by PID instead: find it with `pgrep -fl <specific pattern>` or `lsof -ti :<port>`, then `kill <pid>`. Note BSD pkill treats every word after the first pattern as another pattern, so a trailing flag like `-n` becomes one.";

/**
 * A PreToolUse matcher that denies a Bash `pkill`/`killall` whose patterns would match a Claude Code process Mochi runs,
 * Mochi's own process, or every process of the user. One agent's `pkill -f cat -n` once SIGTERMed every thread's session.
 */
export const killGuard = (): HookCallbackMatcher => ({
  hooks: [async (input) => guardKill(input)],
});

export function guardKill(input: HookInput) {
  if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Bash')
    return {};
  const command = (input.tool_input as { command?: unknown } | null)?.command;
  if (typeof command !== 'string' || !isBroadKill(command)) return {};
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse' as const,
      permissionDecision: 'deny' as const,
      permissionDecisionReason: DENY_REASON,
    },
  };
}

export function isBroadKill(
  command: string,
  lines = protectedLines(),
  names = protectedNames(),
) {
  return simpleCommands(command).some((words) => {
    const at = words.findIndex((w) => /^(pkill|killall)$/.test(basename(w)));
    if (at === -1) return false;
    const args = words.slice(at + 1);
    return basename(words[at]!) === 'pkill'
      ? isBroadPkill(args, lines, names)
      : isBroadKillall(args, names);
  });
}

function isBroadPkill(args: string[], lines: string[], names: string[]) {
  const { flags, operands } = parse(args, PKILL_VALUE, ['full']);
  // BSD pkill stops reading options at the first pattern, so a later `-n` is a pattern that matches `--input-format`.
  if (operands.length === 0 || operands.some((p) => p.startsWith('-')))
    return true;
  const targets = flags.has('f') ? lines : names;
  return operands.some((p) => matchesAny(p, targets, flags.has('x')));
}

function isBroadKillall(args: string[], names: string[]) {
  const { flags, operands } = parse(args, KILLALL_VALUE, ['regexp']);
  if (operands.length === 0) return true;
  return flags.has('m') || flags.has('r')
    ? operands.some((p) => matchesAny(p, names, false))
    : operands.some((p) => names.includes(p));
}

function parse(args: string[], valued: Set<string>, fullFlags: string[]) {
  const flags = new Set<string>();
  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;
    if (arg === '--') return { flags, operands: args.slice(i + 1) };
    if (!arg.startsWith('-') || arg === '-') break;
    i += SIGNAL.test(arg) ? 1 : readOption(arg, flags, valued, fullFlags);
  }
  return { flags, operands: args.slice(i) };
}

/** Adds an option word's flags and returns how many words it spans: two when its value is the next word. */
function readOption(
  arg: string,
  flags: Set<string>,
  valued: Set<string>,
  fullFlags: string[],
) {
  if (arg.startsWith('--')) {
    if (fullFlags.includes(arg.slice(2))) flags.add(arg[2]!);
    return fullFlags.includes(arg.slice(2)) || arg.includes('=') ? 1 : 2;
  }
  for (let j = 1; j < arg.length; j++) {
    if (!valued.has(arg[j]!)) flags.add(arg[j]!);
    else return j === arg.length - 1 ? 2 : 1;
  }
  return 1;
}

function matchesAny(pattern: string, targets: string[], isExact: boolean) {
  try {
    const re = new RegExp(isExact ? `^(?:${pattern})$` : pattern, 'i');
    return targets.some((t) => re.test(t));
  } catch {
    return false;
  }
}

/** Splits a shell line into simple commands of unquoted words. A heuristic: no expansions, and `$(` only splits. */
function simpleCommands(command: string) {
  const commands: string[][] = [[]];
  let word: string | undefined;
  let quote: string | undefined;
  const end = () => {
    if (word !== undefined) commands.at(-1)!.push(word);
    word = undefined;
  };
  for (const c of command) {
    if (quote) {
      if (c === quote) quote = undefined;
      else word = (word ?? '') + c;
    } else if (c === '"' || c === "'") {
      quote = c;
      word ??= '';
    } else if (/[\s]/.test(c) && c !== '\n') end();
    else if (/[;&|\n()`]/.test(c)) {
      end();
      commands.push([]);
    } else word = (word ?? '') + c;
  }
  end();
  return commands;
}
