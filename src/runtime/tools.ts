import { z } from 'zod';
import { prBody } from '../git/prBody.ts';
import { branchName, uniqueBranch } from '../git/workspace.ts';
import { openedPr } from '../git/prs.ts';
import type { Page } from '../browser/pages.ts';
import type { AgentModel, AgentToolCall, AgentToolResult } from '../host/types/agent.ts';
import type { BrowserHost } from '../host/types/browser.ts';
import type { BranchList } from '../host/types/git.ts';
import type { FileEdit, SettingsHost } from '../host/types/settings.ts';
import { authorName, PIN_SLOTS, type Provider, type QueueItem, type Space, type StepStatus, type Subagent, type Thread } from '../model.ts';
import { draftFrom, type GoalDraft } from '../goals/edit.ts';
import { projectRef } from '../projects.ts';
import { activeThreads, dropPin, pinnedThreads } from '../reorder.ts';
import { redactSecrets, type ConfigChange } from '../settings/agentConfig.ts';
import { AGENT_CONTROL, THREAD_MODELS } from '../settings/settingOptions.ts';
import { AGENT_CONTROLS, type AgentControl, type Prefs } from '../settings/prefs.ts';
import type { Action, State } from '../store/index.tsx';
import { BROWSER_TOOLS } from './browserTools.ts';
import { SETTINGS_TOOLS } from './settingsTools.ts';
import { controlsOf, DEFAULT_CONTROLS, type ThreadControls } from './controls.ts';
import { defaultModelOf, effortRank, modelTier } from './models.ts';
import { APPROVAL_TIMEOUT_MS, isQuiet, tierOf, TOOL_TABLE, type Tier, type ToolName } from './toolTable.ts';
import { applyUndo, captureUndo } from './undo.ts';

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
  /** Removes a thread's worktree from disk after a delete; resolves when done. */
  removeWorktree: (threadId: string) => Promise<void>;
  /** The browser tabs' pages (`src/browser/pages.ts`) and main's native views behind them. */
  pages: { get: (key: string) => Page | undefined; update: (key: string, patch: Partial<Page>) => void };
  browser: Pick<BrowserHost, 'navigate' | 'command' | 'capture' | 'snapshot' | 'act' | 'logs' | 'eval' | 'waitFor'>;
  /** The folder a thread's agent runs in (its worktree), for checking upload paths. */
  cwdOf: (thread: Thread) => string | null | undefined;
  /** The models `provider` offers the profile's account; empty when they couldn't be read. */
  models: (provider: Provider, spaceId: string) => Promise<AgentModel[]>;
  /** Profiles (`src/profiles.ts`); removing one leaves its accounts and browser data on disk. */
  profiles: { list: () => Space[]; update: (id: string, patch: Partial<Pick<Space, 'name' | 'icon'>>) => void; remove: (id: string) => void };
  /** The app theme (next-themes' stored choice), which `get_settings` reads. */
  theme: () => string;
  /**
   * The settings tools' slice of `host.settings`: reads, and the delete card's config write. Nothing that creates, signs
   * in or stores a credential, and nothing that sets a setting: only the user does that, on the widget.
   */
  settings: Pick<SettingsHost, 'get' | 'accounts' | 'detect' | 'agentConfig' | 'previewConfig' | 'applyConfig' | 'testMcp'>;
  isDesktop: boolean;
  /** Push and open a PR as the profile's GitHub account (the Ship bar's calls). */
  git: { branches: (root: string) => Promise<BranchList>; push: (cwd: string, githubUser?: string) => Promise<void>; createPr: (cwd: string, pr: { title: string; body: string }, githubUser?: string) => Promise<string> };
  now?: () => number;
}

export interface ToolContext<A = Record<string, unknown>> {
  env: ToolEnv;
  caller: Thread;
  args: A;
  state: () => State;
  dispatch: (action: Action) => void;
  /** Asks the user on a widget mid-run (browser escalation); throws when the setting doesn't allow it or they deny. */
  confirm: (approval: Approval) => Promise<string[]>;
  /** Widgets this call opened and the user approved; the last one's record becomes what the call changed. */
  cards: string[];
  /** A config write `ask` previewed: `run` applies exactly these changes, refused if a file changed since (`befores`). */
  write?: { spaceId: string; changes: ConfigChange[]; befores: Record<string, string> };
}

/** The widget's text says exactly what happens; `options` are checkboxes, off by default, whose ids come back when approved. */
export interface Approval {
  title: string;
  detail: string;
  options?: { id: string; label: string }[];
  /** Shown whole on the widget, like a script about to run. */
  code?: string;
  /** A delete: the widget's primary is a red Delete. */
  isDestructive?: boolean;
  /** The record line when the user says no, like "Kept \"Fix e2e\"". */
  denied?: string;
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
}

export type Args<K extends ToolName> = z.infer<z.ZodObject<(typeof TOOL_TABLE)[K]['shape']>>;

