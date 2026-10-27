import {
  browserStorage,
  persistedFamily,
  uiStorageEntries,
} from '../lib/uiStorage.ts';
import { queryClient } from '../query.ts';
import { queryKeys } from '../queryKeys.ts';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { SerializeAddon } from '@xterm/addon-serialize';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal, type IMarker } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { host } from '../host';
import { getPrefs, subscribePrefs } from '../settings/prefs';
import { filePathsIn } from './links';
import { onThemeChange, terminalTheme } from './theme';
import { TERMINAL_STORAGE_PREFIX } from './storage';

export type SessionKind = 'shell' | 'agent' | 'build';

export interface TerminalSession {
  id: string;
  title: string;
  kind: SessionKind;
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  serialize: SerializeAddon;
  /** xterm's host node. It moves between React mounts so the buffer and the shell survive tab switches. */
  element: HTMLDivElement;
  ptyId?: string;
  selection: string;
  failure?: { exitCode: number; output: string };
  agentRuns: number;
}

export interface TerminalGroup {
  key: string;
  sessions: TerminalSession[];
  /** One id, or two when split. */
  visible: string[];
  focused: string;
}

export interface TerminalLinks {
  openUrl(url: string): void;
  openFile(path: string): void;
}

interface GroupContext {
  cwd: string;
  threadId: string;
  links: TerminalLinks;
}

interface ShellOptions {
  title?: string;
  command?: string;
}

interface SavedGroup {
  sessions: { id: string; title: string; kind: SessionKind }[];
  visible: string[];
  focused: string;
  scrollback: Record<string, string>;
}

const terminalSlice = persistedFamily<SavedGroup | null>(
  TERMINAL_STORAGE_PREFIX,
  null,
);
const SAVED_SCROLLBACK_ROWS = 1000;
const FAILURE_OUTPUT_LINES = 80;
// 130 is Ctrl C, 143 SIGTERM (the Ports tab's stop): the user ended it, nothing to fix.
const IGNORED_EXIT_CODES = [0, 130, 143];

const groupsStore = createStore<{ groups: ReadonlyMap<string, TerminalGroup> }>(
  () => ({ groups: new Map() }),
);
const groups = () => groupsStore.getState().groups;
const contexts = new Map<string, GroupContext>();
const byPty = new Map<string, TerminalSession>();
// Output can beat the spawn reply that tells us which session a pty id belongs to.
const earlyOutput = new Map<string, string>();
let nextSessionId = 0;
let isWired = false;

export function useTerminalGroup(key: string) {
  return useStore(groupsStore, (s) => s.groups.get(key));
}

/** Creates the group on first use (restoring saved scrollback) and refreshes its link handlers on every call. */
export function ensureGroup(
  key: string,
  context: GroupContext,
  firstShell: ShellOptions = {},
) {
  contexts.set(key, context);
  if (groups().has(key)) return;
  wireHost();
  const saved = loadGroup(key);
  if (saved) {
    const sessions = saved.sessions.map((s) =>
      createSession(key, s.kind, s.title, { restored: saved.scrollback[s.id] }),
    );
    const idFor = (old: string) =>
      sessions[saved.sessions.findIndex((s) => s.id === old)]?.id;
    const visible = saved.visible.map(idFor).filter(Boolean);
    setGroup({
      key,
      sessions,
      visible: visible.length ? visible : [sessions[0].id],
      focused: idFor(saved.focused) ?? sessions[0].id,
    });
    return;
  }
  const shell = createSession(
    key,
    'shell',
    firstShell.title ?? 'zsh',
    firstShell,
  );
  setGroup({
    key,
    sessions: [shell, createSession(key, 'agent', 'Agent')],
    visible: [shell.id],
    focused: shell.id,
  });
}

