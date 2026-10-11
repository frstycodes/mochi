import type { PtyData, PtyExit, PtyHost } from '../types/pty.ts';

const listeners = new Set<(event: PtyData) => void>();
const emit = (event: PtyData) => listeners.forEach((listener) => listener(event));
let nextId = 0;

// OSC 133 C/D marks match what the desktop zsh integration prints, so the web demo shows the "Ask agent to fix" flow too.
const START = '\x1b]133;C\x07';
const end = (code: number) => `\x1b]133;D;${code}\x07`;
const prompt = (cwd: string) => `\x1b[2m${cwd === '.' ? '~/latitude' : cwd}\x1b[0m $ `;
const demo = (cwd: string) =>
  [
    `${prompt(cwd)}pnpm dev\r\n${START}`,
    '\r\n  \x1b[32mVITE\x1b[0m v8.3.4  ready in 412 ms\r\n\r\n',
    '  Local:   \x1b[36mhttp://localhost:5173/\x1b[0m\r\n',
    '  \x1b[33mwarn\x1b[0m src/routes/admin/usage.tsx:42:7 unused import BarChart\r\n^C\r\n',
    `${end(130)}${prompt(cwd)}pnpm --filter api test usage\r\n${START}`,
    '\r\n \x1b[31mFAIL\x1b[0m apps/api/routes/admin/usage.test.ts:18:5\r\n',
    '   expected cursor to be "k_0420", got undefined\r\n\r\n Tests  1 failed | 11 passed\r\n',
    `${end(1)}${prompt(cwd)}`,
  ].join('');

// The web build has no shell: spawn plays a scripted session, write echoes so the terminal still reacts.
export const pty: PtyHost = {
  async spawn({ cwd }) {
    const id = `pty-${++nextId}`;
    queueMicrotask(() => emit({ id, data: demo(cwd) }));
    return { id };
  },
  async write(id, data) {
    emit({ id, data });
  },
  async resize() {},
  async kill() {},
  onData(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  onExit(_listener: (event: PtyExit) => void) {
    return () => {};
  },
};
