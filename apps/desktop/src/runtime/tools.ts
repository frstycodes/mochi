import type { Page } from '../browser/pages.ts';
import type {
  AgentModel,
  AgentPlanItem,
  AgentToolCall,
  AgentToolResult,
} from '../host/types/agent.ts';
import type { BrowserHost } from '@mochi/domain/host/types/browser';
import type { FileEdit, SettingsHost } from '../host/types/settings.ts';
import type { RemoteHost } from '../host/types/remote.ts';
import type { LibraryHost } from '../host/types/library.ts';
import type { DataHost } from '../host/types/data.ts';
import type { PortsHost, RunTarget } from '@mochi/domain/host/types/ports';
import type { ThemesHost } from '@mochi/domain/host/types/themes';
import type { Project } from '@mochi/domain/host/types/projects';
import {
  nextProposalId,
  PROPOSALS_PER_TURN,
  proposalBlocker,
  turnOf,
  turnProposalCount,
} from '../chat/proposals.ts';
import {
  durationText,
  grantStatus,
  hadGrant,
  nextGrantId,
  pendingGrant,
  threadsLeft,
  usableGrant,
} from '../chat/grants.ts';
import { receivedPrompt } from '../chat/threadMessages.ts';
import { reportItems } from '../goals/ledger.ts';
import {
  authorName,
  isListed,
  PIN_SLOTS,
  type DevServer,
  type EventGlyph,
  type Provider,
  type QueueItem,
  type Space,
  type Step,
  type Thread,
  type ThreadProposal,
} from '../model.ts';
import { projectName, projectRef } from '../projects.ts';
import { activeThreads, dropPin, pinnedThreads } from '../reorder.ts';
import { redactSecrets, type ConfigChange } from '../settings/agentConfig.ts';
import { AGENT_CONTROL } from '../settings/settingOptions.ts';
import {
  AGENT_CONTROLS,
  type AgentControl,
  type Prefs,
} from '../settings/prefs.ts';
import type { Action, State } from '../store/index.tsx';
import { providerName } from '../secondOpinion/verdict.ts';
import { BROWSER_TOOLS } from './browserTools.ts';
import { DEV_SERVER_TOOLS } from './devServerTools.ts';
import { SETTINGS_TOOLS } from './settingsTools.ts';
import { controlsOf, DEFAULT_CONTROLS } from './controls.ts';
import { resolveRun } from './models.ts';
import {
  APPROVAL_TIMEOUT_MS,
  decodeArgs,
  isQuiet,
  tierOf,
  TOOL_TABLE,
  type ArgsOf,
  type ToolName,
} from '@mochi/domain/runtime/toolTable';
import { LEVEL, toolPolicy } from './toolPolicy.ts';
import { applyUndo, captureUndo } from './undo.ts';
import { plural } from '@mochi/domain/lib/format';

/** What the store and the app give a tool run. The renderer wires the real ones (`store/index.tsx`); tests pass stubs. */
export interface ToolEnv {
  getState: () => State;
  /** Applies `action`; `getState` returns the state after it straight away. */
  dispatch: (action: Action) => void;
  /** Mochi's prefs: the agent-control level, and what `get_settings` reads. */
  prefs: { get: () => Prefs; set: (patch: Partial<Prefs>) => void };
  /** A toast for a change; `onUndo` set when it can be undone. */
  toast: (text: string, onUndo?: () => void) => void;
  notify: (title: string, body: string) => void;
  /** Drafts `prompt` in the profile's settings chat and toasts an Open; never moves the user there. */
  openSettingsChat: (spaceId: string, prompt: string) => void;
  /** Removes a thread's worktree from disk after a delete; resolves when done. */
  removeWorktree: (threadId: string) => Promise<void>;
  /** The browser tabs' pages (`src/browser/pages.ts`) and main's native views behind them. */
  pages: {
    get: (key: string) => Page | undefined;
    update: (key: string, patch: Partial<Page>) => void;
    open: (key: string, url: string, spaceId: string) => void;
  };
  browser: Pick<
    BrowserHost,
    | 'navigate'
    | 'command'
    | 'capture'
    | 'snapshot'
    | 'act'
    | 'logs'
    | 'eval'
    | 'waitFor'
    | 'answerDialog'
  >;
  /** The profile's projects, which `move_to_project` offers. */
  projects: (spaceId: string) => Promise<Project[]>;
  /** The folder a thread's agent runs in (its worktree), for checking upload paths. */
  cwdOf: (thread: Thread) => string | null | undefined;
  /** The models `provider` offers the profile's account; empty when they couldn't be read. */
  models: (provider: Provider, spaceId: string) => Promise<AgentModel[]>;
  /** Profiles (`src/profiles.ts`); removing one leaves its accounts and browser data on disk. */
  profiles: {
    list: () => Space[];
    update: (id: string, patch: Partial<Pick<Space, 'name' | 'icon'>>) => void;
    remove: (id: string) => void;
  };
  /** The app theme (next-themes' stored choice), which `get_settings` reads. */
  theme: () => string;
  /**
   * The settings tools' slice of `host.settings`: reads, and the delete card's config write. Nothing that creates, signs
   * in or stores a credential, and nothing that sets a setting: only the user does that, on the widget.
   */
  settings: Pick<
    SettingsHost,
    | 'get'
    | 'accounts'
    | 'detect'
    | 'agentConfig'
    | 'previewConfig'
    | 'applyConfig'
    | 'testMcp'
  >;
  /** Installed color themes and Settings › Remote access, read for `get_settings`. */
  themes: Pick<ThemesHost, 'list'>;
  /** The profile library's connector accounts, read for `list_connectors`; adding one is the user's, on the widget. */
  library: Pick<
    LibraryHost,
    | 'list'
    | 'oauthApps'
    | 'ownAppRedirect'
    | 'addConnector'
    | 'onAuthorize'
    | 'onDeviceCode'
    | 'runSetup'
    | 'updateSetupStep'
  >;
  remote: Pick<RemoteHost, 'status'>;
  isDesktop: boolean;
  /** Starts a second opinion on `thread` from the other provider, resolving with the reviewer; throws why it can't. */
  askSecondOpinion: (thread: Thread) => Promise<Provider>;
  /** `start_dev_server`'s host: `cwd`'s run targets and listening ports, a target run in the thread's terminal, a screenshot kept on disk. */
  devServers: {
    targets: PortsHost['targets'];
    list: PortsHost['list'];
    run: (
      target: RunTarget,
      thread: Thread,
      cwd: string,
    ) => Promise<() => ShellOutput>;
    saveImage: DataHost['saveImage'];
  };
  now?: () => number;
}

export interface ShellOutput {
  output: string;
  hasFailed: boolean;
}

export interface ToolContext<A = Record<string, unknown>> {
  env: ToolEnv;
  caller: Thread;
  args: A;
  state: () => State;
  dispatch: (action: Action) => void;
  /** Asks the user on a widget mid-run (browser escalation); throws when the setting doesn't allow it or they deny. */
  confirm: (approval: Approval) => Promise<string[]>;
  /** Asks the user to pick one of `options` on a widget, at any agent setting: a question, not a permission. */
  choose: (question: {
    title: string;
    detail?: string;
    options: string[];
  }) => Promise<string>;
  /** Waits on a widget for something only the user can do, at any agent setting; throws when they cancel it. */
  waitOn: (approval: Approval) => Promise<string[]>;
  /** Widgets this call opened and the user approved; the last one's record becomes what the call changed. */
  cards: string[];
  /** When waiting on the user must end; a batch's steps share their batch's, so it never outlasts the harness's timeout. */
  deadline: number;
  /** A config write `ask` previewed: `run` applies exactly these changes, refused if a file changed since (`befores`). */
  write?: {
    spaceId: string;
    changes: ConfigChange[];
    befores: Record<string, string>;
  };
}