export interface ToolSpec<K extends ToolName> {
  run: (ctx: ToolContext<Args<K>>, options: string[]) => Outcome | Promise<Outcome>;
  /** Tools in an asking tier: what the widget says. */
  ask?: (ctx: ToolContext<Args<K>>) => Approval | Promise<Approval>;
}

type Specs = { [K in ToolName]: ToolSpec<K> };

/** The least agent-control level each tier runs under; asking tiers (and browser escalations) still wait on their widget. */
const LEVEL = { read: 'read', change: 'changes', destructive: 'everything', setting: 'everything' } satisfies Record<Tier, AgentControl>;

const levelLabel = (control: AgentControl) => AGENT_CONTROL.options.find((o) => o.value === control)!.label;

/**
 * Runs a Mochi tool an agent called (RUNTIME.md › Mochi tools): checks scope and the level the setting allows, asks on
 * a widget in the thread for deletes and settings, runs the handler on the store, logs it, and toasts with Undo.
 */
export async function runTool(call: AgentToolCall, env: ToolEnv): Promise<AgentToolResult> {
  const caller = env.getState().threads.find((t) => t.id === call.threadId);
  if (!caller) return fail(`No thread ${call.threadId}`);
  if (!Object.hasOwn(TOOL_TABLE, call.name)) return fail(`No Mochi tool ${call.name}`);
  const name = call.name as ToolName;
  const parsed = z.object(TOOL_TABLE[name].shape).safeParse(call.args);
  if (!parsed.success) return fail(parsed.error.issues.map((i) => `${i.path.join('.') || 'args'}: ${i.message}`).join('; '));
  const ctx = context(env, caller, parsed.data, name);
  const spec = SPECS[name] as ToolSpec<ToolName>;
  const tier = tierOf(name);
  try {
    gate(ctx, name, LEVEL[tier]);
    const approval = spec.ask?.(ctx);
    // A sync ask opens its widget before runTool yields, so the widget is in the queue as soon as the call returns.
    const options = approval ? await ask(ctx, approval instanceof Promise ? await approval : approval) : [];
    const before = env.getState();
    const outcome = await Promise.resolve()
      .then(() => spec.run(ctx, options))
      .catch((error: unknown) => {
      for (const id of ctx.cards) env.dispatch({ type: 'card-record', queueId: id, text: `Failed: ${error instanceof Error ? error.message : String(error)}` });
      throw error;
    });
    if (outcome.changed && tier !== 'read') record(ctx, name, outcome, before);
    return { text: JSON.stringify(outcome.changed ? { changed: capitalize(outcome.changed), ...asObject(outcome.result) } : outcome.result), ...(outcome.image && { image: outcome.image }) };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/** Apply / Delete / Keep / Cancel on a widget land here; the waiting call goes on. */
export function decideTool(queueId: string, decision: { isApproved: boolean; options?: string[] }) {
  waiting.get(queueId)?.(decision);
}

const waiting = new Map<string, (decision: { isApproved: boolean; options?: string[] }) => void>();
let nextCard = 0;
// Widget ids land in saved thread activity, so they must not repeat after a reload resets the counter.
const RUN = Date.now().toString(36);
export const cardId = (kind: string, threadId: string) => `q-${kind}-${threadId}-${RUN}-${++nextCard}`;

function context<A>(env: ToolEnv, caller: Thread, args: A, name: ToolName): ToolContext<A> {
  const ctx: ToolContext<A> = { env, caller, args, state: env.getState, dispatch: env.dispatch, confirm: (approval) => (gate(ctx, name, 'everything'), ask(ctx, approval)), cards: [] };
  return ctx;
}

/** Throws when the setting is below `needs`, after putting that setting in the thread as a widget (once while it's open). */
function gate(ctx: ToolContext<unknown>, name: ToolName, needs: AgentControl) {
  const control = ctx.env.prefs.get().agentControl;
  if (AGENT_CONTROLS.indexOf(control) >= AGENT_CONTROLS.indexOf(needs)) return;
  const verb = name.replaceAll('_', ' ');
  const shown = ctx.state().queue.find((q) => q.threadId === ctx.caller.id && q.settings?.changes.some((c) => c.key === 'agentControl'));
  const item = card(ctx, shown?.id ?? cardId('setting', ctx.caller.id), 'setting', {
    title: `${authorName(ctx.caller.providers[0])} wants to ${verb}`,
    detail: `${verb[0].toUpperCase()}${verb.slice(1)} needs "${levelLabel(needs)}". Ask it to try again after you change this.`,
    settings: { by: 'harness', changes: [{ key: 'agentControl', value: needs }], before: { agentControl: control } },
  });
  // One widget per thread while it's open: a later call that needs more raises it in place.
  const suggested = shown?.settings?.changes.find((c) => c.key === 'agentControl')?.value as AgentControl | undefined;
  if (!shown) open(ctx, item);
  else if (AGENT_CONTROLS.indexOf(needs) > AGENT_CONTROLS.indexOf(suggested!)) ctx.dispatch({ type: 'queue-add', item });
  throw new Error(`Blocked by the user's setting "Agents can change Mochi: ${levelLabel(control)}". ${name} needs "${levelLabel(needs)}". The user now sees that setting in this thread; ask them to change it, then call again.`);
}

async function ask(ctx: ToolContext<unknown>, approval: Approval): Promise<string[]> {
  const id = cardId('tool', ctx.caller.id);
  const { options, isDestructive, edits, notes } = approval;
  const tool = { callId: id, options, isDestructive, notes, edits: edits?.map((e) => ({ path: e.path, before: redactSecrets(e.before), after: redactSecrets(e.after) })) };
  open(ctx, card(ctx, id, 'approval', { title: approval.title, detail: approval.detail, code: approval.code, tool }));
  const decision = await new Promise<{ isApproved: boolean; options?: string[] } | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), APPROVAL_TIMEOUT_MS);
    waiting.set(id, (d) => (clearTimeout(timer), resolve(d)));
  });
  waiting.delete(id);
  const text = !decision ? `Expired: ${approval.title}` : decision.isApproved ? `Approved: ${approval.title}` : (approval.denied ?? `Denied: ${approval.title}`);
  ctx.dispatch({ type: 'card-record', queueId: id, text });
  if (!decision) throw new Error(`Nobody answered in ${APPROVAL_TIMEOUT_MS / 60_000} minutes; nothing was done.`);
  if (!decision.isApproved) throw new Error(`The user denied it: ${approval.title} Nothing was done.`);
  ctx.cards.push(id);
  return decision.options ?? [];
}

