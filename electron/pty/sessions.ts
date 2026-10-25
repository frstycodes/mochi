import type { WebContents } from 'electron';
import { spawn, type IPty } from 'node-pty';
import type {
  PtyData,
  PtyExit,
  PtySpawnOptions,
} from '../../src/host/types/pty.ts';
import { ensureSpawnHelper, shellLaunch } from './shell.ts';

const sessions = new Map<
  string,
  { pty: IPty; owner: WebContents; threadId: string }
>();
const watched = new WeakSet<WebContents>();
let nextId = 0;

export function spawnSession(
  owner: WebContents,
  { cwd, cols, rows, command, port, threadId }: PtySpawnOptions,
) {
  ensureSpawnHelper();
  const { file, args, env } = shellLaunch();
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
  watchOwner(owner);
  pty.onData(
    (data) =>
      !owner.isDestroyed() &&
      owner.send('pty:onData', { id, data } satisfies PtyData),
  );
  pty.onExit(({ exitCode }) => {
    sessions.delete(id);
    if (!owner.isDestroyed())
      owner.send('pty:onExit', { id, exitCode } satisfies PtyExit);
  });
  // Without the zsh hook, typing early is the fallback; the shell may echo it once more before its prompt.
  if (command && !hasZshHooks) pty.write(`${command}\r`);
  return { id };
}

/** Only the renderer that spawned a session may drive it. */
export function ownedSession(owner: WebContents, id: string) {
  const session = sessions.get(id);
  if (!session || session.owner !== owner) throw new Error(`unknown pty ${id}`);
  return session.pty;
}

/** A settled thread's terminals, and the dev servers running in them; the renderer hears each exit like any other. */
export function killThreadSessions(threadId: string) {
  for (const session of sessions.values())
    if (session.threadId === threadId) session.pty.kill();
}

function killOwnedBy(owner: WebContents) {
  for (const [id, session] of sessions)
    if (session.owner === owner) {
      session.pty.kill();
      sessions.delete(id);
    }
}

// A reload or a closed window abandons its terminals; the renderer restores scrollback and spawns fresh shells.
function watchOwner(owner: WebContents) {
  if (watched.has(owner)) return;
  watched.add(owner);
  owner.on('destroyed', () => killOwnedBy(owner));
  owner.on(
    'did-start-navigation',
    ({ isMainFrame, isSameDocument }) =>
      isMainFrame && !isSameDocument && killOwnedBy(owner),
  );
}

process.on('exit', () => sessions.forEach(({ pty }) => pty.kill()));
