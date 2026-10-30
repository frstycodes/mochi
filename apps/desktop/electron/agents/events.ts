import { app, BrowserWindow, shell, webContents } from 'electron';
import { canStore, open, seal } from '../secrets';
import { Cause, Effect, Schedule, Stream } from 'effect';
import type {
  AgentDecision,
  AgentEvent,
  AgentStartOptions,
  AgentToolCall,
  AgentToolResult,
  StartWorkspace,
} from '../../src/host/types/agent.ts';
import type { AgentLogin } from '../../src/host/types/settings.ts';
import type { MochiScope } from '@mochi/domain/runtime/toolTable';
import { mainCoreClient } from '@mochi/core/host';
import { makeHostCaller } from '@mochi/core/hostClient';
import {
  AGENT_SETTINGS_SAVED,
  agentConfigChanged,
  useAgentConfig,
} from '@mochi/core/agents/config';
import type { MainForAgents } from '@mochi/core/agents/main';
import { setDataDir } from '@mochi/core/agents/paths';
import { cacheDoc, cachedDoc } from '@mochi/core/store/client';
import { stopCompare } from '../browser/compare.ts';
import {
  forgetAccount,
  sessionConnectors,
  sessionToolRules,
} from '../library/connectors.ts';
import {
  callMochi,
  codexUrl,
  killGuardUrl,
  resolveToolCall,
  undeliveredToolCalls,
} from '../mcp/server.ts';
import { hearRemotePush } from '../remote/index.ts';
import { holdAwake } from '../remote/keepAwake.ts';
import { mainWindow } from '../window.ts';

// Agents run in Core (packages/core/src/agents). Main relays what they push to its windows and serves Core the few things
// that need Electron (`mainForAgents`).

type Tap = (event: AgentEvent) => void;

const taps = new Set<Tap>();
let whenClosed: Tap = () => {};

setDataDir(() => app.getPath('userData'));
useAgentConfig({
  read: () => cachedDoc('settings', 'agent'),
  write: async () => {
    throw new Error('Agent settings are written by Core');
  },
  keychain: {
    isAvailable: async () => canStore(),
    encrypt: async (text) => seal(text),
    decrypt: async (base64) => open(base64),
  },
});

const coreCall = async (tag: string, args: unknown) =>
  makeHostCaller(await mainCoreClient())(tag, args);

// The stream ends with the socket; after Core restarts, the redialled client subscribes again.
void mainCoreClient().then((client) =>
  Effect.runFork(
    client.agentPush().pipe(
      Stream.runForEach((item) => Effect.sync(() => deliver(item))),
      Effect.catchCause((cause) =>
        Effect.sync(() =>
          console.warn(
            'Agent push stream ended; subscribing again',
            Cause.pretty(cause),
          ),
        ),
      ),
      Effect.repeat(Schedule.spaced(250)),
    ),
  ),
);

function deliver({
  channel,
  payload,
  windowId,
}: {
  channel: string;
  payload: unknown;
  windowId?: number;
}) {
  // Core's busy set: keep-awake reads it there now (packages/core/src/remote/service.ts).
  if (channel === 'mochi:busy') return;
  // Core's account and remote access: main's followers and the main window follow them; most go on to every window too.
  if (hearRemotePush(channel, payload)) return;
  if (channel === AGENT_SETTINGS_SAVED) {
    cacheDoc('settings', 'agent', payload);
    return agentConfigChanged();
  }
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

/** Starts a thread's agent in Core, as the renderer does. */
export async function startAgent(
  threadId: string,
  options: AgentStartOptions & { worktree?: string },
) {
  const { worktree, ...start } = options;
  // A trigger saved before workspaces carries `worktree: <branch>`; the RPC schema passes only `workspace` on.
  const workspace =
    start.workspace ??
    (worktree === undefined
      ? undefined
      : ({ mode: 'worktree', branch: worktree } satisfies StartWorkspace));
  await coreCall('agent.start', [
    threadId,
    { ...start, ...(workspace && { workspace }) },
  ]);
}

/** Answers a pending approval from a notification's buttons, and tells every window it was answered. */
export async function resolveRequest(
  threadId: string,
  requestId: string,
  decision: AgentDecision,
) {
  await coreCall('agent.resolve', [requestId, decision]);
  await coreCall('agentEmit', {
    event: { threadId, type: 'resolved', requestId } satisfies AgentEvent,
  });
}

/** Detection saw this account's login; Core drops the account's model list when it changed. */
export const noteLogin = (accountId: string, login: AgentLogin) =>
  void coreCall('agentNoteLogin', { accountId, login }).catch(() => {});

export function onAgentEvent(tap: Tap) {
  taps.add(tap);
  return () => void taps.delete(tap);
}

/** Set once by the scheduler, which keeps events for the next window. */
export function keepWhenClosed(keep: Tap) {
  whenClosed = keep;
}

export const openWindows = () =>
  BrowserWindow.getAllWindows().filter((w) => !w.webContents.isDestroyed());

/** The `main` capability: what Core's agents and library can't do without Electron, the window, or main's connector accounts. */
export const mainForAgents = {
  mochiTool: (thread: string, name: string, args: Record<string, unknown>) =>
    callMochi(thread, name, args),
  pendingToolCalls: async (
    windowId: number | null,
  ): Promise<AgentToolCall[]> => {
    const sender =
      (windowId === null ? undefined : webContents.fromId(windowId)) ??
      mainWindow()?.webContents;
    return sender ? undeliveredToolCalls(sender) : [];
  },
  toolResult: async (id: string, result: AgentToolResult) =>
    resolveToolCall(id, result),
  codexUrl: (thread: string, scope: MochiScope) => codexUrl(thread, scope),
  killGuardUrl: () => killGuardUrl(),
  connectors: async (spaceId: string) => {
    const [connectors, rules] = await Promise.all([
      sessionConnectors(spaceId),
      sessionToolRules(spaceId),
    ]);
    return { connectors, rules };
  },
  forgetConnector: async (id: string) => {
    await forgetAccount(id);
  },
  // Core kills the thread's terminals itself (packages/core/src/pty/sessions.ts).
  settle: async (threadId: string) => {
    await stopCompare(threadId);
  },
  openExternal: (url: string) => shell.openExternal(url),
  holdAwake: async (isHeld: boolean) => holdAwake(isHeld),
} satisfies MainForAgents;