/** A widget joins the queue and the caller's thread, at the point the agent asked. */
export function open(ctx: ToolContext<unknown>, item: QueueItem) {
  ctx.dispatch({ type: 'queue-add', item });
  ctx.dispatch({ type: 'say', threadId: ctx.caller.id, entry: { who: ctx.caller.providers[0], kind: 'event', text: item.title, card: { id: item.id, isOpen: true } } });
}

export function card(ctx: ToolContext<unknown>, id: string, kind: QueueItem['kind'], item: Pick<QueueItem, 'title' | 'detail' | 'code' | 'tool' | 'settings'>): QueueItem {
  return { id, kind, threadId: ctx.caller.id, blocks: { steps: 0, threads: 1 }, createdAt: ctx.state().now, ...item };
}

/** A call that asked closes its widget with what changed; any other logs a line in the caller and toasts, with Undo when it can be put back. */
function record(ctx: ToolContext<unknown>, name: ToolName, outcome: Outcome, before: State) {
  const changed = outcome.changed!;
  const asked = ctx.cards.at(-1);
  if (asked) return ctx.dispatch({ type: 'card-record', queueId: asked, text: capitalize(changed) });
  const text = `${authorName(ctx.caller.providers[0])} ${changed}`;
  ctx.dispatch({ type: 'say', threadId: ctx.caller.id, entry: { who: ctx.caller.providers[0], kind: 'event', text } });
  if (!isQuiet(name)) ctx.env.toast(text, outcome.isFinal ? undefined : (outcome.undo ?? snapshotUndo(ctx.env, before)));
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
        .threads.filter((t) => t.spaceId === caller.spaceId)
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
          goal: thread.goal,
          branch: thread.repo?.branch ?? null,
          steps: thread.steps.map(stepOf),
          lastActivity: thread.activity.slice(-5).map((a) => ({ who: a.who, kind: a.kind, text: a.text.slice(0, 300) })),
          pullRequests: thread.prs,
          waitingOnUser: state().queue.filter((q) => q.threadId === thread.id).map((q) => ({ kind: q.kind, title: q.title })),
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
      return { changed: `renamed "${thread.title}" to "${title}"`, result: summary(target(state(), caller, thread.id)) };
    },
  },
  settle_thread: {
    run: ({ state, caller, args, dispatch }) => {
      const threads = others(state(), caller, args.threadIds, 'settle');
      for (const t of threads) dispatch({ type: 'settle', threadId: t.id });
      return { changed: `settled ${count(threads)}`, result: { threads: threads.map((t) => summary(target(state(), caller, t.id))) } };
    },
  },
  reactivate_thread: {
    run: ({ state, caller, args, dispatch }) => {
      const threads = targets(state(), caller, args.threadIds).filter((t) => t.status === 'settled');
      if (!threads.length) throw new Error('None of those threads is settled');
      for (const t of threads) dispatch({ type: 'unsettle', threadId: t.id });
      return { changed: `reactivated ${count(threads)}`, result: { threads: threads.map((t) => summary(target(state(), caller, t.id))) } };
    },
  },
  pin_thread: {
    run: ({ state, caller, args, dispatch }) => {
      const threads = targets(state(), caller, args.threadIds).filter((t) => !isPinned(t));
      const lists = sidebar(state(), caller);
      const pinned = [...lists.pinned, ...threads.map((t) => t.id)];
      if (pinned.length > PIN_SLOTS.length) throw new Error(`Only ${PIN_SLOTS.length} threads can be pinned and ${lists.pinned.length} already are; unpin one first`);
      if (threads.some((t) => t.status === 'settled')) throw new Error('Settled threads can’t be pinned; reactivate_thread first');
      dispatch({ type: 'reorder', pinned, unpinned: lists.unpinned.filter((id) => !pinned.includes(id)) });
      return { changed: `pinned ${count(threads)}`, result: { pinned: sidebar(state(), caller).pinned } };
    },
  },
  unpin_thread: {
    run: ({ state, caller, args, dispatch }) => {
      const threads = targets(state(), caller, args.threadIds).filter(isPinned);
      const lists = sidebar(state(), caller);
      const ids = threads.map((t) => t.id);
      dispatch({ type: 'reorder', pinned: lists.pinned.filter((id) => !ids.includes(id)), unpinned: [...ids, ...lists.unpinned] });
      return { changed: `unpinned ${count(threads)}`, result: { pinned: sidebar(state(), caller).pinned } };
    },
  },
  reorder_threads: {
    run: ({ state, caller, args, dispatch }) => {
      const lists = sidebar(state(), caller);
      if (args.pinnedOrder) {
        const order = targets(state(), caller, args.pinnedOrder).map((t) => t.id);
        dispatch({ type: 'reorder', pinned: order, unpinned: [...lists.pinned.filter((id) => !order.includes(id)), ...lists.unpinned.filter((id) => !order.includes(id))] });
        return { changed: 'reordered the pinned threads', result: sidebar(state(), caller) };
      }
      const anchorId = args.before ?? args.after;
      if (!args.threadId || !anchorId || (args.before && args.after)) throw new Error('Pass threadId with one of before or after, or pass pinnedOrder');
      const moving = target(state(), caller, args.threadId);
      const anchor = target(state(), caller, anchorId);
      if (moving.id === anchor.id) throw new Error('A thread can’t move next to itself');
      const toPinned = lists.pinned.includes(anchor.id);
      const list = (toPinned ? lists.pinned : lists.unpinned).filter((id) => id !== moving.id);
      if (!list.includes(anchor.id)) throw new Error(`"${anchor.title}" isn't in the sidebar's active list`);
      const next = dropPin(lists.pinned, lists.unpinned, moving.id, toPinned, list.indexOf(anchor.id) + (args.after ? 1 : 0));
      if (!next) throw new Error(`Pinned is full (${PIN_SLOTS.length}); unpin one first`);
      dispatch({ type: 'reorder', ...next });
      return { changed: `moved "${moving.title}" ${args.after ? 'below' : 'above'} "${anchor.title}"`, result: sidebar(state(), caller) };
    },
  },
  watch_thread: {
    run: ({ state, caller, args, dispatch }) => {
      const thread = target(state(), caller, args.threadId);
      if (state().watched.includes(thread.id) !== args.watch) dispatch({ type: 'watch-toggle', threadId: thread.id });
      return { changed: `${args.watch ? 'started' : 'stopped'} watching "${thread.title}"`, result: { threadId: thread.id, isWatched: args.watch } };
    },
  },
  create_thread: {
    run: async ({ state, caller, args, dispatch, env }) => {
      const prompt = args.prompt.trim();
      if (!prompt) throw new Error('prompt is required');
      const provider = providerOf(args.provider, caller);
      const controls = await newThreadControls(env, caller, provider, args);
      const project = projectRef(caller.repo);
      const workspace = project ? await newWorktree(env, project, prompt) : undefined;
      const before = state();
      dispatch({
        type: 'create',
        title: prompt,
        provider,
        project,
        ...(workspace && { workspace }),
        controls,
        isLive: !!caller.live,
        isBackground: true,
      });
      const created = state().threads.find((t) => !before.threads.some((s) => s.id === t.id))!;
      return { changed: `started "${created.title}"`, result: summary(created), undo: () => dispatch({ type: 'delete', threadIds: [created.id] }) };
    },
  },
  send_to_thread: {
    run: ({ state, caller, args, dispatch }) => {
      const [thread] = others(state(), caller, [args.threadId], 'message');
      const text = `From "${caller.title}": ${args.text.trim()}`;
      dispatch({ type: 'send', threadId: thread.id, text, drift: 'on-goal', reason: `Sent by ${authorName(caller.providers[0])} from another thread` });
      return { changed: `messaged "${thread.title}"`, result: { threadId: thread.id, sent: text }, isFinal: true };
    },
  },
  delete_thread: {
    ask: ({ state, caller, args, env }) => {
      const threads = others(state(), caller, args.threadIds, 'delete');
      const names = threads.map((t) => `"${t.title}"`).join(', ');
      const withTrees = threads.filter((t) => t.repo);
      return {
        title: threads.length === 1 ? `Delete ${names}?` : `Delete ${threads.length} threads?`,
        detail: `${threads.length > 1 ? `${names}. ` : ''}Stops ${threads.length === 1 ? 'its agent' : 'their agents'} and removes ${threads.length === 1 ? 'its' : 'their'} history from Mochi. This can't be undone.`,
        options: withTrees.length ? [{ id: 'removeWorktree', label: `Also remove ${withTrees.length === 1 ? 'its worktree' : 'their worktrees'}: ${withTrees.map((t) => env.cwdOf(t) ?? t.repo!.branch).join(', ')}` }] : undefined,
        isDestructive: true,
        denied: `Kept ${names}`,
      };
    },
    run: async ({ state, caller, args, dispatch, env }, options) => {
      const threads = others(state(), caller, args.threadIds, 'delete');
      dispatch({ type: 'delete', threadIds: threads.map((t) => t.id) });
      const removing = options.includes('removeWorktree') ? threads.filter((t) => t.repo) : [];
      const failed: string[] = [];
      for (const t of removing) await env.removeWorktree(t.id).catch((e: unknown) => failed.push(`${t.title}: ${e instanceof Error ? e.message : String(e)}`));
      const trees = removing.length ? ` and ${removing.length - failed.length === 1 ? 'its worktree' : `${removing.length - failed.length} worktrees`}` : '';
      return { changed: `deleted ${count(threads)}${trees}`, result: { deleted: threads.map((t) => t.title), worktreesRemoved: removing.length - failed.length, worktreeErrors: failed } };
    },
  },
} satisfies Partial<Specs>;

