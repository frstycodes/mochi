import { spawn, type IPty } from 'node-pty';
import type {
  PtyData,
  PtyExit,
  PtySpawnOptions,
} from '@mochi/domain/host/types/pty';
import { push } from '../agents/events.ts';
import type { Caller } from '../hostMethods.ts';
import { ensureSpawnHelper, shellLaunch } from './shell.ts';

/** A session belongs to the connection that spawned it (`Caller.closed`); a reload or a closed window opens a new one. */
const sessions = new Map<
  string,
  { pty: IPty; owner: AbortSignal; threadId: string }
>();
let nextId = 0;

export function spawnSession(
  { windowId, closed: owner }: Caller,
  userData: string,
  { cwd, cols, rows, command, port, threadId }: PtySpawnOptions,
) {
  ensureSpawnHelper();
  const { file, args, env } = shellLaunch(userData);
  const hasZshHooks = 'ZDOTDIR' in env;
  const pty = spawn(file, args, {
    name: 'xterm-256color',
    cwd,
    cols,
    rows,
    env: {
      ...process.env,
      ...env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'Mochi',
      ...(port && { PORT: String(port) }),
      ...(command && hasZshHooks && { HARNESS_COMMAND: command }),
    },
  });
  const id = `pty-${++nextId}`;
  sessions.set(id, { pty, owner, threadId });
  // A reload or a closed window abandons its terminals; the renderer restores scrollback and spawns fresh shells.
  owner.addEventListener('abort', () => killOwnedBy(owner), { once: true });
  pty.onData((data) =>
    push({
      channel: 'pty:onData',
      payload: { id, data } satisfies PtyData,
      windowId,
    }),
  );
  pty.onExit(({ exitCode }) => {
    sessions.delete(id);
    if (!owner.aborted)
      push({
        channel: 'pty:onExit',
        payload: { id, exitCode } satisfies PtyExit,
        windowId,
      });
  });
  // Without the zsh hook, typing early is the fallback; the shell may echo it once more before its prompt.
  if (command && !hasZshHooks) pty.write(`${command}\r`);
  return { id };
}

/** Only the connection that spawned a session may drive it. */
export function ownedSession({ closed: owner }: Caller, id: string) {
  const session = sessions.get(id);
  if (!session || session.owner !== owner) throw new Error(`unknown pty ${id}`);
  return session.pty;
}

export function killSession(caller: Caller, id: string) {
  ownedSession(caller, id);
  end(id);
}

/** A settled thread's terminals, and the dev servers running in them; the renderer hears each exit like any other. */
export function killThreadSessions(threadId: string) {
  for (const [id, session] of sessions)
    if (session.threadId === threadId) end(id);
}

function killOwnedBy(owner: AbortSignal) {
  for (const [id, session] of sessions) if (session.owner === owner) end(id);
}

// Each session is killed once: killing a ConPTY twice (a kill, then its connection closing, then exit) can crash on Windows.
function end(id: string) {
  const session = sessions.get(id);
  sessions.delete(id);
  session?.pty.kill();
}

process.on('exit', () => [...sessions.keys()].forEach(end));