/** Opens a new shell in the group, typing `command` into it, and shows it in the focused slot. Returns the shell's session id. */
export function addShell(
  key: string,
  context: GroupContext,
  options: ShellOptions = {},
) {
  // A brand-new group runs the command in its first shell instead of opening an idle one beside it.
  if (!groups().has(key) && !loadGroup(key)) {
    ensureGroup(key, context, options);
    return groups().get(key)!.focused;
  }
  ensureGroup(key, context);
  const session = createSession(
    key,
    'shell',
    options.title ?? shellTitle(groups().get(key)!),
    options,
  );
  updateGroup(key, (g) => ({
    ...g,
    sessions: [...g.sessions, session],
    visible: replaceFocused(g, session.id),
    focused: session.id,
  }));
  return session.id;
}

/** A shell's last lines of output, and whether its command failed, for an agent that has no view of the terminal. */
export function sessionOutput(key: string, id: string) {
  const session = groups()
    .get(key)
    ?.sessions.find((s) => s.id === id);
  if (!session) return { output: '', hasFailed: true };
  const { failure, term } = session;
  return {
    output: failure?.output ?? linesSince(term, 0),
    hasFailed: !!failure,
  };
}

export function showSession(key: string, id: string) {
  updateGroup(key, (g) => ({
    ...g,
    visible: g.visible.includes(id) ? g.visible : replaceFocused(g, id),
    focused: id,
  }));
}

export function closeSession(key: string, id: string) {
  const session = groups()
    .get(key)
    ?.sessions.find((s) => s.id === id);
  if (!session) return;
  if (session.ptyId) {
    byPty.delete(session.ptyId);
    void host.pty.kill(session.ptyId);
  }
  session.term.dispose();
  updateGroup(key, (g) => {
    const sessions = g.sessions.filter((s) => s.id !== id);
    const visible = g.visible.filter((v) => v !== id);
    const fallback = sessions.find((s) => s.kind === 'shell') ?? sessions[0];
    const shown = visible.length ? visible : fallback ? [fallback.id] : [];
    return {
      ...g,
      sessions,
      visible: shown,
      focused: g.focused === id ? (shown[0] ?? '') : g.focused,
    };
  });
}

/** The group's read-only Build session, created on first use, wiped for a new run and shown in the focused slot. */
export function startBuildLog(key: string, context: GroupContext) {
  ensureGroup(key, context);
  const existing = groups()
    .get(key)!
    .sessions.find((s) => s.kind === 'build');
  const session = existing ?? createSession(key, 'build', 'Build');
  if (!existing)
    updateGroup(key, (g) => ({ ...g, sessions: [...g.sessions, session] }));
  session.term.reset();
  showSession(key, session.id);
  return session;
}

export function clearFailure(key: string, id: string) {
  patchSession(key, id, { failure: undefined });
}

/** Writes agent tool runs the session hasn't shown yet. GAP: the `tick` sim has no command output, so only the command line shows. */
export function feedAgent(
  session: TerminalSession,
  runs: { who: string; command: string }[],
) {
  for (const run of runs.slice(session.agentRuns))
    session.term.write(
      `\x1b[2m${run.who}\x1b[0m \x1b[36m$\x1b[0m ${run.command}\r\n`,
    );
  session.agentRuns = runs.length;
}

