import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ListeningPort, PortsHost } from '../../src/host/types/ports.ts';
import { launchConfigs, listeningUnder, packageScripts, parseCwds, parseListening, parsePs, pickPort } from '../../src/terminal/lsof.ts';
import { resolveCwd } from '../pty/cwd.ts';
import { integer, string, type Handlers } from './handlers.ts';

const exec = promisify(execFile);
const FIRST_THREAD_PORT = 5300;
const allocated = new Map<string, Promise<number>>();
// The kill allowlist: whatever the user was last shown. A PID can't be killed without first appearing in the Ports tab.
let shownPids = new Set<number>();

export const ports = {
  async list(_sender, cwd) {
    const found = await listeningPorts(resolveCwd(cwd));
    shownPids = new Set(found.map((p) => p.pid));
    return found;
  },
  async kill(_sender, pid) {
    const target = integer(pid, 'pid', 2, 2 ** 31);
    if (!shownPids.has(target) || target === process.pid) throw new Error(`pid ${target} is not a listed dev server`);
    process.kill(target, 'SIGTERM');
  },
  async allocate(_sender, key) {
    const id = string(key, 'key', 128);
    if (!allocated.has(id)) allocated.set(id, Promise.all(allocated.values()).then((taken) => pickPort(FIRST_THREAD_PORT, new Set(taken), isFree)));
    return allocated.get(id)!;
  },
  async targets(_sender, cwd) {
    return runTargets(resolveCwd(cwd));
  },
} satisfies Handlers<PortsHost>;

export function runTargets(dir: string) {
  return [...packageScripts(readJson(path.join(dir, 'package.json')), runnerFor(dir)), ...launchConfigs(readJson(path.join(dir, '.claude', 'launch.json')))];
}

// GAP: macOS/Linux only (lsof + ps); Windows needs netstat -ano.
export async function listeningPorts(root: string): Promise<ListeningPort[]> {
  const listening = parseListening(await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn'])).filter((l) => l.pid !== process.pid);
  if (listening.length === 0) return [];
  const pids = [...new Set(listening.map((l) => l.pid))].join(',');
  const [cwds, procs] = await Promise.all([run('lsof', ['-a', '-d', 'cwd', '-p', pids, '-Fn']), run('ps', ['-o', 'pid=,etime=,command=', '-p', pids])]);
  return listeningUnder(root, listening, parseCwds(cwds), parsePs(procs));
}

// lsof exits 1 when some PIDs vanished mid-scan or nothing matched; its stdout is still the answer.
async function run(file: string, args: string[]) {
  try {
    return (await exec(file, args, { maxBuffer: 8 * 1024 * 1024 })).stdout;
  } catch (error) {
    return (error as { stdout?: string }).stdout ?? '';
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
  if (existsSync(path.join(dir, 'bun.lock')) || existsSync(path.join(dir, 'bun.lockb'))) return 'bun';
  return 'npm';
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
