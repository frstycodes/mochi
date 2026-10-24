import { app, BrowserWindow, safeStorage, webContents } from 'electron';
import { Effect, Schedule, Stream } from 'effect';
import type { AgentDecision, AgentEvent, AgentStartOptions, AgentToolCall, AgentToolResult, StartWorkspace } from '../../src/host/types/agent.ts';
import type { AgentLogin } from '../../src/host/types/settings.ts';
import type { Provider } from '../../src/model.ts';
import type { MochiScope } from '../../src/runtime/toolTable.ts';
import { mainCoreClient } from '@mochi/core/host';
import { makeHostCaller } from '@mochi/core/hostClient';
import { useAgentConfig } from '@mochi/core/agents/config';
import type { MainForAgents } from '@mochi/core/agents/main';
import { setDataDir } from '@mochi/core/agents/paths';
import { cachedDoc, writeDoc } from '@mochi/core/store/client';
import { stopCompare } from '../browser/compare.ts';
import { sessionConnectors, sessionToolRules } from '../library/connectors.ts';
import { sessionLibrary } from '../library/store.ts';
import { callMochi, codexUrl, resolveToolCall, undeliveredToolCalls } from '../mcp/server.ts';
import { killThreadSessions } from '../pty/sessions.ts';
import { mainWindow } from '../window.ts';

// Agents run in Core (packages/core/src/agents). Main relays what they push to its windows, keeps the busy set its
// scheduler and keep-awake read, and serves Core the few things that need Electron (`mainForAgents`).

type Tap = (event: AgentEvent) => void;

const taps = new Set<Tap>();
const busyTaps = new Set<() => void>();
let busy = new Set<string>();
let whenClosed: Tap = () => {};

setDataDir(() => app.getPath('userData'));
useAgentConfig({
  read: () => cachedDoc('settings', 'agent'),
  write: (value) => writeDoc('settings', 'agent', value),
  keychain: {
    isAvailable: async () => safeStorage.isEncryptionAvailable(),
    encrypt: async (text) => safeStorage.encryptString(text).toString('base64'),
    decrypt: async (base64) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('The OS keychain is not available');
      return safeStorage.decryptString(Buffer.from(base64, 'base64'));
    },
  },
});

const coreCall = async (tag: string, args: unknown) => makeHostCaller(await mainCoreClient())(tag, args);

// The stream ends with the socket; after Core restarts, the redialled client subscribes again.
void mainCoreClient().then((client) =>
  Effect.runFork(client.agentPush().pipe(Stream.runForEach((item) => Effect.sync(() => deliver(item))), Effect.ignore, Effect.repeat(Schedule.spaced(250)))),
);

function deliver({ channel, payload, windowId }: { channel: string; payload: unknown; windowId?: number }) {
  if (channel === 'mochi:busy') return setBusy(payload as string[]);
  if (windowId !== undefined) {
    const target = webContents.fromId(windowId);
    if (target && !target.isDestroyed()) target.send(channel, payload);
    return;
  }
  if (channel === 'agent:onEvent') {
    const event = payload as AgentEvent;
    for (const tap of taps) tap(event);
    if (!mainWindow()) whenClosed(event);
  }
  for (const win of openWindows()) win.webContents.send(channel, payload);
}

function setBusy(threads: string[]) {
  const was = busy.size > 0;
  busy = new Set(threads);
  if (was !== busy.size > 0) busyTaps.forEach((tap) => tap());
}

/** Starts a thread's agent in Core, as the renderer does. */
export async function startAgent(threadId: string, options: AgentStartOptions & { worktree?: string }) {
  const { worktree, ...start } = options;
  // A trigger saved before workspaces carries `worktree: <branch>`; the RPC schema passes only `workspace` on.
  const workspace = start.workspace ?? (worktree === undefined ? undefined : ({ mode: 'worktree', branch: worktree } satisfies StartWorkspace));
  await coreCall('agent.start', [threadId, { ...start, ...(workspace && { workspace }) }]);
}

/** Answers a pending approval from a notification's buttons, and tells every window it was answered. */
export async function resolveRequest(threadId: string, requestId: string, decision: AgentDecision) {
  await coreCall('agent.resolve', [requestId, decision]);
  await coreCall('agentEmit', { event: { threadId, type: 'resolved', requestId } satisfies AgentEvent });
}

/** Detection saw this account's login; Core drops the account's model list when it changed. */
export const noteLogin = (accountId: string, login: AgentLogin) => void coreCall('agentNoteLogin', { accountId, login }).catch(() => {});

export function onAgentEvent(tap: Tap) {
  taps.add(tap);
  return () => void taps.delete(tap);
}

/** Set once by the scheduler, which keeps events for the next window. */
export function keepWhenClosed(keep: Tap) {
  whenClosed = keep;
}

export const isBusy = (threadId: string) => busy.has(threadId);
export const isAnyBusy = () => busy.size > 0;

/** Fires when the first turn starts or the last one ends. */
export function onBusyChange(tap: () => void) {
  busyTaps.add(tap);
  return () => void busyTaps.delete(tap);
}

export const openWindows = () => BrowserWindow.getAllWindows().filter((w) => !w.webContents.isDestroyed());

/** The `main` capability: what Core's agents can't do without Electron, the window, or main's library. */
export const mainForAgents = {
  mochiTool: (thread: string, name: string, args: Record<string, unknown>) => callMochi(thread, name, args),
  pendingToolCalls: async (windowId: number | undefined): Promise<AgentToolCall[]> => {
    const sender = (windowId === undefined ? undefined : webContents.fromId(windowId)) ?? mainWindow()?.webContents;
    return sender ? undeliveredToolCalls(sender) : [];
  },
  toolResult: async (id: string, result: AgentToolResult) => resolveToolCall(id, result),
  codexUrl: (thread: string, scope: MochiScope) => codexUrl(thread, scope),
  library: async (spaceId: string, provider: Provider) => {
    const [library, connectors, rules] = await Promise.all([sessionLibrary(spaceId, provider), sessionConnectors(spaceId), sessionToolRules(spaceId)]);
    return { ...library, connectors, rules };
  },
  settle: async (threadId: string) => {
    killThreadSessions(threadId);
    await stopCompare(threadId);
  },
} satisfies MainForAgents;