function createSession(
  key: string,
  kind: SessionKind,
  title: string,
  options: { command?: string; restored?: string } = {},
): TerminalSession {
  const term = new Terminal({
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
    fontSize: getPrefs().terminalFontSize,
    lineHeight: 1.4,
    scrollback: getPrefs().terminalScrollback,
    macOptionIsMeta: true,
    // Without Core there is no shell; the web build's mock plays a scripted session.
    disableStdin: kind !== 'shell' || !host.hasCore,
    cursorInactiveStyle: 'none',
    // Token colors are tuned for text on `card`; programs also paint ANSI pairs like black on red. xterm nudges any pair under AA.
    minimumContrastRatio: 4.5,
    theme: terminalTheme(),
  });
  const element = document.createElement('div');
  element.className = 'size-full px-3 py-2';
  const session: TerminalSession = {
    id: `term-${++nextSessionId}`,
    title,
    kind,
    term,
    element,
    fit: new FitAddon(),
    search: new SearchAddon(),
    serialize: new SerializeAddon(),
    selection: '',
    agentRuns: 0,
  };
  for (const addon of [session.fit, session.search, session.serialize])
    term.loadAddon(addon);
  term.loadAddon(
    new WebLinksAddon((_event, url) => contexts.get(key)?.links.openUrl(url)),
  );
  term.registerLinkProvider({
    provideLinks(y, callback) {
      const line =
        term.buffer.active.getLine(y - 1)?.translateToString(true) ?? '';
      const links = filePathsIn(line).map(({ text, start }) => ({
        text,
        range: {
          start: { x: start + 1, y },
          end: { x: start + text.length, y },
        },
        activate: () => contexts.get(key)?.links.openFile(text),
      }));
      callback(links.length ? links : undefined);
    },
  });
  term.onSelectionChange(() =>
    patchSession(key, session.id, { selection: term.getSelection() }),
  );
  if (options.restored)
    term.write(
      `${options.restored}\r\n\x1b[2m[restored: new shell below]\x1b[0m\r\n`,
    );
  if (kind === 'agent')
    term.write(
      "\x1b[2mRead-only: the agent's commands show up here.\x1b[0m\r\n",
    );
  if (kind === 'build')
    term.write('\x1b[2mRead-only: Simulator builds stream here.\x1b[0m\r\n');
  if (kind === 'shell') startShell(key, session, options.command);
  return session;
}

function startShell(key: string, session: TerminalSession, command?: string) {
  const { term } = session;
  let commandStart: IMarker | undefined;
  term.parser.registerOscHandler(133, (data) => {
    if (data === 'C') {
      commandStart?.dispose();
      commandStart = term.registerMarker(0);
      if (session.failure)
        patchSession(key, session.id, { failure: undefined });
    } else if (data.startsWith('D;') && commandStart) {
      const exitCode = Number(data.slice(2));
      if (!IGNORED_EXIT_CODES.includes(exitCode))
        patchSession(key, session.id, {
          failure: { exitCode, output: linesSince(term, commandStart.line) },
        });
      commandStart.dispose();
      commandStart = undefined;
    }
    return true;
  });
  term.onData(
    (data) => session.ptyId && void host.pty.write(session.ptyId, data),
  );
  term.onResize(
    ({ cols, rows }) =>
      session.ptyId && void host.pty.resize(session.ptyId, cols, rows),
  );
  const { cwd, threadId } = contexts.get(key)!;
  void portFor(threadId)
    .then((port) =>
      host.pty.spawn({
        cwd,
        cols: term.cols,
        rows: term.rows,
        command,
        port,
        threadId,
      }),
    )
    .then(({ id }) => {
      session.ptyId = id;
      byPty.set(id, session);
      term.write(earlyOutput.get(id) ?? '');
      earlyOutput.delete(id);
      // The fit may have run before the shell existed.
      void host.pty.resize(id, term.cols, term.rows);
    })
    .catch((error: Error) =>
      term.write(
        `\x1b[31mCould not start a shell: ${error.message}\x1b[0m\r\n`,
      ),
    );
}

function linesSince(term: Terminal, fromLine: number) {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (
    let y = Math.max(
      fromLine,
      buffer.baseY + buffer.cursorY - FAILURE_OUTPUT_LINES,
    );
    y <= buffer.baseY + buffer.cursorY;
    y++
  )
    lines.push(buffer.getLine(y)?.translateToString(true) ?? '');
  return lines.join('\n').trim();
}

function portFor(threadId: string) {
  return queryClient.fetchQuery({
    queryKey: queryKeys.ports.threadPort(threadId),
    queryFn: () => host.ports.allocate(threadId),
    staleTime: Infinity,
  });
}