const GOAL_SPECS = {
  get_goal: { run: ({ state, caller, args }) => ({ result: goalOf(target(state(), caller, args.threadId)) }) },
  set_step_status: {
    run: ({ state, caller, args, dispatch }) => {
      const thread = target(state(), caller, args.threadId);
      const step = stepIn(thread, args.stepId);
      dispatch({ type: 'step-status', threadId: thread.id, stepId: step.id, status: args.status as StepStatus, by: caller.providers[0] });
      return { changed: `marked "${step.title}" ${args.status}`, result: goalOf(target(state(), caller, thread.id)) };
    },
  },
  add_step: {
    run: ({ state, caller, args, dispatch }) => {
      const thread = target(state(), caller, args.threadId);
      const title = args.title.trim();
      if (!title) throw new Error('title is required');
      const draft = draftFrom(thread);
      draft.steps.push({ title, size: 1, gate: false, isRemoved: false, isLocked: false });
      editGoal(dispatch, thread, caller, draft);
      return { changed: `added the step "${title}"`, result: goalOf(target(state(), caller, thread.id)) };
    },
  },
  edit_goal: {
    run: ({ state, caller, args, dispatch }) => {
      const thread = target(state(), caller, args.threadId);
      if (args.goal === undefined && !args.criteria?.length) throw new Error('Pass goal, criteria, or both');
      const draft = draftFrom(thread);
      if (args.goal !== undefined) draft.goal = args.goal;
      for (const c of args.criteria ?? []) {
        const step = draft.steps.find((s) => s.id === c.stepId);
        if (!step) throw new Error(`No open step ${c.stepId} in "${thread.title}"; get_goal lists them`);
        step.acceptance = { text: c.text, command: c.command };
      }
      if (!editGoal(dispatch, thread, caller, draft, state)) throw new Error('Nothing changed; the goal already reads like that');
      return { changed: `edited the goal of "${thread.title}"`, result: goalOf(target(state(), caller, thread.id)) };
    },
  },
  reorder_steps: {
    run: ({ state, caller, args, dispatch }) => {
      const thread = target(state(), caller, args.threadId);
      const draft = draftFrom(thread);
      const unknown = args.order.filter((id) => !draft.steps.some((s) => s.id === id));
      if (unknown.length) throw new Error(`No open steps ${unknown.join(', ')} in "${thread.title}"; get_goal lists them`);
      const rank = (id?: string) => (id && args.order.includes(id) ? args.order.indexOf(id) : args.order.length);
      draft.steps = [...draft.steps].sort((a, b) => rank(a.id) - rank(b.id));
      if (!editGoal(dispatch, thread, caller, draft, state)) throw new Error('The steps are already in that order');
      return { changed: `reordered the steps of "${thread.title}"`, result: goalOf(target(state(), caller, thread.id)) };
    },
  },
  drop_step: {
    run: ({ state, caller, args, dispatch }) => {
      const thread = target(state(), caller, args.threadId);
      const step = stepIn(thread, args.stepId);
      if (step.status === 'done') throw new Error(`"${step.title}" is done; done steps stay`);
      if (step.status === 'dropped') throw new Error(`"${step.title}" is already dropped`);
      const draft = draftFrom(thread);
      draft.steps = draft.steps.map((s) => (s.id === step.id ? { ...s, isRemoved: true } : s));
      editGoal(dispatch, thread, caller, draft);
      return { changed: `dropped "${step.title}"${args.reason ? `: ${args.reason}` : ''}`, result: goalOf(target(state(), caller, thread.id)) };
    },
  },
  open_pr: {
    run: async ({ env, caller, args, dispatch }) => {
      const cwd = caller.repo && env.cwdOf(caller);
      if (!cwd) throw new Error('This thread has no project folder, so there is no branch to open a pull request for');
      const githubUser = env.profiles.list().find((p) => p.id === caller.spaceId)?.github || undefined;
      await env.git.push(cwd, githubUser);
      const url = await env.git.createPr(cwd, { title: args.title.trim(), body: prBody(caller, args.why) }, githubUser);
      const opened = openedPr(url, args.title.trim());
      if (opened) dispatch({ type: 'prs-seen', threadId: caller.id, prs: [opened] });
      return { changed: `opened ${url}`, result: { url } };
    },
  },
  claim_criterion: {
    run: ({ state, caller, args, dispatch }) => {
      const criterion = caller.criteria?.find((c) => c.id === args.criterionId);
      if (!caller.goal) throw new Error('This thread has no goal; nothing to claim');
      if (!criterion) throw new Error(`No criterion ${args.criterionId}; get_goal lists them`);
      dispatch({ type: 'criterion-claim', threadId: caller.id, criterionId: criterion.id, evidence: args.evidence.trim(), by: caller.providers[0] });
      return { changed: `claimed "${criterion.text}"`, result: goalOf(target(state(), caller, caller.id)) };
    },
  },
  report_turn: {
    run: ({ state, caller, args, dispatch }) => {
      if (!caller.goal) throw new Error('This thread has no goal; there is nothing to report against');
      dispatch({ type: 'report', threadId: caller.id, report: { by: caller.providers[0], decisions: args.decisions, left: args.left, ...(args.question?.trim() && { question: args.question.trim() }) } });
      return { changed: 'reported', result: reportOf(target(state(), caller, caller.id)) };
    },
  },
  get_report: { run: ({ state, caller, args }) => ({ result: reportOf(target(state(), caller, args.threadId)) }) },
  settle_goal: {
    run: ({ state, caller, args, dispatch }) => {
      const [thread] = others(state(), caller, [args.threadId], 'settle');
      const draft = draftFrom(thread);
      const open = draft.steps.filter((s) => !s.isLocked);
      draft.steps = draft.steps.map((s) => (s.isLocked ? s : { ...s, isRemoved: true }));
      if (open.length) editGoal(dispatch, thread, caller, draft);
      dispatch({ type: 'say', threadId: thread.id, entry: { who: caller.providers[0], kind: 'event', text: `Goal settled by ${authorName(caller.providers[0])}: ${args.reason}` } });
      dispatch({ type: 'settle', threadId: thread.id });
      return { changed: `settled the goal of "${thread.title}"${open.length ? `, dropping ${open.length} open ${open.length === 1 ? 'step' : 'steps'}` : ''}`, result: goalOf(target(state(), caller, thread.id)) };
    },
  },
} satisfies Partial<Specs>;

