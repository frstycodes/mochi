import { basename } from 'node:path';

/** A process a kill by pattern must never reach: its command line for `pkill -f`, its name for `pkill`/`killall`. */
export interface ProtectedProcess {
  line: string;
  name: string;
  kind: 'claude' | 'mochi';
  pid: () => number | undefined;
}

/** The Claude Code processes Mochi runs, live ones only. */
const running = new Set<ProtectedProcess>();

/** Records a spawned Claude Code process until its `exit` (`runClient.ts`), so kill patterns are tested against its real command line. */
export function protect(
  command: string,
  args: readonly string[],
  child: NodeJS.EventEmitter & { readonly pid?: number },
) {
  const entry: ProtectedProcess = {
    line: [command, ...args].join(' '),
    name: basename(command),
    kind: 'claude',
    pid: () => child.pid,
  };
  running.add(entry);
  child.once('exit', () => running.delete(entry));
}

/** Mochi's Claude Code processes, then Core itself. */
export const protectedProcesses = (): ProtectedProcess[] => [
  ...running,
  {
    line: [process.execPath, ...process.argv.slice(1)].join(' '),
    name: basename(process.execPath),
    kind: 'mochi',
    pid: () => process.pid,
  },
];

// Options that take a value, for pkill/pgrep (BSD and procps) and killall (macOS and psmisc).
const PKILL_VALUE = new Set('FGgJMNPstUu');
const KILLALL_VALUE = new Set('uctsoyn');
const SIGNAL = /^-(\d+|[A-Z]{2,})$/;

/**
 * The protected processes the line's `pkill`, `killall` or `pgrep` feeding a `kill` would reach. `commands` are its simple
 * commands with wrappers stripped (`commandsIn`). No pattern, or a word after the pattern that starts with `-` (BSD reads it as
 * another pattern), reaches all of them; patterns match case-insensitively, as `-i` would.
 */
export function protectedHits(
  commands: string[][],
  processes = protectedProcesses(),
) {
  const hasKill = commands.some((w) => basename(w[0] ?? '') === 'kill');
  return processes.filter((p) =>
    commands.some(([head = '', ...args]) => {
      const command = basename(head);
      if (command === 'pkill' || (command === 'pgrep' && hasKill))
        return pkillReaches(args, p);
      return command === 'killall' && killallReaches(args, p);
    }),
  );
}

function pkillReaches(args: string[], p: ProtectedProcess) {
  const { flags, operands } = parse(args, PKILL_VALUE, ['full']);
  if (operands.length === 0 || operands.some((o) => o.startsWith('-')))
    return true;
  const target = flags.has('f') ? p.line : p.name;
  return operands.some((o) => matches(o, target, flags.has('x')));
}

function killallReaches(args: string[], p: ProtectedProcess) {
  const { flags, operands } = parse(args, KILLALL_VALUE, ['regexp']);
  if (operands.length === 0) return true;
  return flags.has('m') || flags.has('r')
    ? operands.some((o) => matches(o, p.name, false))
    : operands.includes(p.name);
}

function parse(args: string[], valued: Set<string>, longFlags: string[]) {
  const flags = new Set<string>();
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--') return { flags, operands: args.slice(i + 1) };
    if (!arg.startsWith('-') || arg === '-') break;
    i += SIGNAL.test(arg) ? 1 : readOption(arg, flags, valued, longFlags);
  }
  return { flags, operands: args.slice(i) };
}

/** Adds an option word's flags and returns how many words it spans: two when its value is the next word. */
function readOption(
  arg: string,
  flags: Set<string>,
  valued: Set<string>,
  longFlags: string[],
) {
  if (arg.startsWith('--')) {
    const isFlag = longFlags.includes(arg.slice(2));
    if (isFlag) flags.add(arg[2]);
    return isFlag || arg.includes('=') ? 1 : 2;
  }
  for (let j = 1; j < arg.length; j++) {
    if (!valued.has(arg[j])) flags.add(arg[j]);
    else return j === arg.length - 1 ? 2 : 1;
  }
  return 1;
}

/** An invalid regex matches nothing here; pkill would refuse it too. */
function matches(pattern: string, target: string, isExact: boolean) {
  try {
    return new RegExp(isExact ? `^(?:${pattern})$` : pattern, 'i').test(target);
  } catch {
    return false;
  }
}

/** "Mochi itself (pid 4242) and 3 Claude Code sessions (pids 11, 12, 13)": what a refusal names. */
export function describeHits(hits: ProtectedProcess[]) {
  const pids = (list: ProtectedProcess[]) =>
    list.flatMap((p) => p.pid() ?? []).join(', ');
  const parts: string[] = [];
  const mochi = hits.filter((p) => p.kind === 'mochi');
  if (mochi.length) parts.push(`Mochi itself (pid ${pids(mochi)})`);
  const claude = hits.filter((p) => p.kind === 'claude');
  if (claude.length) {
    const ids = pids(claude);
    const noun =
      claude.length === 1 ? 'Claude Code session' : 'Claude Code sessions';
    parts.push(
      `${claude.length === 1 ? 'a' : claude.length} ${noun}${ids && ` (pid${claude.length === 1 ? '' : 's'} ${ids})`}`,
    );
  }
  return parts.join(' and ');
}