/** The widget's text says exactly what happens; `options` are checkboxes, off by default, whose ids come back when approved. */
export interface Approval {
  title: string;
  detail: string;
  options?: { id: string; label: string }[];
  /** A question with one answer: `options` become radio buttons, one must be picked, and its id comes back. */
  pick?: 'one';
  /** Shown whole on the widget, like a script about to run. */
  code?: string;
  /** A delete: the widget's primary is a red Delete. */
  isDestructive?: boolean;
  /** The record line when the user says no, like "Kept \"Fix e2e\"". */
  denied?: string;
  /** The record line when the user says yes, in place of "Approved: <title>". */
  approved?: string;
  /** A handoff: the widget reads as the user's turn, with Done. */
  isHandoff?: boolean;
  /** Settles the widget as approved, with its answer as the one option, without the user; aborted once they answer. */
  until?: (signal: AbortSignal) => Promise<string>;
  edits?: FileEdit[];
  notes?: string[];
}

export interface Outcome {
  result: unknown;
  /** Past tense, for the thread log and the toast after the agent's name: "settled 2 threads". */
  changed?: string;
  image?: AgentToolResult['image'];
  /** The change can't be put back (a click, a sent message), so its toast has no Undo. */
  isFinal?: boolean;
  /** Puts it back when the store snapshot can't, like stopping and removing a thread the call started. */
  undo?: () => void;
  /** Its line's icon and the page it acted on (favicon and host), for browser actions. */
  glyph?: EventGlyph;
  site?: string;
  /** The dev server its line shows as a card. */
  devServer?: DevServer;
}

export type Args<K extends ToolName> = ArgsOf<(typeof TOOL_TABLE)[K]['shape']>;

export interface ToolSpec<K extends ToolName> {
  run: (
    ctx: ToolContext<Args<K>>,
    options: string[],
  ) => Outcome | Promise<Outcome>;
  /** Tools in an asking tier: what the widget says. Undefined: this call doesn't ask. */
  ask?: (
    ctx: ToolContext<Args<K>>,
  ) => Approval | undefined | Promise<Approval | undefined>;
}

type Specs = { [K in ToolName]: ToolSpec<K> };

const levelLabel = (control: AgentControl) =>
  AGENT_CONTROL.options.find((o) => o.value === control)!.label;

/**
 * Runs a Mochi tool an agent called (RUNTIME.md › Mochi tools): checks scope and the level the setting allows, asks on
 * a widget in the thread for deletes and settings, runs the handler on the store, logs it, and toasts with Undo.
 */