function shellTitle(group: TerminalGroup) {
  const count = group.sessions.filter((s) => s.kind === 'shell').length;
  return count === 0 ? 'zsh' : `zsh ${count + 1}`;
}

function replaceFocused(group: TerminalGroup, id: string) {
  if (group.visible.length < 2) return [id];
  return group.visible.map((v) => (v === group.focused ? id : v));
}

function wireHost() {
  if (isWired) return;
  isWired = true;
  host.pty.onData(({ id, data }) => {
    const session = byPty.get(id);
    if (session) session.term.write(data);
    else earlyOutput.set(id, (earlyOutput.get(id) ?? '') + data);
  });
  host.pty.onExit(({ id, exitCode }) => {
    byPty
      .get(id)
      ?.term.write(`\r\n\x1b[2m[process exited with ${exitCode}]\x1b[0m\r\n`);
    byPty.delete(id);
    earlyOutput.delete(id);
  });
  onThemeChange(() => {
    const theme = terminalTheme();
    groups().forEach((g) =>
      g.sessions.forEach((s) => (s.term.options.theme = theme)),
    );
  });
  subscribePrefs(() => {
    const { terminalFontSize, terminalScrollback } = getPrefs();
    groups().forEach((g) =>
      g.sessions.forEach((s) => {
        if (
          s.term.options.fontSize === terminalFontSize &&
          s.term.options.scrollback === terminalScrollback
        )
          return;
        s.term.options.fontSize = terminalFontSize;
        s.term.options.scrollback = terminalScrollback;
        // A hidden session's element is detached, so it has no size to fit to; it fits when it mounts again.
        if (s.element.isConnected) s.fit.fit();
      }),
    );
  });
  // Not for the web mock: it replays its demo on every spawn, so restored scrollback would just repeat it.
  if (host.hasCore)
    addEventListener('pagehide', () => groups().forEach(saveGroup));
}

/** Drops saved scrollback and wipes what open shells show above their prompt; the shells keep running. */
export function clearTerminalHistory() {
  for (const [key] of uiStorageEntries()) {
    if (!key.startsWith(TERMINAL_STORAGE_PREFIX)) continue;
    terminalSlice(key.slice(TERMINAL_STORAGE_PREFIX.length)).setState({
      value: null,
    });
    browserStorage.removeItem(key);
  }
  groups().forEach((g) =>
    g.sessions.forEach((s) => s.kind === 'shell' && s.term.clear()),
  );
}

function saveGroup(group: TerminalGroup) {
  const saved: SavedGroup = {
    sessions: group.sessions.map(({ id, title, kind }) => ({
      id,
      title,
      kind,
    })),
    visible: group.visible,
    focused: group.focused,
    scrollback: Object.fromEntries(
      group.sessions
        .filter((s) => s.kind === 'shell')
        .map((s) => [
          s.id,
          s.serialize.serialize({ scrollback: SAVED_SCROLLBACK_ROWS }),
        ]),
    ),
  };
  terminalSlice(group.key).setState({ value: saved });
}

function loadGroup(key: string): SavedGroup | null {
  if (!host.hasCore || !getPrefs().restoreTerminals) return null;
  try {
    const saved: SavedGroup | null = terminalSlice(key).getState().value;
    return saved?.sessions.length ? saved : null;
  } catch {
    return null;
  }
}

function patchSession(
  key: string,
  id: string,
  patch: Partial<TerminalSession>,
) {
  updateGroup(key, (g) => ({
    ...g,
    sessions: g.sessions.map((s) =>
      s.id === id ? Object.assign(s, patch) : s,
    ),
  }));
}

function updateGroup(key: string, fn: (group: TerminalGroup) => TerminalGroup) {
  const group = groups().get(key);
  if (group) setGroup(fn(group));
}

function setGroup(group: TerminalGroup) {
  groupsStore.setState(({ groups }) => ({
    groups: new Map(groups).set(group.key, group),
  }));
}
