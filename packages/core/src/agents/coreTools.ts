import { Effect, Stream } from 'effect';
import { project } from '@mochi/domain';
import type { ToolName } from '@mochi/domain/runtime/toolTable';
import type { AgentToolResult } from '../../../../apps/desktop/src/host/types/agent.ts';
import {
  hearToolDecision,
  runTool,
  type ToolEnv,
} from '../../../../apps/desktop/src/runtime/tools.ts';
import { DEFAULT_PREFS } from '../../../../apps/desktop/src/settings/prefsDefaults.ts';
import type {
  Action,
  State,
} from '../../../../apps/desktop/src/store/types.ts';
import { NEEDS_APP } from '../browser/answers.ts';
import type { Commands } from '../store/commands.ts';
import type { Projection } from '../store/projection.ts';
import { agent } from './handlers.ts';

/**
 * The tools Core runs, whether or not a window is open: each reads and changes only threads, through Core's own dispatch.
 * `watch_thread` isn't one: the watch list is a window's (`watched`).
 */
export const CORE_TOOLS = new Set<ToolName>([
  'list_threads',
  'get_thread',
  'rename_thread',
  'settle_thread',
  'reactivate_thread',
  'pin_thread',
  'unpin_thread',
  'reorder_threads',
  'settle_when_merged',
  'create_thread',
  'request_orchestration_grant',
  'dismiss_thread_proposal',
  'send_to_thread',
  'report_turn',
  'report_to_parent',
  'update_plan',
  'start_subagent',
]);

/**
 * Runs a thread tool in Core on its own projection: an action applies to the call's view of the state at once and goes to
 * `Commands`, which makes the agent calls it means; the call answers once its commands are logged. A call that asks waits
 * for a `tool-decision` from any window or device (`hearDecisions`), until its deadline. None of these tools toasts: what
 * one changes shows in the thread. Without your agent settings in Core's context yet (a window sends them), every call is
 * refused rather than run on the defaults.
 */
export function coreToolRunner(
  projection: Projection['Service'],
  commands: Commands['Service'],
) {
  return async (
    thread: string,
    name: string,
    args: unknown,
  ): Promise<AgentToolResult> => {
    const { domain } = Effect.runSync(projection.current);
    // A context saved before these prefs joined it has none of them.
    if (
      !Effect.runSync(projection.isContextSet) ||
      domain.context.prefs.agentControl === undefined
    )
      return { text: `${name} ${NEEDS_APP}`, isError: true };
    // Layout, panes and the rest stay per window; no Core tool reads them (as the reactor's `execute`).
    let state = domain as unknown as State;
    let sent: Promise<unknown> = Promise.resolve();
    const dispatch = (action: Action) => {
      state = { ...state, ...project(state, action) };
      sent = sent.then(() => Effect.runPromise(commands.submit(action)));
    };
    const result = await runTool(
      {
        id: `core-${crypto.randomUUID()}`,
        threadId: thread,
        name,
        args: args as Record<string, unknown>,
      },
      coreEnv(() => state, dispatch),
    );
    await sent;
    return result;
  };
}

/** Every `tool-decision` Core folds, from a window or a device, reaches the call in Core waiting on it. */
export const hearDecisions = (projection: Projection['Service']) =>
  Stream.runForEach(projection.folded, ({ action, before }) =>
    Effect.sync(() => hearToolDecision(action, before as unknown as State)),
  );

function coreEnv(
  getState: () => State,
  dispatch: (action: Action) => void,
): ToolEnv {
  const absent = (what: string) => () => {
    throw new Error(`${what} ${NEEDS_APP}`);
  };
  return {
    getState,
    dispatch,
    prefs: {
      get: () => ({ ...DEFAULT_PREFS, ...getState().context.prefs }),
      set: absent('Changing settings'),
    },
    toast: () => {},
    notify: () => {},
    openSettingsChat: absent('Settings › Ask Mochi'),
    removeWorktree: absent('Removing a worktree'),
    pages: {
      get: () => undefined,
      update: absent('The browser'),
      open: absent('The browser'),
    },
    browser: unavailable('The browser'),
    projects: absent('Listing projects'),
    cwdOf: (thread) => thread.live?.cwd ?? null,
    models: (provider, spaceId) =>
      agent.models(undefined, provider, spaceId).catch(() => []),
    profiles: {
      list: () => getState().context.profiles ?? [],
      update: absent('Changing a profile'),
      remove: absent('Removing a profile'),
    },
    theme: () => 'system',
    settings: unavailable('Settings'),
    themes: unavailable('Themes'),
    library: unavailable('Connectors'),
    remote: unavailable('Remote access'),
    isDesktop: false,
    askSecondOpinion: absent('A second opinion'),
    devServers: unavailable('Dev servers'),
  };
}

/** A host none of `CORE_TOOLS` reaches: any method answers that it needs the app. */
const unavailable = <T extends object>(what: string) =>
  new Proxy({} as T, {
    get: () => () => Promise.reject(new Error(`${what} ${NEEDS_APP}`)),
  });