export async function runTool(
  call: AgentToolCall,
  env: ToolEnv,
  deadline = Date.now() + APPROVAL_TIMEOUT_MS,
): Promise<AgentToolResult> {
  const caller = env.getState().threads.find((t) => t.id === call.threadId);
  if (!caller) return fail(`No thread ${call.threadId}`);
  if (!Object.hasOwn(TOOL_TABLE, call.name))
    return fail(`No Mochi tool ${call.name}`);
  const name = call.name as ToolName;
  const parsed = decodeArgs(TOOL_TABLE[name].shape, call.args);
  if ('error' in parsed) return fail(parsed.error);
  const ctx = context(env, caller, parsed.args, name, deadline);
  const spec = SPECS[name] as ToolSpec<ToolName>;
  const tier = tierOf(name);
  const { policy, isChosen } = toolPolicy(
    name,
    env.prefs.get().agentControl,
    env.prefs.get().toolPolicies,
  );
  try {
    if (isChosen && policy === 'off')
      throw new Error(
        `The user turned ${name} off for agents in Settings › Mochi access. Don't call it again unless they turn it back on.`,
      );
    if (!isChosen) gate(ctx, name, LEVEL[tier]);
    const asked = spec.ask?.(ctx);
    const approval =
      (asked instanceof Promise ? await asked : asked) ??
      (policy === 'ask' ? approvalFor(ctx, name) : undefined);
    // A sync ask opens its widget before runTool yields, so the widget is in the queue as soon as the call returns.
    const options = approval ? await ask(ctx, approval) : [];
    const before = env.getState();
    const outcome = await Promise.resolve()
      .then(() => spec.run(ctx, options))
      .catch((error: unknown) => {
        for (const id of ctx.cards)
          env.dispatch({
            type: 'card-record',
            queueId: id,
            text: `Failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        throw error;
      });
    if (outcome.changed && tier !== 'read') record(ctx, name, outcome, before);
    return {
      text: JSON.stringify(
        outcome.changed
          ? {
              changed: capitalize(outcome.changed),
              ...asObject(outcome.result),
            }
          : outcome.result,
      ),
      ...(outcome.image && { image: outcome.image }),
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/** Apply / Delete / Keep / Cancel on a widget land here; the waiting call goes on. */
export function decideTool(
  queueId: string,
  decision: { isApproved: boolean; options?: string[] },
) {
  waiting.get(queueId)?.(decision);
}

const waiting = new Map<
  string,
  (decision: { isApproved: boolean; options?: string[] }) => void
>();
let nextCard = 0;
// Widget ids land in saved thread activity, so they must not repeat after a reload resets the counter.
const RUN = Date.now().toString(36);
export const cardId = (kind: string, threadId: string) =>
  `q-${kind}-${threadId}-${RUN}-${++nextCard}`;

function context<A>(
  env: ToolEnv,
  caller: Thread,
  args: A,
  name: ToolName,
  deadline: number,
): ToolContext<A> {
  const ctx: ToolContext<A> = {
    env,
    caller,
    args,
    state: env.getState,
    dispatch: env.dispatch,
    confirm: (approval) => (gate(ctx, name, 'everything'), ask(ctx, approval)),
    choose: (q) => choose(ctx, q),
    waitOn: (approval) => ask(ctx, approval),
    cards: [],
    deadline,
  };
  return ctx;
}

/** A tool you set to ask first: the widget names the call and shows exactly what it was given. */
function approvalFor(ctx: ToolContext<unknown>, name: ToolName): Approval {
  const verb = name.replaceAll('_', ' ');
  return {
    title: `${authorName(ctx.caller.providers[0])} wants to ${verb}`,
    detail:
      'You asked to approve this tool each time in Settings › Mochi access.',
    code: JSON.stringify(ctx.args, null, 2),
    denied: `Didn't ${verb}`,
  };
}

/**
 * Throws when the setting is below `needs`, after putting that setting in the thread as a widget (once while it's open).
 * A tool you chose Allow or Ask for passes whatever the level, and so may ask mid-run (a browser escalation).
 */
function gate(ctx: ToolContext<unknown>, name: ToolName, needs: AgentControl) {
  const control = ctx.env.prefs.get().agentControl;
  if (toolPolicy(name, control, ctx.env.prefs.get().toolPolicies).isChosen)
    return;
  if (AGENT_CONTROLS.indexOf(control) >= AGENT_CONTROLS.indexOf(needs)) return;
  const verb = name.replaceAll('_', ' ');
  const shown = ctx
    .state()
    .queue.find(
      (q) =>
        q.threadId === ctx.caller.id &&
        q.settings?.changes.some((c) => c.key === 'agentControl'),
    );
  const item = card(
    ctx,
    shown?.id ?? cardId('setting', ctx.caller.id),
    'setting',
    {
      title: `${authorName(ctx.caller.providers[0])} wants to ${verb}`,
      detail: `${verb[0].toUpperCase()}${verb.slice(1)} needs "${levelLabel(needs)}". Ask it to try again after you change this.`,
      settings: {
        by: 'harness',
        changes: [{ key: 'agentControl', value: needs }],
        before: { agentControl: control },
      },
    },
  );
  // One widget per thread while it's open: a later call that needs more raises it in place.
  const suggested = shown?.settings?.changes.find(
    (c) => c.key === 'agentControl',
  )?.value as AgentControl | undefined;
  if (!shown) open(ctx, item);
  else if (AGENT_CONTROLS.indexOf(needs) > AGENT_CONTROLS.indexOf(suggested!))
    ctx.dispatch({ type: 'queue-add', item });
  throw new Error(
    `Blocked by the user's setting "Agents can change Mochi: ${levelLabel(control)}". ${name} needs "${levelLabel(needs)}". The user now sees that setting in this thread; ask them to change it, then call again.`,
  );
}

async function ask(
  ctx: ToolContext<unknown>,
  approval: Approval,
): Promise<string[]> {
  const id = cardId('tool', ctx.caller.id);
  const { options, pick, isDestructive, isHandoff, edits, notes } = approval;
  const tool = {
    callId: id,
    options,
    pick,
    isDestructive,
    isHandoff,
    notes,
    edits: edits?.map((e) => ({
      path: e.path,
      before: redactSecrets(e.before),
      after: redactSecrets(e.after),
    })),
  };
  open(
    ctx,
    card(ctx, id, 'approval', {
      title: approval.title,
      detail: approval.detail,
      code: approval.code,
      tool,
    }),
  );
  const watch = new AbortController();
  const decision = await new Promise<{
    isApproved: boolean;
    options?: string[];
  } | null>((resolve) => {
    const timer = setTimeout(
      () => resolve(null),
      Math.max(0, ctx.deadline - Date.now()),
    );
    waiting.set(id, (d) => (clearTimeout(timer), resolve(d)));
    approval.until?.(watch.signal).then(
      (answer) => decideTool(id, { isApproved: true, options: [answer] }),
      () => undefined,
    );
  });
  watch.abort();
  waiting.delete(id);
  const picked =
    pick && options?.find((o) => o.id === decision?.options?.[0])?.label;
  const text = !decision
    ? `Expired: ${approval.title}`
    : decision.isApproved
      ? picked
        ? `${approval.title} ${picked}`
        : (approval.approved ?? `Approved: ${approval.title}`)
      : (approval.denied ?? `Denied: ${approval.title}`);
  ctx.dispatch({ type: 'card-record', queueId: id, text });
  if (!decision) throw new Error('Nobody answered in time; nothing was done.');
  if (!decision.isApproved)
    throw new Error(`The user denied it: ${approval.title} Nothing was done.`);
  ctx.cards.push(id);
  return decision.options ?? [];
}

async function choose(
  ctx: ToolContext<unknown>,
  {
    title,
    detail = '',
    options,
  }: { title: string; detail?: string; options: string[] },
) {
  const [answer] = await ask(ctx, {
    title,
    detail,
    options: options.map((o) => ({ id: o, label: o })),
    pick: 'one',
    denied: `No answer to: ${title}`,
  });
  // An answer isn't an approval: the card keeps its own record, and the call logs what it changed on a line of its own.
  ctx.cards.pop();
  if (!answer) throw new Error(`No answer was picked: ${title}`);
  return answer;
}

/** A widget joins the queue and the caller's thread, at the point the agent asked. */
export function open(ctx: ToolContext<unknown>, item: QueueItem) {
  ctx.dispatch({ type: 'queue-add', item });
  ctx.dispatch({
    type: 'say',
    threadId: ctx.caller.id,
    entry: {
      who: ctx.caller.providers[0],
      kind: 'event',
      text: item.title,
      card: { id: item.id, isOpen: true },
    },
  });
}

export function card(
  ctx: ToolContext<unknown>,
  id: string,
  kind: QueueItem['kind'],
  item: Pick<QueueItem, 'title' | 'detail' | 'code' | 'tool' | 'settings'>,
): QueueItem {
  return {
    id,
    kind,
    threadId: ctx.caller.id,
    blocks: { steps: 0, threads: 1 },
    createdAt: ctx.state().now,
    ...item,
  };
}

/** A call that asked closes its widget with what changed; any other logs a line in the caller and toasts, with Undo when it can be put back. */
function record(
  ctx: ToolContext<unknown>,
  name: ToolName,
  outcome: Outcome,
  before: State,
) {
  const changed = outcome.changed!;
  const asked = ctx.cards.at(-1);
  const { glyph, site, devServer } = outcome;
  if (asked)
    return ctx.dispatch({
      type: 'card-record',
      queueId: asked,
      text: capitalize(changed),
      ...(glyph && { glyph }),
      ...(site && { site }),
    });
  const text = `${authorName(ctx.caller.providers[0])} ${changed}`;
  ctx.dispatch({
    type: 'say',
    threadId: ctx.caller.id,
    entry: {
      who: ctx.caller.providers[0],
      kind: 'event',
      text,
      ...(glyph && { glyph }),
      ...(site && { site }),
      ...(devServer && { devServer }),
    },
  });
  if (!isQuiet(name))
    ctx.env.toast(
      text,
      outcome.isFinal
        ? undefined
        : (outcome.undo ?? snapshotUndo(ctx.env, before)),
    );
}

function snapshotUndo(env: ToolEnv, before: State) {
  const undo = captureUndo(before, env.getState());
  if (!undo) return undefined;
  return () => {
    const { kept } = applyUndo(env.getState(), undo);
    env.dispatch({ type: 'tool-undo', undo });
    if (kept) env.toast('Undone, except what changed since');
  };
}

// {HANDLERS}

const THREAD_SPECS = {
  list_threads: {
    run: ({ state, caller, args }) => ({
      result: state()
        .threads.filter((t) => t.spaceId === caller.spaceId && isListed(t))
        .filter((t) => !args.status || t.status === args.status)
        .filter((t) => args.pinned === undefined || isPinned(t) === args.pinned)
        .filter((t) => !args.project || t.repo?.project === args.project)
        .map(summary),
    }),
  },
  get_thread: {
    run: ({ state, caller, args }) => {
      const thread = target(state(), caller, args.threadId);
      return {
        result: {
          ...summary(thread),
          branch: thread.repo?.branch ?? null,
          plan: thread.steps
            .filter((s) => s.status !== 'dropped')
            .map(({ title, status }) => ({ title, status })),
          lastActivity: thread.activity.slice(-5).map((a) => ({
            who: a.who,
            kind: a.kind,
            text: a.text.slice(0, 300),
          })),
          pullRequests: thread.prs,
          report: thread.parentReport ?? null,
          waitingOnUser: state()
            .queue.filter((q) => q.threadId === thread.id)
            .map((q) => ({ kind: q.kind, title: q.title })),
          isWorking: thread.live?.isWorking ?? thread.status === 'running',
        },
      };
    },
  },
  rename_thread: {
    run: ({ state, caller, args, dispatch }) => {
      const thread = target(state(), caller, args.threadId);
      const title = args.title.trim();
      dispatch({ type: 'rename', threadId: thread.id, title });
      return {
        changed: `renamed "${thread.title}" to "${title}"`,
        result: summary(target(state(), caller, thread.id)),
      };
    },
  },
  settle_thread: {
    run: ({ state, caller, args, dispatch }) => {
      const threads = others(state(), caller, args.threadIds, 'settle');
      for (const t of threads) dispatch({ type: 'settle', threadId: t.id });
      return {
        changed: `settled ${count(threads)}`,
        result: {
          threads: threads.map((t) => summary(target(state(), caller, t.id))),
        },
      };
    },
  },
  reactivate_thread: {
    run: ({ state, caller, args, dispatch }) => {
      const threads = targets(state(), caller, args.threadIds).filter(
        (t) => t.status === 'settled',
      );
      if (!threads.length) throw new Error('None of those threads is settled');
      for (const t of threads) dispatch({ type: 'unsettle', threadId: t.id });
      return {
        changed: `reactivated ${count(threads)}`,
        result: {
          threads: threads.map((t) => summary(target(state(), caller, t.id))),
        },
      };
    },
  },
  pin_thread: {
    run: ({ state, caller, args, dispatch }) => {
      const threads = targets(state(), caller, args.threadIds).filter(
        (t) => !isPinned(t),
      );
      const lists = sidebar(state(), caller);
      const pinned = [...lists.pinned, ...threads.map((t) => t.id)];
      if (pinned.length > PIN_SLOTS.length)
        throw new Error(
          `Only ${PIN_SLOTS.length} threads can be pinned and ${lists.pinned.length} already are; unpin one first`,
        );
      if (threads.some((t) => t.status === 'settled'))
        throw new Error(
          'Settled threads can’t be pinned; reactivate_thread first',
        );
      dispatch({
        type: 'reorder',
        pinned,
        unpinned: lists.unpinned.filter((id) => !pinned.includes(id)),
        at: Date.now(),
      });
      return {
        changed: `pinned ${count(threads)}`,
        result: { pinned: sidebar(state(), caller).pinned },
      };
    },
  },
  unpin_thread: {
    run: ({ state, caller, args, dispatch }) => {
      const threads = targets(state(), caller, args.threadIds).filter(isPinned);
      const lists = sidebar(state(), caller);
      const ids = threads.map((t) => t.id);
      dispatch({
        type: 'reorder',
        pinned: lists.pinned.filter((id) => !ids.includes(id)),
        unpinned: [...ids, ...lists.unpinned],
        at: Date.now(),
      });
      return {
        changed: `unpinned ${count(threads)}`,
        result: { pinned: sidebar(state(), caller).pinned },
      };
    },
  },
  reorder_threads: {
    run: ({ state, caller, args, dispatch }) => {
      const lists = sidebar(state(), caller);
      if (args.pinnedOrder) {
        const order = targets(state(), caller, args.pinnedOrder).map(
          (t) => t.id,
        );
        dispatch({
          type: 'reorder',
          pinned: order,
          unpinned: [
            ...lists.pinned.filter((id) => !order.includes(id)),
            ...lists.unpinned.filter((id) => !order.includes(id)),
          ],
          at: Date.now(),
        });
        return {
          changed: 'reordered the pinned threads',
          result: sidebar(state(), caller),
        };
      }
      const anchorId = args.before ?? args.after;
      if (!args.threadId || !anchorId || (args.before && args.after))
        throw new Error(
          'Pass threadId with one of before or after, or pass pinnedOrder',
        );
      const moving = target(state(), caller, args.threadId);
      const anchor = target(state(), caller, anchorId);
      if (moving.id === anchor.id)
        throw new Error('A thread can’t move next to itself');
      const toPinned = lists.pinned.includes(anchor.id);
      const list = (toPinned ? lists.pinned : lists.unpinned).filter(
        (id) => id !== moving.id,
      );
      if (!list.includes(anchor.id))
        throw new Error(`"${anchor.title}" isn't in the sidebar's active list`);
      const next = dropPin(
        lists.pinned,
        lists.unpinned,
        moving.id,
        toPinned,
        list.indexOf(anchor.id) + (args.after ? 1 : 0),
      );
      if (!next)
        throw new Error(
          `Pinned is full (${PIN_SLOTS.length}); unpin one first`,
        );
      dispatch({ type: 'reorder', ...next, at: Date.now() });
      return {
        changed: `moved "${moving.title}" ${args.after ? 'below' : 'above'} "${anchor.title}"`,
        result: sidebar(state(), caller),
      };
    },
  },
  watch_thread: {
    run: ({ state, caller, args, dispatch }) => {
      const thread = target(state(), caller, args.threadId);
      if (state().watched.includes(thread.id) !== args.watch)
        dispatch({ type: 'watch-toggle', threadId: thread.id });
      return {
        changed: `${args.watch ? 'started' : 'stopped'} watching "${thread.title}"`,
        result: { threadId: thread.id, isWatched: args.watch },
      };
    },
  },
  settle_when_merged: {
    run: ({ state, caller, args, dispatch }) => {
      const thread = target(state(), caller, args.threadId);
      const prs = thread.prs.filter(
        (p) => args.pr === undefined || p.number === args.pr,
      );
      if (!prs.length)
        throw new Error(
          args.pr === undefined
            ? 'This thread has no pull request yet; open one first'
            : `Pull request #${args.pr} isn't on this thread`,
        );
      for (const p of prs)
        dispatch({
          type: 'auto-archive-set',
          threadId: thread.id,
          pr: p.number,
          isOn: args.isOn,
        });
      return {
        changed: `${args.isOn ? 'turned on' : 'turned off'} Auto-settle for ${prs.map((p) => `#${p.number}`).join(', ')}`,
        result: {
          threadId: thread.id,
          pullRequests: prs.map((p) => p.number),
          isOn: args.isOn,
        },
      };
    },
  },
  move_to_project: {
    // The agent only suggests; you pick the project. Mid-turn the session is busy, so the move waits for the turn to end.
    ask: async ({ env, caller, args }) => {
      const projects = await movableProjects(env, caller);
      const suggested = projects.find(
        (p) => p.path === args.project || p.name === args.project,
      );
      return {
        title: `${authorName(caller.providers[0])} wants to move this chat into a project`,
        detail:
          'It moves when this turn ends, keeping its session. Files made so far stay in the chat’s own folder.',
        denied: 'Kept the chat without a project',
        options: [
          ...(suggested ? [suggested] : []),
          ...projects.filter((p) => p !== suggested),
        ].map((p) => ({ id: p.path, label: p.name })),
        pick: 'one' as const,
      };
    },
    run: ({ caller, dispatch }, [project]) => {
      if (caller.repo) throw new Error(NOT_FOLDERLESS);
      dispatch({
        type: 'attach-project-queued',
        threadId: caller.id,
        project,
      });
      return {
        changed: `queued a move into ${projectName(project)}`,
        result: { project, movesAt: 'turn end' },
      };
    },
  },
  create_thread: {
    // A top-level thread waits on the user: an agent can't take work out from under the thread that coordinates it. A sub-thread's
    // other user_asked threads become cards (`isCardFromSubThread`). A card asks nothing: nothing runs until the user starts it.
    // Nor does a turn `run` refuses (`AGENT_DRIVEN`). Any model or effort the account offers needs no approval.
    ask: ({ caller, args }) => {
      if (!args.proposalId && args.initiation !== 'user_asked')
        return undefined;
      if (turnOf(caller).isAgentDriven) return undefined;
      // Refuses a link that can't be made before the user is asked about it.
      subThreadLink(caller, args);
      if (!args.isTopLevel) return undefined;
      return {
        title: `${authorName(caller.providers[0])} wants to start a thread`,
        detail: 'It would start top-level, not nested under this thread.',
        code: args.prompt ?? args.proposalId,
        denied: "Didn't start the thread",
        // The agent only suggests top-level; you pick where it goes.
        options: PLACEMENTS,
        pick: 'one' as const,
      };
    },
    run: async (ctx, [placement]) => {
      const { state, caller, dispatch } = ctx;
      const args = {
        ...ctx.args,
        isTopLevel: ctx.args.isTopLevel && placement !== 'nested',
      };
      if (args.proposalId) return startProposal(ctx, args.proposalId);
      const prompt = args.prompt?.trim();
      if (!prompt)
        throw new Error(
          'prompt is required: the brief the new agent starts on',
        );
      if (!args.initiation)
        throw new Error(
          'Pass initiation: "user_asked", "offer" or "own_initiative"',
        );
      if (turnOf(caller).isAgentDriven && args.initiation === 'user_asked')
        return startOnGrant({ ...ctx, args }, prompt);
      if (args.initiation === 'offer' && turnOf(caller).isAgentDriven)
        throw new Error(AGENT_DRIVEN);
      const create = await proposalCreate({ ...ctx, args });
      if (
        args.initiation !== 'user_asked' ||
        isCardFromSubThread({ ...ctx, args })
      )
        return propose(ctx, args.initiation, prompt, create);
      const before = state();
      const name = args.title?.trim();
      dispatch({
        type: 'create',
        title: prompt,
        ...(name && { name }),
        ...create,
        isBackground: true,
      });
      const created = state().threads.find(
        (t) => !before.threads.some((s) => s.id === t.id),
      )!;
      return {
        changed: `started "${created.title}"`,
        result: summary(created),
        undo: () => dispatch({ type: 'delete', threadIds: [created.id] }),
      };
    },
  },
  request_orchestration_grant: {
    run: async ({ env, state, caller, args, dispatch }) => {
      if (turnOf(caller).isAgentDriven)
        throw new Error(
          "Ask for a grant in a turn the user started, while they're here to answer it; this one began with another thread's message or an automated event",
        );
      const thread = target(state(), caller, caller.id);
      const pending = pendingGrant(thread);
      if (pending)
        throw new Error(
          `Grant ${pending.id} still waits on the user's answer; ask again once they've answered it`,
        );
      const models = [...new Set(args.models.map((m) => m.trim()))];
      const offered = (
        await Promise.all(
          (['claude', 'codex'] as const).map((p) =>
            env.models(p, caller.spaceId),
          ),
        )
      ).flat();
      const unknown = models.filter(
        (m) => offered.length && !offered.some((o) => o.id === m),
      );
      if (unknown.length)
        throw new Error(
          `${unknown.join(', ')} isn't offered; use model ids from ${offered.map((m) => m.id).join(', ')}`,
        );
      const grant = {
        id: nextGrantId(thread),
        maxThreads: args.maxThreads,
        models,
        minutes: Math.round(args.hours * 60),
        reason: args.reason.trim(),
        state: 'pending' as const,
        started: [],
      };
      dispatch({
        type: 'grant-add',
        threadId: caller.id,
        grant,
        by: caller.providers[0],
      });
      return {
        result: {
          grantId: grant.id,
          state: 'pending',
          note: "The user sees the grant card with Allow / Don't allow and can switch models off. Don't wait on it: carry on. Once allowed, create_thread with initiation user_asked starts nested threads from turns sub-thread reports or Auto-fix begin, and says how much budget is left.",
        },
      };
    },
  },
  dismiss_thread_proposal: {
    run: ({ state, caller, args, dispatch }) => {
      const blocker = proposalBlocker(
        target(state(), caller, caller.id),
        args.taskId,
        state().now,
      );
      if (blocker) throw new Error(blocker);
      dispatch({
        type: 'proposal-answer',
        threadId: caller.id,
        proposalId: args.taskId,
        state: 'dismissed',
        reason: args.reason?.trim() || 'No longer needed',
      });
      return { result: { taskId: args.taskId, state: 'dismissed' } };
    },
  },
  send_to_thread: {
    run: ({ state, caller, args, dispatch }) => {
      const [thread] = others(state(), caller, [args.threadId], 'message');
      const text = args.text.trim();
      const from = { threadId: caller.id, title: caller.title };
      // A sub-thread's turn ends already reach its parent (`noteParent`).
      const expectReply =
        args.expectReply && thread.parent?.threadId !== caller.id;
      dispatch({
        type: 'send',
        threadId: thread.id,
        text,
        prompt: receivedPrompt(from, text),
        from,
        ...(expectReply && { expectReply: true as const }),
      });
      return {
        changed: `messaged "${thread.title}"`,
        result: { threadId: thread.id, sent: text },
        isFinal: true,
      };
    },
  },
  delete_thread: {
    ask: ({ state, caller, args, env }) => {
      const threads = others(state(), caller, args.threadIds, 'delete');
      const names = threads.map((t) => `"${t.title}"`).join(', ');
      const withTrees = threads.filter((t) => t.repo);
      return {
        title: plural(
          threads.length,
          `Delete ${names}?`,
          `Delete ${threads.length} threads?`,
        ),
        detail: `${threads.length > 1 ? `${names}. ` : ''}Stops ${plural(threads.length, 'its agent', 'their agents')} and removes ${plural(threads.length, 'its', 'their')} history from Mochi. This can't be undone.`,
        options: withTrees.length
          ? [
              {
                id: 'removeWorktree',
                label: `Also remove ${plural(withTrees.length, 'its worktree', 'their worktrees')}: ${withTrees.map((t) => env.cwdOf(t) ?? t.repo!.branch).join(', ')}`,
              },
            ]
          : undefined,
        isDestructive: true,
        denied: `Kept ${names}`,
      };
    },
    run: async ({ state, caller, args, dispatch, env }, options) => {
      const threads = others(state(), caller, args.threadIds, 'delete');
      dispatch({ type: 'delete', threadIds: threads.map((t) => t.id) });
      const removing = options.includes('removeWorktree')
        ? threads.filter((t) => t.repo)
        : [];
      const failed: string[] = [];
      for (const t of removing)
        await env
          .removeWorktree(t.id)
          .catch((e: unknown) =>
            failed.push(
              `${t.title}: ${e instanceof Error ? e.message : String(e)}`,
            ),
          );
      const trees = removing.length
        ? ` and ${plural(removing.length - failed.length, 'its worktree', `${removing.length - failed.length} worktrees`)}`
        : '';
      return {
        changed: `deleted ${count(threads)}${trees}`,
        result: {
          deleted: threads.map((t) => t.title),
          worktreesRemoved: removing.length - failed.length,
          worktreeErrors: failed,
        },
      };
    },
  },
} satisfies Partial<Specs>;

const REPORT_SPECS = {
  report_turn: {
    run: ({ env, state, caller, args, dispatch }) => {
      const { summary, next, options } = args;
      const isSpineOn = env.prefs.get().turnSpine;
      const decisions = reportItems(args.decisions);
      const assumptions = reportItems(args.assumptions);
      dispatch({
        type: 'report',
        threadId: caller.id,
        report: {
          by: caller.providers[0],
          decisions: isSpineOn ? decisions : decisions.map((d) => d.text),
          ...(isSpineOn && { assumptions }),
          left: args.left,
          ...(args.question?.trim() && { question: args.question.trim() }),
          ...(summary?.trim() && { summary: summary.trim() }),
          ...(next?.trim() && { next: next.trim() }),
          ...(options && {
            options: options.map((o) => ({
              label: o.label.trim(),
              reply: o.reply.trim(),
              ...(o.isDraft && { isDraft: true }),
            })),
          }),
        },
      });
      const running = caller.steps.find((s) => s.status === 'running');
      return {
        changed: 'reported',
        result: {
          ...reportOf(target(state(), caller, caller.id)),
          ...(running && {
            note: `Your plan still shows "${running.title}" in progress. If it's finished, call update_plan with {"advance": true} before you end the turn; if not, leave it.`,
          }),
        },
      };
    },
  },
  report_to_parent: {
    run: ({ caller, args, dispatch }) => {
      if (!caller.parent)
        throw new Error(
          'This thread has no parent thread; report_turn reports to the user',
        );
      const { status, branch, pr, changedFiles, checks } = args;
      dispatch({
        type: 'parent-report',
        threadId: caller.id,
        report: {
          status,
          summary: args.summary.trim(),
          ...(branch?.trim() && { branch: branch.trim() }),
          ...(pr && { pr }),
          ...(changedFiles?.length && { changedFiles }),
          ...(checks?.length && { checks }),
        },
      });
      return {
        changed: `reported ${status} to the parent thread`,
        result: { status, parentThreadId: caller.parent.threadId },
      };
    },
  },
} satisfies Partial<Specs>;

const LAYOUT_SPECS = {
  open_pane_tab: {
    run: ({ state, caller, args, dispatch }) => {
      const thread = target(state(), caller, args.threadId);
      const kind = args.kind === 'preview' ? 'browser' : args.kind;
      if (kind === 'sidechat')
        dispatch({ type: 'sidechat-open', threadId: thread.id });
      else dispatch({ type: 'pane-open-tab', threadId: thread.id, kind });
      return {
        changed: `opened ${args.kind} in "${thread.title}"'s side pane`,
        result: paneOf(state(), thread.id),
      };
    },
  },
  split_with: {
    run: ({ state, caller, args, dispatch }) => {
      const thread = target(state(), caller, args.threadId);
      if (state().spaceId !== caller.spaceId)
        throw new Error(
          "The user is in another profile right now; splits open in the profile they're looking at",
        );
      dispatch({
        type: 'layout-split',
        view: { kind: 'thread', id: thread.id },
      });
      return {
        changed: `opened "${thread.title}" in a split`,
        result: { split: thread.id },
      };
    },
  },
  close_pane: {
    run: ({ state, caller, args, dispatch }) => {
      const thread = target(state(), caller, args.threadId);
      if (!state().panes.find((p) => p.threadId === thread.id)?.isOpen)
        return { result: { note: 'The side pane is already closed' } };
      dispatch({ type: 'pane-toggle', threadId: thread.id });
      return {
        changed: `closed "${thread.title}"'s side pane`,
        result: paneOf(state(), thread.id),
      };
    },
  },
  show_file: {
    run: ({ caller, args, dispatch, state }) => {
      if (!caller.repo)
        throw new Error(
          'Your thread has no project folder, so there are no files to show',
        );
      const path = args.path.replace(/^\.?\//, '');
      if (path.split('/').includes('..') || path.startsWith('/'))
        throw new Error(
          'path must stay inside the project, relative to its root',
        );
      dispatch({
        type: 'pane-open-tab',
        threadId: caller.id,
        kind: 'files',
        file: { path, line: args.line },
      });
      return {
        changed: `opened ${path}${args.line ? `:${args.line}` : ''}`,
        result: paneOf(state(), caller.id),
      };
    },
  },
  open_changes: {
    run: ({ state, caller, args, dispatch }) => {
      const thread = target(state(), caller, args.threadId);
      if (!thread.repo)
        throw new Error(
          `"${thread.title}" has no project folder, so no changes`,
        );
      dispatch({ type: 'pane-open-tab', threadId: thread.id, kind: 'changes' });
      return {
        changed: `opened the changes of "${thread.title}"`,
        result: paneOf(state(), thread.id),
      };
    },
  },
} satisfies Partial<Specs>;

const NOTIFY_EVERY_MS = 60_000;
const lastNotified = new Map<string, number>();

const USER_SPECS = {
  ask_side_chat: {
    run: ({ caller, args, dispatch }) => {
      dispatch({
        type: 'sidechat-open',
        threadId: caller.id,
        ask: args.question,
      });
      return {
        changed: `asked the side chat: "${args.question.slice(0, 80)}"`,
        result: {
          note: 'Asked in the side chat; the answer is shown to the user there.',
        },
        isFinal: true,
      };
    },
  },
  notify_user: {
    run: ({ caller, args, env }) => {
      const now = (env.now ?? Date.now)();
      const last = lastNotified.get(caller.id) ?? -Infinity;
      if (now - last < NOTIFY_EVERY_MS)
        throw new Error(
          `One notification per minute per thread; try again in ${Math.ceil((NOTIFY_EVERY_MS - (now - last)) / 1000)}s, or keep it for your reply`,
        );
      lastNotified.set(caller.id, now);
      env.notify(args.title, args.reason);
      return {
        changed: `notified you: ${args.title}`,
        result: { notified: true },
        isFinal: true,
      };
    },
  },
  open_settings_chat: {
    run: ({ caller, args, env }) => {
      env.openSettingsChat(caller.spaceId, args.prompt);
      return {
        changed: 'drafted a request in the settings chat',
        result: {
          note: 'Drafted in Settings › Ask Mochi; the user has a toast to open it. Tell them it is there; you will not see the outcome.',
        },
        isFinal: true,
      };
    },
  },
} satisfies Partial<Specs>;

const AGENT_SPECS = {
  update_plan: {
    run: ({ state, caller, args, dispatch }) => {
      if (!args.items && !args.advance)
        throw new Error(
          'Pass {"items": [...]} (the whole plan) or {"advance": true}',
        );
      const items = args.items
        ? args.items.map((i) => ({
            title: i.title.trim(),
            status: PLAN_STATUS[i.status],
          }))
        : advanced(caller.steps);
      dispatch({
        type: 'agent',
        event: {
          threadId: caller.id,
          type: 'plan',
          items,
          ...(args.scope === 'first_task' && { isFresh: true }),
        },
        ms: Date.now(),
      });
      return {
        result: planStatus(target(state(), caller, caller.id).steps),
      };
    },
  },
  start_subagent: {
    run: ({ state, caller, args, dispatch }) => {
      if (!caller.live)
        throw new Error('Delegated tasks run only in a live desktop thread.');
      if (args.worktree === 'new' && !caller.repo)
        throw new Error(
          'This chat has no project, so there is no repository to make a worktree in. Use worktree: same.',
        );
      const id = `bg${(caller.subagents ?? []).filter((s) => s.origin === 'mochi').length + 1}`;
      const agent = {
        id,
        name: args.name.trim(),
        prompt: args.prompt.trim(),
        provider: args.provider,
        hasOwnWorktree: args.worktree === 'new',
        ...(args.model && { model: args.model }),
      };
      dispatch({ type: 'bg-start', threadId: caller.id, agent });
      const started = state()
        .threads.find((t) => t.id === caller.id)
        ?.subagents?.find((s) => s.id === id);
      if (!started) throw new Error('The delegated task did not start');
      return {
        changed: `delegated "${agent.name}" to ${agent.provider}`,
        result: {
          id,
          name: agent.name,
          provider: agent.provider,
          status: started.status,
        },
        isFinal: true,
      };
    },
  },
  ask_second_opinion: {
    run: async ({ caller, env }) => {
      const name = providerName(await env.askSecondOpinion(caller));
      return {
        changed: `asked ${name} for a second opinion`,
        result: {
          note: `${name} is reviewing your diff; the verdict comes to you as a message.`,
        },
        isFinal: true,
      };
    },
  },
} satisfies Partial<Specs>;

const SPECS = {
  ...THREAD_SPECS,
  ...REPORT_SPECS,
  ...LAYOUT_SPECS,
  ...USER_SPECS,
  ...AGENT_SPECS,
  update_plan: withPivots(AGENT_SPECS.update_plan),
  ...BROWSER_TOOLS,
  ...DEV_SERVER_TOOLS,
  browser_batch: { run: runBatch },
  ...SETTINGS_TOOLS,
} satisfies Specs;

/**
 * update_plan with the turn spine's pivots: a resent plan that drops or renames steps is recorded with its `why` where the
 * spine places it, and the reply names what changed. Dropping steps without a why asks for one, once: a `{"why"}` alone
 * answers it and drops nothing. Wraps the plan spec so the plan itself stays as it is.
 */
function withPivots(spec: ToolSpec<'update_plan'>): ToolSpec<'update_plan'> {
  return {
    run: async (ctx, options) => {
      const { env, state, caller, args, dispatch } = ctx;
      const why = env.prefs.get().turnSpine ? args.why?.trim() : undefined;
      if (why && !args.items && !args.advance) {
        dispatch({ type: 'pivot-why', threadId: caller.id, why });
        return { result: 'Noted why the plan changed.' };
      }
      const outcome = await spec.run(ctx, options);
      if (
        !env.prefs.get().turnSpine ||
        !args.items ||
        args.scope === 'first_task'
      )
        return outcome;
      const change = planChange(
        caller.steps,
        target(state(), caller, caller.id).steps,
      );
      if (!change.dropped.length && !change.renamed.length) return outcome;
      if (change.dropped.length || why)
        dispatch({
          type: 'pivot',
          threadId: caller.id,
          pivot: {
            ...(why && { why }),
            dropped: [...change.dropped, ...change.renamed.map((r) => r.from)],
            at: change.at,
          },
        });
      const asks =
        change.dropped.length && !why
          ? ' Say why in one line: update_plan with {"why": "..."}.'
          : '';
      return {
        ...outcome,
        result: `${String(outcome.result)} ${describeChange(change)}${asks}`,
      };
    },
  };
}

interface PlanChange {
  dropped: string[];
  renamed: { from: string; to: string }[];
  added: string[];
  /** Where the spine puts the pivot among the plan's steps: before the first step that replaced what was dropped. */
  at: number;
}

/** What a resent plan changed, from the thread's steps before and after it. */
export function planChange(before: Step[], after: Step[]): PlanChange {
  const was = new Map(before.map((s) => [s.id, s]));
  const kept = after.filter((s) => s.status !== 'dropped');
  const dropped = after.filter(
    (s) =>
      s.status === 'dropped' &&
      was.get(s.id)?.status !== 'dropped' &&
      was.has(s.id),
  );
  const renamed = kept.flatMap((s) => {
    const from = was.get(s.id)?.title;
    return from !== undefined && from !== s.title
      ? [{ from, to: s.title }]
      : [];
  });
  const added = kept.filter((s) => !was.has(s.id));
  const firstNew = kept.findIndex(
    (s) => !was.has(s.id) || was.get(s.id)!.title !== s.title,
  );
  const open = before.filter((s) => s.status !== 'dropped');
  const firstDropped = open.findIndex((s) =>
    dropped.some((d) => d.id === s.id),
  );
  const keptBefore = open
    .slice(0, Math.max(firstDropped, 0))
    .filter((s) => kept.some((k) => k.id === s.id)).length;
  return {
    dropped: dropped.map((s) => s.title),
    renamed,
    added: added.map((s) => s.title),
    at: firstNew >= 0 ? firstNew : keptBefore,
  };
}

function describeChange({ dropped, renamed, added }: PlanChange) {
  const quote = (titles: string[]) => titles.map((t) => `"${t}"`).join(', ');
  const parts = [
    dropped.length && `dropped ${quote(dropped)}`,
    ...renamed.map((r) => `renamed "${r.from}" to "${r.to}"`),
    added.length && `added ${quote(added)}`,
  ].filter(Boolean);
  return `You ${parts.join(', ')}.`;
}

/** Each step runs as its own call: its policy, its approvals and its line in the thread, until one fails. */
async function runBatch(
  ctx: ToolContext<Args<'browser_batch'>>,
): Promise<Outcome> {
  const steps: { name: string; result: unknown }[] = [];
  let image: Outcome['image'];
  for (const [i, { name, input = {} }] of ctx.args.actions.entries()) {
    const stop = (error: string) =>
      new Error(
        JSON.stringify({ steps, failed: { step: i + 1, name, error } }),
      );
    if (!name.startsWith('browser_') || name === 'browser_batch')
      throw stop('A batch runs browser_* tools other than browser_batch');
    if (Date.now() >= ctx.deadline)
      throw stop(
        'The batch ran out of time; this step and the rest did not run',
      );
    const result = await runTool(
      {
        id: `${ctx.caller.id}-batch-${i}`,
        threadId: ctx.caller.id,
        name,
        args: input,
      },
      ctx.env,
      ctx.deadline,
    );
    if (result.isError) throw stop(result.text);
    image = result.image ?? image;
    steps.push({ name, result: JSON.parse(result.text) });
  }
  return { result: { steps }, ...(image && { image }) };
}

// {HELPERS}

/** A thread in the caller's profile; another profile's thread is not found. */
export function target(
  state: State,
  caller: Thread,
  threadId: string | undefined,
) {
  if (threadId === undefined) return caller;
  const thread = state.threads.find(
    (t) =>
      t.id === threadId &&
      t.spaceId === caller.spaceId &&
      (isListed(t) || t.id === caller.id),
  );
  if (!thread)
    throw new Error(
      `No thread ${threadId} in this profile; list_threads lists them`,
    );
  return thread;
}

function targets(state: State, caller: Thread, ids: string[]) {
  return [...new Set(ids)].map((id) => target(state, caller, id));
}

function others(state: State, caller: Thread, ids: string[], verb: string) {
  const threads = targets(state, caller, ids);
  if (threads.some((t) => t.id === caller.id))
    throw new Error(`You can't ${verb} your own thread; the user does that`);
  return threads;
}

function reportOf(thread: Thread) {
  const { report, prs, status } = thread;
  return {
    threadId: thread.id,
    title: thread.title,
    status,
    report: report ?? null,
    prs: prs.map(({ number, state, title }) => ({ number, state, title })),
  };
}

function sidebar(state: State, caller: Thread) {
  return {
    pinned: pinnedThreads(state.threads, caller.spaceId).map((t) => t.id),
    unpinned: activeThreads(state.threads, caller.spaceId).map((t) => t.id),
  };
}

const isPinned = (t: Thread) =>
  t.orbitSlot !== undefined && t.status !== 'settled';

const providerOf = (provider: Provider | undefined, caller: Thread) =>
  provider ?? caller.providers[0];

/** The link a new thread starts with: to the caller, at any depth; none for `isTopLevel`. */
function subThreadLink(caller: Thread, args: { isTopLevel?: boolean }) {
  return args.isTopLevel ? undefined : { threadId: caller.id };
}

const PLACEMENTS = [
  { id: 'top-level', label: 'Top-level thread' },
  { id: 'nested', label: 'Nested under this thread' },
];

const AGENT_DRIVEN =
  'This turn began with another thread\'s message or an automated event (Auto-fix, sub-thread notes), not the user, so it can\'t start threads or ask where work runs: propose it with initiation "own_initiative" and the user decides.';

const NOT_FOLDERLESS =
  'This thread already has a project; only a folderless chat moves into one';

/** The projects a folderless caller can move into: those with their folder on disk. */
async function movableProjects(env: ToolEnv, caller: Thread) {
  if (caller.repo) throw new Error(NOT_FOLDERLESS);
  const projects = (await env.projects(caller.spaceId)).filter(
    (p) => !p.isMissing,
  );
  if (!projects.length)
    throw new Error(
      'The user has no projects to move into; they can add one from the thread header’s Add to project',
    );
  return projects;
}

/** What the new thread is: who runs it, where, and under which thread. Resolved now, so a card's Start later creates the same. */
async function proposalCreate({
  env,
  caller,
  args,
}: ToolContext<Args<'create_thread'>>): Promise<ThreadProposal['create']> {
  const parent = subThreadLink(caller, args);
  const provider = providerOf(args.provider, caller);
  const project = projectRef(caller.repo);
  // A sub-thread starts from what the parent has committed, so its PR into the parent's branch holds only its own change.
  const base =
    parent &&
    !args.isFromDefaultBranch &&
    caller.repo &&
    !caller.repo.isDetached
      ? caller.repo.branch
      : undefined;
  // Always its own worktree, whatever the composer's Worktree box says: parallel agents sharing one folder trip over each
  // other's changes and make worktrees Mochi can't see. Its branch gets a temp name until its title names it.
  const workspace = project
    ? { mode: 'worktree' as const, ...(base && { base }) }
    : undefined;
  const controls = await newThreadControls(env, caller, provider, args);
  return {
    provider,
    project,
    ...(workspace && { workspace }),
    controls,
    isLive: !!caller.live,
    ...(parent && { parent }),
  };
}

/** An offer, own_initiative or sub-thread user_asked card in the caller's chat; nothing starts. */
function propose(
  { state, caller, args, dispatch }: ToolContext<Args<'create_thread'>>,
  initiation: ThreadProposal['initiation'],
  brief: string,
  create: ThreadProposal['create'],
): Outcome {
  // A user_asked brief came without a card in mind; its first line names the card, as the prompt names its thread.
  const title =
    args.title?.trim() ||
    (initiation === 'user_asked' ? brief.split('\n')[0] : '');
  if (!title) throw new Error('Pass a short title for the card');
  const thread = target(state(), caller, caller.id);
  if (
    initiation === 'own_initiative' &&
    turnProposalCount(thread) >= PROPOSALS_PER_TURN
  )
    throw new Error(
      `You already proposed ${PROPOSALS_PER_TURN} threads this turn, the most one turn may. Mention the rest in your reply, or withdraw a weaker one with dismiss_thread_proposal first.`,
    );
  const id = nextProposalId(thread);
  dispatch({
    type: 'proposal-add',
    threadId: caller.id,
    proposal: { id, initiation, title, brief, state: 'pending', create },
    by: caller.providers[0],
  });
  return {
    result: { taskId: id, state: 'pending', note: PROPOSAL_NOTES[initiation] },
  };
}

const PROPOSAL_NOTES = {
  offer:
    'The user sees New thread / Do it here / Dismiss. Don\'t start the work: end your turn now with one short line. New thread starts it with your brief; "Do it here." or a dismissal comes back as their message.',
  own_initiative:
    'The user sees a card with New thread, Do it here and Dismiss; nothing runs until they choose, and Do it here comes back to you as their message with the brief. If they tell you to start it, call create_thread with just this proposalId. Withdraw it with dismiss_thread_proposal if it goes stale.',
  user_asked:
    "Proposed and waiting: this thread is a sub-thread, so the threads it starts go on one card for the user, with Start, Dismiss and Start all. Don't retry or wait on it; carry on, or end your turn. Each one they start nests under this thread and its notes come back to you.",
} satisfies Record<ThreadProposal['initiation'], string>;

/** A sub-thread's user_asked thread that asks nothing else (placement) goes on its turn's card instead of starting. */
function isCardFromSubThread({
  caller,
  args,
}: ToolContext<Args<'create_thread'>>) {
  return !!caller.parent && !args.isTopLevel;
}

/**
 * A user_asked thread from an agent-driven turn: starts at once on the thread's orchestration grant, goes on a card once
 * the grant is spent, expired or revoked, and is refused when the user never allowed one.
 */
async function startOnGrant(
  ctx: ToolContext<Args<'create_thread'>>,
  prompt: string,
): Promise<Outcome> {
  const { state, caller, args, dispatch } = ctx;
  const thread = target(state(), caller, caller.id);
  const grant = usableGrant(thread, state().now);
  if (!grant && !hadGrant(thread)) throw new Error(AGENT_DRIVEN);
  if (args.isTopLevel)
    throw new Error(
      'An orchestration grant starts nested threads only; leave out isTopLevel, or propose it with initiation "own_initiative"',
    );
  const create = await proposalCreate(ctx);
  if (!grant) {
    const { result } = propose(ctx, 'user_asked', prompt, create);
    return { result: { ...(result as object), note: GRANT_ENDED_NOTE } };
  }
  const model = create.controls?.model ?? '';
  if (!grant.models.includes(model))
    throw new Error(
      `The orchestration grant allows ${grant.models.join(', ')}, not ${model || "this thread's model"}; pass one of them as model`,
    );
  const before = state();
  const name = args.title?.trim();
  dispatch({
    type: 'create',
    title: prompt,
    ...(name && { name }),
    ...create,
    isBackground: true,
  });
  const created = state().threads.find(
    (t) => !before.threads.some((s) => s.id === t.id),
  )!;
  dispatch({
    type: 'grant-use',
    threadId: caller.id,
    grantId: grant.id,
    started: { threadId: created.id, title: created.title },
  });
  const left = threadsLeft(grant) - 1;
  const minutes = grant.expiresAt! - state().now;
  return {
    changed: `started "${created.title}" on the orchestration grant (${plural(left, '1 thread left', `${left} threads left`)})`,
    result: {
      ...summary(created),
      grant: {
        threadsLeft: left,
        expiresIn: durationText(minutes),
        status: grantStatus(
          { ...grant, started: [...grant.started, { title: created.title }] },
          state().now,
        ),
      },
    },
    undo: () => dispatch({ type: 'delete', threadIds: [created.id] }),
  };
}

const GRANT_ENDED_NOTE =
  "The orchestration grant is spent, expired or revoked, so this went on a Start / Dismiss card for the user instead of starting. Don't retry it; carry on, or end your turn. Ask for a new grant in a turn the user starts.";

/** The user told the agent to start a card it proposed. */
function startProposal(
  { state, caller, dispatch }: ToolContext<Args<'create_thread'>>,
  proposalId: string,
): Outcome {
  const thread = target(state(), caller, caller.id);
  if (turnOf(thread).isAgentDriven) throw new Error(AGENT_DRIVEN);
  const blocker = proposalBlocker(thread, proposalId, state().now);
  if (blocker) throw new Error(blocker);
  const before = state();
  dispatch({ type: 'proposal-start', threadId: caller.id, proposalId });
  const created = state().threads.find(
    (t) => !before.threads.some((s) => s.id === t.id),
  );
  if (!created) throw new Error(`Couldn't start ${proposalId}`);
  return {
    changed: `started "${created.title}"`,
    result: summary(created),
    undo: () => dispatch({ type: 'delete', threadIds: [created.id] }),
  };
}

async function newThreadControls(
  env: ToolEnv,
  caller: Thread,
  provider: Provider,
  picked: { model?: string; effort?: string },
) {
  const models = await env.models(provider, caller.spaceId);
  const origin =
    env.getState().threads.find((t) => t.id === caller.id) ?? caller;
  const sameProvider = provider === origin.providers[0];
  const current = sameProvider
    ? controlsOf(origin)
    : DEFAULT_CONTROLS[provider];
  const running = callerRun(origin);
  const model = picked.model ?? (sameProvider ? running.model : current.model);
  const effort =
    picked.effort ?? (sameProvider ? running.effort : current.effort);
  if (
    picked.model &&
    models.length &&
    !models.some((m) => m.id === picked.model)
  )
    throw new Error(
      `${picked.model} isn't offered; use one of ${models.map((m) => m.id).join(', ')}`,
    );
  const resolved = resolveRun(models, model, effort, current.speed);
  const offered = models.find((m) => m.id === resolved.model);
  if (picked.effort && offered && !offered.efforts.includes(picked.effort))
    throw new Error(
      `${picked.effort} effort isn't offered by ${offered.id}; use one of ${offered.efforts.join(', ') || 'the model default'}`,
    );
  // Permissions always follow the caller's, so switching harness can't loosen them.
  return {
    ...current,
    model: resolved.model ?? '',
    effort: resolved.effort ?? '',
    access: controlsOf(origin).access,
  };
}

/** The model and effort the caller's agent runs: its live session's, else its controls'. */
function callerRun(caller: Thread) {
  const controls = controlsOf(caller);
  return {
    model: caller.agent?.model ?? controls.model,
    effort: caller.agent?.effort ?? controls.effort,
  };
}

const count = (threads: Thread[]) =>
  threads.length === 1 ? `"${threads[0].title}"` : `${threads.length} threads`;

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

const asObject = (v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v) ? v : { result: v };

const fail = (text: string): AgentToolResult => ({ text, isError: true });

const PLAN_STATUS = {
  pending: 'pending',
  in_progress: 'running',
  completed: 'done',
} as const;

/** The thread's plan one step on: the running step done, the next open one running. */
function advanced(steps: Step[]): AgentPlanItem[] {
  const items = steps.flatMap((s): AgentPlanItem[] =>
    s.status === 'dropped'
      ? []
      : [
          {
            title: s.title,
            status:
              s.status === 'done' || s.status === 'running'
                ? s.status
                : 'pending',
          },
        ],
  );
  const running = items.findIndex((i) => i.status === 'running');
  if (running >= 0) items[running].status = 'done';
  const next = items.findIndex((i, k) => k > running && i.status === 'pending');
  if (next >= 0) items[next].status = 'running';
  return items;
}

/** The plan as the agent left it, so it never has to count its own advances to know which step is running. */
function planStatus(steps: Step[]) {
  const open = steps.filter((s) => s.status !== 'dropped');
  const done = open.filter((s) => s.status === 'done').length;
  const at = open.findIndex((s) => s.status === 'running');
  const next = open.find((s, k) => k > at && s.status === 'ready');
  const upNext = next ? ` Next: "${next.title}".` : '';
  if (at >= 0)
    return `Step ${at + 1}/${open.length} in progress: "${open[at].title}".${upNext || ' Last step: advance once more when it is done.'}`;
  if (done === open.length) return `Plan done (${done}/${open.length}).`;
  return `Nothing in progress; ${done}/${open.length} done.${upNext}`;
}

export function summary(thread: Thread) {
  return {
    id: thread.id,
    title: thread.title,
    status: thread.status,
    pinned: isPinned(thread),
    provider: thread.providers[0],
    project: thread.repo?.project ?? null,
  };
}

function paneOf(state: State, threadId: string) {
  const pane = state.panes.find((p) => p.threadId === threadId);
  return {
    isOpen: !!pane?.isOpen,
    tabs:
      pane?.tabs.map((t) => ({
        tabId: t.id,
        kind: t.kind,
        ...(t.url && { url: t.url }),
        ...(t.file && { file: t.file }),
      })) ?? [],
    activeTab: pane?.activeTab ?? null,
  };
}
