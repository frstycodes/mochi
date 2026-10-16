import { host } from '../host/index.ts';
import type { TerminalOutput } from '../host/types/remote.ts';

/**
 * Shells this computer opens for devices, one pty each in a thread's folder. Output collects here and a device reads it from
 * an offset, so a dropped connection loses nothing it can still catch up on. Kept apart from the Terminal pane's own shells:
 * a device never types into a shell you have open here.
 * GAP: a device that goes away without closing leaves its shell running until `MAX_SHELLS` pushes it out.
 */
interface Shell {
  threadId: string;
  output: string;
  /** Offset of `output[0]` in everything the shell printed. */
  start: number;
  exitCode?: number;
}

const MAX_OUTPUT = 256 * 1024;
const MAX_SHELLS = 8;
const shells = new Map<string, Shell>();
// Output can beat the spawn reply that names the pty; kept only while a spawn is in flight, so other shells' output isn't hoarded.
const early = new Map<string, string>();
let spawning = 0;
let isWired = false;

export async function openShell(threadId: string, cwd: string, cols: number, rows: number) {
  wire();
  spawning++;
  try {
    const port = await host.ports.allocate(threadId);
    const { id } = await host.pty.spawn({ cwd, cols, rows, port });
    shells.set(id, { threadId, output: '', start: 0 });
    append(id, early.get(id) ?? '');
    if (shells.size > MAX_SHELLS) closeShell(shells.keys().next().value!);
    return id;
  } finally {
    if (--spawning === 0) early.clear();
  }
}

/** The thread's own shell, or undefined for an id that isn't one (closed, another thread's, made up). */
export const shellOf = (id: string, threadId: string) => (shells.get(id)?.threadId === threadId ? shells.get(id) : undefined);

export function readShell(shell: Shell, after: number): TerminalOutput {
  const from = Math.max(after, shell.start) - shell.start;
  return { data: shell.output.slice(from), next: shell.start + shell.output.length, ...(shell.exitCode !== undefined && { exitCode: shell.exitCode }) };
}

export function closeShell(id: string) {
  if (!shells.delete(id)) return;
  void host.pty.kill(id).catch(() => {});
}

function append(id: string, data: string) {
  const shell = shells.get(id);
  if (!shell) return;
  shell.output += data;
  const over = shell.output.length - MAX_OUTPUT;
  if (over <= 0) return;
  shell.output = shell.output.slice(over);
  shell.start += over;
}

function wire() {
  if (isWired) return;
  isWired = true;
  host.pty.onData(({ id, data }) => {
    if (shells.has(id)) return append(id, data);
    if (spawning > 0) early.set(id, ((early.get(id) ?? '') + data).slice(-MAX_OUTPUT));
  });
  host.pty.onExit(({ id, exitCode }) => {
    const shell = shells.get(id);
    if (shell) shell.exitCode = exitCode;
  });
}
