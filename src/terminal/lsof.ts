import type { ListeningPort, RunTarget } from '../host/types/ports.ts';

// Shared by electron/ipc/ports.ts (main) and its test; pure so `node --test` can run it without Electron.

/** `lsof -nP -iTCP -sTCP:LISTEN -Fpn`: one `p<pid>` line, then an `n<addr>:<port>` line per socket. IPv4 and IPv6 listeners of one process collapse. */
export function parseListening(output: string) {
  const found = new Map<string, { pid: number; port: number }>();
  let pid = 0;
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    const port = line.startsWith('n') ? Number(line.slice(line.lastIndexOf(':') + 1)) : NaN;
    if (pid > 0 && Number.isInteger(port) && port > 0) found.set(`${pid}:${port}`, { pid, port });
  }
  return [...found.values()];
}

/** `lsof -a -d cwd -p <pids> -Fn`: `p<pid>` then `fcwd` then `n<path>`. */
export function parseCwds(output: string) {
  const cwds = new Map<number, string>();
  let pid = 0;
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid > 0) cwds.set(pid, line.slice(1));
  }
  return cwds;
}

/** `ps -o pid=,etime=,command= -p <pids>`. */
export function parsePs(output: string) {
  const procs = new Map<number, { seconds: number; command: string }>();
  for (const line of output.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/);
    if (match) procs.set(Number(match[1]), { seconds: parseEtime(match[2]), command: match[3] });
  }
  return procs;
}

/** `[[dd-]hh:]mm:ss` → seconds. */
export function parseEtime(etime: string) {
  const [days, clock] = etime.includes('-') ? etime.split('-') : ['0', etime];
  const [s = 0, m = 0, h = 0] = clock.split(':').map(Number).reverse();
  return ((Number(days) * 24 + h) * 60 + m) * 60 + s;
}

export function isInside(dir: string, root: string) {
  const base = root.endsWith('/') ? root : `${root}/`;
  return dir === root || dir.startsWith(base);
}

export function listeningUnder(root: string, listening: { pid: number; port: number }[], cwds: Map<number, string>, procs: Map<number, { seconds: number; command: string }>, now = Date.now()): ListeningPort[] {
  return listening
    .filter(({ pid }) => isInside(cwds.get(pid) ?? '', root))
    .map(({ pid, port }) => {
      const proc = procs.get(pid);
      return { port, pid, command: proc?.command ?? '', startedAt: now - (proc?.seconds ?? 0) * 1000 };
    })
    .sort((a, b) => a.port - b.port);
}

/** First port from `start` that nobody reserved and `isFree` accepts. */
export async function pickPort(start: number, reserved: Set<number>, isFree: (port: number) => Promise<boolean>, end = start + 1000) {
  for (let port = start; port < end; port++) if (!reserved.has(port) && (await isFree(port))) return port;
  throw new Error(`no free port in ${start}–${end - 1}`);
}

export function packageScripts(pkg: unknown, runner: string): RunTarget[] {
  const scripts = (pkg as { scripts?: Record<string, unknown> } | null)?.scripts ?? {};
  return Object.entries(scripts)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && /\b(dev|start|serve|preview)\b/.test(entry[0]))
    .map(([name]) => ({ name, command: `${runner} run ${name}`, source: 'package.json' }));
}

const DEV_SCRIPTS = ['dev', 'start', 'serve', 'preview'];

/** What serves the project for a before/after compare: the `dev` script, then start, serve, preview, other matches, then launch.json. */
export function devTarget(targets: RunTarget[]) {
  const rank = (t: RunTarget) => (t.source === 'launch.json' ? DEV_SCRIPTS.length + 1 : DEV_SCRIPTS.includes(t.name) ? DEV_SCRIPTS.indexOf(t.name) : DEV_SCRIPTS.length);
  return [...targets].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

export function launchConfigs(launch: unknown): RunTarget[] {
  const configs = (launch as { configurations?: unknown[] } | null)?.configurations ?? [];
  return configs.flatMap((c) => {
    const { name, runtimeExecutable, runtimeArgs = [], port } = c as Record<string, unknown>;
    if (typeof name !== 'string' || typeof runtimeExecutable !== 'string' || !Array.isArray(runtimeArgs)) return [];
    const command = [runtimeExecutable, ...runtimeArgs.map(String)].map(shellQuote).join(' ');
    return [{ name, command, source: 'launch.json' as const, port: typeof port === 'number' ? port : undefined }];
  });
}

function shellQuote(arg: string) {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;
}