const LAYOUT_SPECS = {
  open_pane_tab: {
    run: ({ state, caller, args, dispatch }) => {
      const thread = target(state(), caller, args.threadId);
      const kind = args.kind === 'preview' ? 'browser' : args.kind;
      if (kind === 'sidechat') dispatch({ type: 'sidechat-open', threadId: thread.id });
      else dispatch({ type: 'pane-open-tab', threadId: thread.id, kind });
      return { changed: `opened ${args.kind} in "${thread.title}"'s side pane`, result: paneOf(state(), thread.id) };
    },
  },
  focus_thread: {
    run: ({ state, caller, args, dispatch }) => {
      const thread = target(state(), caller, args.threadId);
      dispatch({ type: 'go', view: { kind: 'thread', id: thread.id } });
      return { changed: `brought you to "${thread.title}"`, result: { focused: thread.id } };
    },
  },
  split_with: {
    run: ({ state, caller, args, dispatch }) => {
      const thread = target(state(), caller, args.threadId);
      if (state().spaceId !== caller.spaceId) throw new Error("The user is in another profile right now; splits open in the profile they're looking at");
      dispatch({ type: 'layout-split', view: { kind: 'thread', id: thread.id } });
      return { changed: `opened "${thread.title}" in a split`, result: { split: thread.id } };
    },
  },
  close_pane: {
    run: ({ state, caller, args, dispatch }) => {
      const thread = target(state(), caller, args.threadId);
      if (!state().panes.find((p) => p.threadId === thread.id)?.isOpen) return { result: { note: 'The side pane is already closed' } };
      dispatch({ type: 'pane-toggle', threadId: thread.id });
      return { changed: `closed "${thread.title}"'s side pane`, result: paneOf(state(), thread.id) };
    },
  },
  show_file: {
    run: ({ caller, args, dispatch, state }) => {
      if (!caller.repo) throw new Error('Your thread has no project folder, so there are no files to show');
      const path = args.path.replace(/^\.?\//, '');
      if (path.split('/').includes('..') || path.startsWith('/')) throw new Error('path must stay inside the project, relative to its root');
      dispatch({ type: 'pane-open-tab', threadId: caller.id, kind: 'files', file: { path, line: args.line } });
      return { changed: `opened ${path}${args.line ? `:${args.line}` : ''}`, result: paneOf(state(), caller.id) };
    },
  },
  open_changes: {
    run: ({ state, caller, args, dispatch }) => {
      const thread = target(state(), caller, args.threadId);
      if (!thread.repo) throw new Error(`"${thread.title}" has no project folder, so no changes`);
      dispatch({ type: 'pane-open-tab', threadId: thread.id, kind: 'changes' });
      return { changed: `opened the changes of "${thread.title}"`, result: paneOf(state(), thread.id) };
    },
  },
} satisfies Partial<Specs>;

const NOTIFY_EVERY_MS = 60_000;
const lastNotified = new Map<string, number>();

const USER_SPECS = {
  ask_side_chat: {
    run: ({ caller, args, dispatch }) => {
      dispatch({ type: 'sidechat-open', threadId: caller.id, ask: args.question });
      return { changed: `asked the side chat: "${args.question.slice(0, 80)}"`, result: { note: 'Asked in the side chat; the answer is shown to the user there.' }, isFinal: true };
    },
  },
  notify_user: {
    run: ({ caller, args, env }) => {
      const now = (env.now ?? Date.now)();
      const last = lastNotified.get(caller.id) ?? -Infinity;
      if (now - last < NOTIFY_EVERY_MS) throw new Error(`One notification per minute per thread; try again in ${Math.ceil((NOTIFY_EVERY_MS - (now - last)) / 1000)}s, or keep it for your reply`);
      lastNotified.set(caller.id, now);
      env.notify(args.title, args.reason);
      return { changed: `notified you: ${args.title}`, result: { notified: true }, isFinal: true };
    },
  },
} satisfies Partial<Specs>;

const AGENT_SPECS = {
  start_background_agent: {
    run: ({ state, caller, args, dispatch }) => {
      if (!caller.live) throw new Error('Background agents run only in a live desktop thread.');
      if (args.worktree === 'new' && !caller.repo) throw new Error('This chat has no project, so there is no repository to make a worktree in. Use worktree: same.');
      const id = `bg${(caller.subagents ?? []).filter((s) => s.origin === 'mochi').length + 1}`;
      const agent = { id, name: args.name.trim(), prompt: args.prompt.trim(), provider: providerOf(args.provider, caller), hasOwnWorktree: args.worktree === 'new', ...(args.model && { model: args.model }) };
      dispatch({ type: 'bg-start', threadId: caller.id, agent });
      const started = state().threads.find((t) => t.id === caller.id)?.subagents?.find((s) => s.id === id);
      if (!started) throw new Error('The background agent did not start');
      return { changed: `started background agent "${agent.name}"`, result: agentOf(started), isFinal: true };
    },
  },
  list_background_agents: {
    run: ({ caller, args, env }) => ({ result: { agents: (caller.subagents ?? []).filter((s) => !args.status || s.status === args.status).map((s) => agentOf(s, env.now?.() ?? Date.now())) } }),
  },
  stop_background_agent: {
    run: ({ state, caller, args, dispatch }) => {
      const subagent = caller.subagents?.find((s) => s.id === args.id);
      if (!subagent) throw new Error(`No agent ${args.id} in this thread; ids come from list_background_agents`);
      if (subagent.status !== 'running') throw new Error(`"${subagent.name}" already ${subagent.status === 'done' ? 'finished' : subagent.status}`);
      dispatch({ type: 'bg-stop', threadId: caller.id, subagentId: subagent.id });
      const after = state().threads.find((t) => t.id === caller.id)?.subagents?.find((s) => s.id === subagent.id);
      return { changed: `stopped background agent "${subagent.name}"`, result: agentOf(after ?? subagent), isFinal: true };
    },
  },
} satisfies Partial<Specs>;

const SPECS = { ...THREAD_SPECS, ...GOAL_SPECS, ...LAYOUT_SPECS, ...USER_SPECS, ...AGENT_SPECS, ...BROWSER_TOOLS, ...SETTINGS_TOOLS } satisfies Specs;

// {HELPERS}

/** A thread in the caller's profile; another profile's thread is not found. */
export function target(state: State, caller: Thread, threadId: string | undefined) {
  if (threadId === undefined) return caller;
  const thread = state.threads.find((t) => t.id === threadId && t.spaceId === caller.spaceId);
  if (!thread) throw new Error(`No thread ${threadId} in this profile; list_threads lists them`);
  return thread;
}

function targets(state: State, caller: Thread, ids: string[]) {
  return [...new Set(ids)].map((id) => target(state, caller, id));
}

function others(state: State, caller: Thread, ids: string[], verb: string) {
  const threads = targets(state, caller, ids);
  if (threads.some((t) => t.id === caller.id)) throw new Error(`You can't ${verb} your own thread; the user does that`);
  return threads;
}

function reportOf(thread: Thread) {
  const { goal, criteria = [], report, prs, status } = thread;
  return { threadId: thread.id, title: thread.title, status, goal, criteria: criteria.map(({ id, text, claim }) => ({ id, text, claimed: claim?.evidence ?? null })), report: report ?? null, prs: prs.map(({ number, state, title }) => ({ number, state, title })) };
}

function stepIn(thread: Thread, stepId: string) {
  const step = thread.steps.find((s) => s.id === stepId);
  if (!step) throw new Error(`No step ${stepId} in "${thread.title}"; get_goal lists the step ids`);
  return step;
}

/** True when the draft changed the goal or its plan. */
function editGoal(dispatch: (a: Action) => void, thread: Thread, caller: Thread, draft: GoalDraft, state?: () => State) {
  dispatch({ type: 'edit-goal', threadId: thread.id, draft, by: caller.providers[0] });
  return !state || state().threads.find((t) => t.id === thread.id) !== thread;
}

function sidebar(state: State, caller: Thread) {
  return { pinned: pinnedThreads(state.threads, caller.spaceId).map((t) => t.id), unpinned: activeThreads(state.threads, caller.spaceId).map((t) => t.id) };
}

const isPinned = (t: Thread) => t.orbitSlot !== undefined && t.status !== 'settled';

const providerOf = (provider: Provider | undefined, caller: Thread) => provider ?? caller.providers[0];

/** The caller's controls (or the provider's defaults), with the agent's model and effort where Settings › Tools allows them. */
/** A worktree thread's branch named from its prompt and unique among the repo's branches, as the new-thread composer picks it. */
async function newWorktree(env: ToolEnv, project: string, prompt: string) {
  const { workspaceMode, branchPrefix } = env.prefs.get();
  if (workspaceMode !== 'worktree') return undefined;
  const list = await env.git.branches(project).catch(() => null);
  if (!list) return undefined;
  const taken = new Set(list.branches.filter((b) => !b.isRemote).map((b) => b.name));
  return { mode: workspaceMode, branch: uniqueBranch(branchName(branchPrefix, prompt, 'thread'), taken) };
}

async function newThreadControls(env: ToolEnv, caller: Thread, provider: Provider, picked: { model?: string; effort?: string }) {
  const inherited = provider === caller.providers[0] ? caller.controls : undefined;
  if (!picked.model && !picked.effort) return inherited;
  const rule = env.prefs.get().threadModels;
  const setting = `"${THREAD_MODELS.label}" is "${THREAD_MODELS.options.find((o) => o.value === rule)!.label}" in Settings › Tools`;
  if (rule === 'default') throw new Error(`${setting}: call again without model and effort, or ask the user to change that setting`);
  const models = await env.models(provider, caller.spaceId);
  if (picked.model && models.length && !models.some((m) => m.id === picked.model)) throw new Error(`${picked.model} isn't offered; use one of ${models.map((m) => m.id).join(', ')}`);
  const current = inherited ? controlsOf(caller) : DEFAULT_CONTROLS[provider];
  const next = { ...current, ...(picked.model && { model: picked.model }), ...(picked.effort && { effort: picked.effort }) };
  const dearer = dearerPart(current, next, models);
  if (rule === 'cheaper' && dearer) throw new Error(`${dearer} costs more than this thread's default. ${setting}; ask the user to change it if they want this`);
  return next;
}

/** What in `next` costs more than `current`, or null; a model or effort Mochi can't rank counts as more. */
function dearerPart(current: ThreadControls, next: ThreadControls, models: AgentModel[]) {
  const defaultModel = current.model || defaultModelOf(models)?.id || '';
  if (next.model && next.model !== defaultModel) {
    const [from, to] = [modelTier(defaultModel), modelTier(next.model)];
    if (from === undefined || to === undefined || to > from) return next.model;
  }
  const [from, to] = [effortRank(current.effort), effortRank(next.effort)];
  if (to < 0 || to > from) return `${next.effort} effort`;
  return null;
}

const count = (threads: Thread[]) => (threads.length === 1 ? `"${threads[0].title}"` : `${threads.length} threads`);

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

const asObject = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v : { result: v });

