import { Effect } from 'effect';
import { host } from '../host/index.ts';
import { coreClient } from '../host/desktop/rpc.ts';

/**
 * Shells this computer opens for devices, one pty each in a thread's folder. Core holds the output and pushes it to the device
 * (`terminal.output`), so a dropped connection resumes from its offset and loses nothing. Kept apart from the Terminal pane's own
 * shells: a device never types into a shell you have open here. A shell no device has typed into or opened for `IDLE_MS`
 * belongs to a device that left without closing it (reloaded, lost its connection) and closes.
 */
interface Shell {
  threadId: string;
  /** Epoch ms of the last use. */
  touchedAt: number;
}

const EARLY_MAX = 256 * 1024;
const MAX_SHELLS = 8;
const IDLE_MS = 60_000;
const shells = new Map<string, Shell>();
// Output can beat the spawn reply that names the pty; kept only while a spawn is in flight, so other shells' output isn't hoarded.
const early = new Map<string, string>();
let spawning = 0;
let isWired = false;

export async function openShell(
  threadId: string,
  cwd: string,
  cols: number,
  rows: number,
) {
  wire();
  spawning++;
  try {
    const port = await host.ports.allocate(threadId);
    const { id } = await host.pty.spawn({ cwd, cols, rows, port, threadId });
    // Until Core knows the shell, its output collects in `early`; requests go out in order, so the feed below precedes later output.
    await core('terminal.open', { terminalId: id, threadId });
    const printed = early.get(id);
    if (printed)
      void core('terminal.feed', { terminalId: id, data: printed }).catch(
        () => {},
      );
    shells.set(id, { threadId, touchedAt: Date.now() });
    if (shells.size > MAX_SHELLS) closeShell(shells.keys().next().value!);
    return id;
  } finally {
    if (--spawning === 0) early.clear();
  }
}

/** The thread's own shell, or undefined for an id that isn't one (closed, another thread's, made up). Using it keeps it open. */
export function shellOf(id: string, threadId: string) {
  const shell = shells.get(id);
  if (shell?.threadId !== threadId) return;
  shell.touchedAt = Date.now();
  return shell;
}

/** How often the bridge closes idle shells (`useRemoteBridge`, in `WindowReactor`). */
export const SWEEP_MS = IDLE_MS / 2;

/** Closes shells no device has used for `IDLE_MS` and none is watching. */
export async function closeIdleShells(now: number) {
  for (const [id, shell] of shells) {
    if (now - shell.touchedAt <= IDLE_MS) continue;
    if (
      (await core('terminal.watched', { terminalId: id }).catch(
        () => false,
      )) === true
    )
      shell.touchedAt = now;
    else closeShell(id);
  }
}

export function closeShell(id: string) {
  if (!shells.delete(id)) return;
  void core('terminal.close', { terminalId: id }).catch(() => {});
  void host.pty.kill(id).catch(() => {});
}

type Call = {
  'terminal.open': { terminalId: string; threadId: string };
  'terminal.feed': { terminalId: string; data: string };
  'terminal.exit': { terminalId: string; exitCode: number };
  'terminal.close': { terminalId: string };
  'terminal.watched': { terminalId: string };
};

/** Core's side of a shell, over the window's own connection so output reaches it in the order the pty printed it. An object so tests can stand in for Core. */
export const terminalCore = {
  async call<K extends keyof Call>(tag: K, payload: Call[K]) {
    const client = await coreClient();
    return Effect.runPromise(
      (client[tag] as (payload: Call[K]) => Effect.Effect<unknown, unknown>)(
        payload,
      ),
    );
  },
};
const core = <K extends keyof Call>(tag: K, payload: Call[K]) =>
  terminalCore.call(tag, payload);

function wire() {
  if (isWired) return;
  isWired = true;
  host.pty.onData(({ id, data }) => {
    if (shells.has(id))
      return void core('terminal.feed', { terminalId: id, data }).catch(
        () => {},
      );
    if (spawning > 0)
      early.set(id, ((early.get(id) ?? '') + data).slice(-EARLY_MAX));
  });
  host.pty.onExit(({ id, exitCode }) => {
    if (shells.has(id))
      void core('terminal.exit', { terminalId: id, exitCode }).catch(() => {});
  });
}
