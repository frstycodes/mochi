import type {
  SpawnedProcess,
  SpawnOptions,
} from '@anthropic-ai/claude-agent-sdk';
import { spawnCommand } from '../../runClient.ts';
import { protect } from './killGuard.ts';

/** Claude Code as a process of Core's `run`: a kill signals its whole process group, and its exit takes leftover children with it. */
export function spawnThroughRun({
  command,
  args,
  cwd,
  env,
  signal,
}: SpawnOptions) {
  const child = spawnCommand(command, args, { cwd, env });
  protect(command, args, child);
  const signalTree = child.kill.bind(child);
  let killed = false;
  const kill = (killSignal: NodeJS.Signals = 'SIGTERM') => {
    killed = true;
    signalTree(killSignal);
    return true;
  };
  signal?.addEventListener('abort', () => kill(), { once: true });
  // The SDK reads `exitCode` and `killed` as live properties of node's ChildProcess.
  return Object.defineProperties(child, {
    kill: { value: kill },
    killed: { get: () => killed },
  }) as typeof child & SpawnedProcess;
}
