import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { runCommand } from '@mochi/core/runClient';
import type { ListeningPort, PortsHost } from '@mochi/domain/host/types/ports';
import {
  launchConfigs,
  listeningUnder,
  packageScripts,
  parseCwds,
  parseListening,
  parsePs,
  pickPort,
  portsByRoot,
  type PortScan,
} from '../../src/terminal/lsof.ts';
import { resolveCwd } from '../pty/cwd.ts';
import type { Handlers } from './handlers.ts';

const FIRST_THREAD_PORT = 5300;
const allocated = new Map<string, Promise<number>>();
// The kill allowlist: whatever the user was last shown across every watched thread. A PID can't be killed without first appearing in a Ports tab.
let shownPids = new Set<number>();

export const ports = {
  async list(_sender, cwds) {
    const found = portsByRoot(cwds.map(rootOrError), await scanListening());
    shownPids = new Set(
      found.flatMap((r) => ('ports' in r ? r.ports.map((p) => p.pid) : [])),
    );
    return found;
  },
  async kill(_sender, pid) {
    if (!shownPids.has(pid) || pid === process.pid)
      throw new Error(`pid ${pid} is not a listed dev server`);
    process.kill(pid, 'SIGTERM');
  },
  async allocate(_sender, key) {
    if (!allocated.has(key))
      allocated.set(
        key,
        Promise.all(allocated.values()).then((taken) =>
          pickPort(FIRST_THREAD_PORT, new Set(taken), isFree),
        ),
      );
    return allocated.get(key)!;
  },
  async targets(_sender, cwd) {
    return runTargets(resolveCwd(cwd));
  },
} satisfies Handlers<PortsHost>;

export function runTargets(dir: string) {
  return [
    ...packageScripts(readJson(path.join(dir, 'package.json')), runnerFor(dir)),
    ...launchConfigs(readJson(path.join(dir, '.claude', 'launch.json'))),
  ];
}

export async function listeningPorts(root: string): Promise<ListeningPort[]> {
  const { listening, cwds, procs } = await scanListening();
  return listeningUnder(root, listening, cwds, procs);
}

// GAP: macOS/Linux only (lsof + ps); Windows needs netstat -ano.
async function scanListening(): Promise<PortScan> {
  const listening = parseListening(
    await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn']),
  ).filter((l) => l.pid !== process.pid);
  if (listening.length === 0)
    return { listening, cwds: new Map(), procs: new Map() };
  const pids = [...new Set(listening.map((l) => l.pid))].join(',');
  const [cwds, procs] = await Promise.all([
    run('lsof', ['-a', '-d', 'cwd', '-p', pids, '-Fn']),
    run('ps', ['-o', 'pid=,etime=,command=', '-p', pids]),
  ]);
  return { listening, cwds: parseCwds(cwds), procs: parsePs(procs) };
}

function rootOrError(cwd: string) {
  try {
    return resolveCwd(cwd);
  } catch (error) {
    return error as Error;
  }
}

// lsof exits 1 when some PIDs vanished mid-scan or nothing matched; its stdout is still the answer.
async function run(file: string, args: string[]) {
  try {
    return (await runCommand(file, args, { okCodes: [0, 1], timeout: 10_000 }))
      .stdout;
  } catch {
    return '';
  }
}

export function isFree(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = createServer().once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

function runnerFor(dir: string) {
  if (existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
  if (
    existsSync(path.join(dir, 'bun.lock')) ||
    existsSync(path.join(dir, 'bun.lockb'))
  )
    return 'bun';
  return 'npm';
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
