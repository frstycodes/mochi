import type { CheckRun } from '../../../../apps/desktop/src/host/types/git.ts';
import {
  killTree,
  spawnShell,
} from '../../../../apps/desktop/electron/platform.ts';
import { userPath } from '../shellPath.ts';

const TIMEOUT_MS = 10 * 60_000;
// Enough for a failing assertion and its stack; the head of a long test run is noise.
const OUTPUT_TAIL = 4000;

/** `command` through your login shell (`-lc`), so it finds the same tools your terminal does. */
export async function runCheck(
  cwd: string,
  command: string,
): Promise<CheckRun> {
  const startedAt = performance.now();
  const env = { ...process.env, PATH: await userPath(), CI: '1' };
  return new Promise((resolve) => {
    const child = spawnShell(command, { cwd, env });
    let output = '';
    const take = (chunk: Buffer) =>
      void (output = (output + chunk.toString()).slice(-OUTPUT_TAIL));
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    const timer = setTimeout(() => killTree(child), TIMEOUT_MS);
    const done = (exitCode: number | null) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        output: output.trimEnd(),
        ms: Math.round(performance.now() - startedAt),
      });
    };
    child.on('error', (error) => ((output += `\n${error.message}`), done(127)));
    child.on('close', (code) => done(code));
  });
}