const fail = (text: string): AgentToolResult => ({ text, isError: true });

function agentOf(s: Subagent, now = Date.now()) {
  return { id: s.id, name: s.name, status: s.status, origin: s.origin, provider: s.provider, tokens: s.tokens, elapsedSeconds: Math.round(((s.endedAt ?? now) - s.startedAt) / 1000), ...(s.result && { result: s.result.slice(0, 4000) }), ...(s.error && { error: s.error }) };
}

function goalOf(thread: Thread) {
  return { threadId: thread.id, title: thread.title, goal: thread.goal, criteria: thread.criteria ?? [], status: thread.status, steps: thread.steps.map(stepOf) };
}

function stepOf(s: Thread['steps'][number]) {
  return { id: s.id, title: s.title, status: s.status, size: s.size, ...(s.acceptance && { acceptance: s.acceptance }), ...(s.note && { note: s.note }) };
}

export function summary(thread: Thread) {
  return { id: thread.id, title: thread.title, status: thread.status, pinned: isPinned(thread), provider: thread.providers[0], project: thread.repo?.project ?? null };
}

function paneOf(state: State, threadId: string) {
  const pane = state.panes.find((p) => p.threadId === threadId);
  return { isOpen: !!pane?.isOpen, tabs: pane?.tabs.map((t) => ({ tabId: t.id, kind: t.kind, ...(t.url && { url: t.url }), ...(t.file && { file: t.file }) })) ?? [], activeTab: pane?.activeTab ?? null };
}
