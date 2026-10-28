import { host } from '../host/index.ts';
import type { CommandData, RemoteCommand } from '../host/types/remote.ts';
import type { ThreadOrigin } from './origin.tsx';
import { localPty, type PtyTransport } from '../terminal/sessions.ts';
import { toWire } from './ids.ts';

type Ask = <T extends RemoteCommand['type']>(
  command: Extract<RemoteCommand, { type: T }>,
) => Promise<T extends keyof CommandData ? CommandData[T] : undefined>;

/** The machine's answer, or its error thrown. */
function asker(machineId: string): Ask {
  return async (command) => {
    const result = await host.remote.command(machineId, toWire(command));
    if (!result.isOk) throw new Error(result.error);
    return result.data as never;
  };
}

/**
 * Shells on another computer in its thread's folder, through the `terminal-*` commands; that computer pushes their output
 * (`host.remote.onTerminalOutput`). Keystrokes go out in order, batched per shell while one write is on its way. A shell
 * spawned with a command gets it typed in once it's open, as a local one would run it.
 */
export function remotePty(
  machineId: string,
  ask = asker(machineId),
): PtyTransport {
  const threadOf = new Map<string, string>();
  const typing = new Map<string, { typed: string; isWriting: boolean }>();
  const flush = async (terminalId: string) => {
    const queue = typing.get(terminalId);
    const threadId = threadOf.get(terminalId);
    if (!queue || queue.isWriting || !queue.typed || !threadId) return;
    queue.isWriting = true;
    const data = queue.typed;
    queue.typed = '';
    await ask({ type: 'terminal-write', threadId, terminalId, data }).catch(
      () => {},
    );
    queue.isWriting = false;
    void flush(terminalId);
  };
  const write = (terminalId: string, data: string) => {
    const queue = typing.get(terminalId);
    if (!queue) return;
    queue.typed += data;
    void flush(terminalId);
  };
  return {
    id: `machine:${machineId}`,
    async spawn({ threadId, cols, rows, command }) {
      const { terminalId } = await ask({
        type: 'terminal-open',
        threadId,
        cols,
        rows,
      });
      threadOf.set(terminalId, threadId);
      typing.set(terminalId, { typed: '', isWriting: false });
      if (command) write(terminalId, `${command}\r`);
      return { id: terminalId };
    },
    write,
    resize(terminalId, cols, rows) {
      const threadId = threadOf.get(terminalId);
      if (threadId)
        void ask({
          type: 'terminal-resize',
          threadId,
          terminalId,
          cols,
          rows,
        }).catch(() => {});
    },
    kill(terminalId) {
      const threadId = threadOf.get(terminalId);
      threadOf.delete(terminalId);
      typing.delete(terminalId);
      if (threadId)
        void ask({ type: 'terminal-close', threadId, terminalId }).catch(
          () => {},
        );
    },
    listen({ data, exit }) {
      host.remote.onTerminalOutput((chunk) => {
        if (chunk.machineId !== machineId) return;
        if (chunk.data) data(chunk.terminalId, chunk.data);
        if (chunk.exitCode !== undefined) {
          exit(chunk.terminalId, chunk.exitCode);
          threadOf.delete(chunk.terminalId);
          typing.delete(chunk.terminalId);
        }
      });
    },
  };
}

const remotes = new Map<string, PtyTransport>();

/** The transport for the thread on screen: this computer's pty host, or one per followed computer. */
export function ptyTransportFor(origin: ThreadOrigin): PtyTransport {
  if (origin.kind === 'local') return localPty;
  const id = origin.machine.id;
  let transport = remotes.get(id);
  if (!transport) remotes.set(id, (transport = remotePty(id)));
  return transport;
}
