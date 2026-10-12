import { z } from 'zod';
import type { Page } from '../browser/pages.ts';
import type { AgentToolCall, AgentToolResult } from '../host/types/agent.ts';
import type { BrowserHost } from '../host/types/browser.ts';
import { authorName, PIN_SLOTS, type Provider, type QueueItem, type Size, type StepStatus, type Thread } from '../model.ts';
import { draftFrom, type GoalDraft } from '../goals/edit.ts';
import { projectRef } from '../projects.ts';
import { activeThreads, dropPin, pinnedThreads } from '../reorder.ts';
import type { AgentControl } from '../settings/prefs.ts';
import type { Action, State } from '../store/index.tsx';
import { BROWSER_TOOLS } from './browserTools.ts';
import { APPROVAL_TIMEOUT_MS, isQuiet, tierOf, TOOL_TABLE, type Tier, type ToolName } from './toolTable.ts';
import { captureUndo, type ToolUndo } from './undo.ts';

/** What the store and the app give a tool run. The renderer wires the real ones (`store/index.tsx`); tests pass stubs. */
export interface ToolEnv {
  getState: () => State;
  /** Applies `action`; `getState` returns the state after it straight away. */
  dispatch: (action: Action) => void;
  agentControl: () => AgentControl;
  /** A toast for a reversible change; `undo` set when it can be undone. */
  toast: (text: string, undo?: ToolUndo) => void;
  notify: (title: string, body: string) => void;
  /** Removes a thread's worktree from disk after a delete; resolves when done. */
  removeWorktree: (threadId: string) => Promise<void>;
  /** The browser tabs' pages (`src/browser/pages.ts`) and main's native views behind them. */
  pages: { get: (key: string) => Page | undefined; update: (key: string, patch: Partial<Page>) => void };
  browser: Pick<BrowserHost, 'navigate' | 'command' | 'capture' | 'snapshot' | 'act' | 'logs'>;
  isDesktop: boolean;
  now?: () => number;
}

export interface ToolContext<A = Record<string, unknown>> {
  env: ToolEnv;
  caller: Thread;
  args: A;
  state: () => State;
  dispatch: (action: Action) => void;
  /** Asks the user on a card mid-run (browser escalation); throws when the setting doesn't allow it or they deny. */
  confirm: (approval: Approval) => Promise<string[]>;
}

/** The card's text says exactly what happens; `options` are checkboxes, off by default, whose ids come back when approved. */
export interface Approval {
  title: string;
  detail: string;
  options?: { id: string; label: string }[];
}

export interface Outcome {
  result: unknown;
  /** Past tense, for the thread log and the toast after the agent's name: "settled 2 threads". */
  changed?: string;
  image?: AgentToolResult['image'];
  /** The change can't be put back (a click, a sent message), so its toast has no Undo. */
  isFinal?: boolean;
}

type Args<K extends ToolName> = z.infer<z.ZodObject<(typeof TOOL_TABLE)[K]['shape']>>;

export interface ToolSpec<K extends ToolName> {
  run: (ctx: ToolContext<Args<K>>, options: string[]) => Outcome | Promise<Outcome>;
  /** Consequential tools: what the approval card says. */
  ask?: (ctx: ToolContext<Args<K>>) => Approval;
}

type Specs = { [K in ToolName]: ToolSpec<K> };

/** Which tiers each setting lets run; a consequential call still waits on its card. */
const ALLOWED = { read: ['read'], reversible: ['read', 'reversible'], everything: ['read', 'reversible', 'consequential'] } satisfies Record<AgentControl, Tier[]>;

export const AGENT_CONTROL_LABELS = { read: 'Read only', reversible: 'Reversible changes', everything: 'Everything, with confirmation' } satisfies Record<AgentControl, string>;

/**
 * Runs a Mochi tool an agent called (RUNTIME.md › Mochi tools): checks scope and the tier the setting allows, asks on a
 * card for consequential calls, runs the handler on the store, logs it in the caller's thread, and toasts with Undo.
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
  try {
    gate(ctx, name, tierOf(name));
    const options = spec.ask ? await ask(ctx, spec.ask(ctx)) : [];
    const before = env.getState();
    const outcome = await spec.run(ctx, options);
    const undo = tierOf(name) === 'reversible' && !outcome.isFinal ? captureUndo(before, env.getState()) : null;
    if (outcome.changed && tierOf(name) !== 'read') record(ctx, name, outcome.changed, undo);
    return { text: JSON.stringify(outcome.changed ? { changed: capitalize(outcome.changed), ...asObject(outcome.result) } : outcome.result), ...(outcome.image && { image: outcome.image }) };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/** Approve and Deny on a tool card land here; the waiting call goes on. */
export function decideTool(queueId: string, decision: { isApproved: boolean; options?: string[] }) {
  waiting.get(queueId)?.(decision);
}

const waiting = new Map<string, (decision: { isApproved: boolean; options?: string[] }) => void>();
let nextCard = 0;

function context<A>(env: ToolEnv, caller: Thread, args: A, name: ToolName): ToolContext<A> {
  const ctx: ToolContext<A> = { env, caller, args, state: env.getState, dispatch: env.dispatch, confirm: (approval) => (gate(ctx, name, 'consequential'), ask(ctx, approval)) };
  return ctx;
}

function gate(ctx: ToolContext<unknown>, name: ToolName, tier: Tier) {
  const control = ctx.env.agentControl();
  if ((ALLOWED[control] as Tier[]).includes(tier)) return;
  const suggested: AgentControl = tier === 'consequential' ? 'everything' : 'reversible';
  ctx.dispatch({
    type: 'queue-add',
    item: card(ctx, `setting-agentControl-${ctx.caller.id}`, 'setting', {
      title: `${authorName(ctx.caller.providers[0])} wants to ${name.replaceAll('_', ' ')}`,
      detail: `Agents can only ${control === 'read' ? 'read Mochi' : 'make changes you can undo'} right now. Allow more here, then ask it to try again.`,
      setting: { id: 'agentControl', suggested },
    }),
  });
  throw new Error(`Blocked by the user's setting "Agents can change Mochi: ${AGENT_CONTROL_LABELS[control]}". ${name} needs "${AGENT_CONTROL_LABELS[suggested]}". The user now sees that setting in this thread; ask them to change it, then call again.`);
}

async function ask(ctx: ToolContext<unknown>, approval: Approval): Promise<string[]> {
  const id = `q-tool-${ctx.caller.id}-${++nextCard}`;
  ctx.dispatch({ type: 'queue-add', item: card(ctx, id, 'approval', { title: approval.title, detail: approval.detail, tool: { callId: id, options: approval.options } }) });
  const decision = await new Promise<{ isApproved: boolean; options?: string[] } | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), APPROVAL_TIMEOUT_MS);
    waiting.set(id, (d) => (clearTimeout(timer), resolve(d)));
  });
  waiting.delete(id);
  ctx.dispatch({ type: 'queue-dismiss', queueId: id });
  const verdict = !decision ? 'Expired, nobody answered' : decision.isApproved ? 'Approved' : 'Denied';
  ctx.dispatch({ type: 'say', threadId: ctx.caller.id, entry: { who: decision ? 'you' : 'harness', kind: 'event', text: `${verdict}: ${approval.title}` } });
  if (!decision) throw new Error(`Nobody answered the card in ${APPROVAL_TIMEOUT_MS / 60_000} minutes; nothing was done.`);
  if (!decision.isApproved) throw new Error(`The user denied it: ${approval.title} Nothing was done.`);
  return decision.options ?? [];
}

function card(ctx: ToolContext<unknown>, id: string, kind: QueueItem['kind'], item: Pick<QueueItem, 'title' | 'detail' | 'tool' | 'setting'>): QueueItem {
  return { id, kind, threadId: ctx.caller.id, blocks: { steps: 0, threads: 1 }, createdAt: ctx.state().now, ...item };
}

function record(ctx: ToolContext<unknown>, name: ToolName, changed: string, undo: ToolUndo | null) {
  const text = `${authorName(ctx.caller.providers[0])} ${changed}`;
  ctx.dispatch({ type: 'say', threadId: ctx.caller.id, entry: { who: ctx.caller.providers[0], kind: 'event', text } });
  if (!isQuiet(name)) ctx.env.toast(text, undo ?? undefined);
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
    ask: ({ args, caller }) => ({
      title: `Start a new ${providerOf(args.provider, caller) === 'claude' ? 'Claude' : 'Codex'} thread?`,
      detail: `In ${caller.repo?.project ?? 'a folderless chat'}, working on: "${args.prompt.trim().slice(0, 200)}". It runs its own agent on your account.`,
    }),
    run: ({ state, caller, args, dispatch }) => {
      const prompt = args.prompt.trim();
      if (!prompt) throw new Error('prompt is required');
      const provider = providerOf(args.provider, caller);
      const before = state();
      dispatch({
        type: 'create',
        title: prompt,
        provider,
        project: projectRef(caller.repo),
        controls: provider === caller.providers[0] ? caller.controls : undefined,
        isLive: !!caller.live,
        isBackground: true,
      });
      const created = state().threads.find((t) => !before.threads.some((s) => s.id === t.id))!;
      return { changed: `started "${created.title}"`, result: summary(created) };
    },
  },
  send_to_thread: {
    ask: ({ state, caller, args }) => {
      const thread = target(state(), caller, args.threadId);
      return { title: `Send a message to "${thread.title}"?`, detail: `${authorName(thread.providers[0])} in that thread gets: "${args.text.trim().slice(0, 400)}"` };
    },
    run: ({ state, caller, args, dispatch }) => {
      const [thread] = others(state(), caller, [args.threadId], 'message');
      const text = `From "${caller.title}": ${args.text.trim()}`;
      dispatch({ type: 'send', threadId: thread.id, text, drift: 'on-goal', reason: `Sent by ${authorName(caller.providers[0])} from another thread` });
      return { changed: `messaged "${thread.title}"`, result: { threadId: thread.id, sent: text }, isFinal: true };
    },
  },
  delete_thread: {
    ask: ({ state, caller, args }) => {
      const threads = others(state(), caller, args.threadIds, 'delete');
      const names = threads.map((t) => `"${t.title}"`).join(', ');
      const withTrees = threads.filter((t) => t.repo);
      return {
        title: threads.length === 1 ? `Delete ${names}?` : `Delete ${threads.length} threads?`,
        detail: `${threads.length > 1 ? `${names}. ` : ''}Stops ${threads.length === 1 ? 'its agent' : 'their agents'} and removes ${threads.length === 1 ? 'its' : 'their'} history from Mochi. This can't be undone.`,
        options: withTrees.length ? [{ id: 'removeWorktree', label: withTrees.length === 1 ? `Also remove its worktree (${withTrees[0].repo!.branch})` : `Also remove their ${withTrees.length} worktrees` }] : undefined,
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
      draft.steps.push({ title, size: (args.size ?? 1) as Size, gate: false, isRemoved: false, isLocked: false });
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
  show_setting: {
    run: ({ caller, args, dispatch, state }) => {
      dispatch({
        type: 'queue-add',
        item: { id: `q-setting-${args.settingId}-${caller.id}`, kind: 'setting', threadId: caller.id, title: args.reason, detail: '', setting: { id: args.settingId, suggested: args.suggested }, blocks: { steps: 0, threads: 1 }, createdAt: state().now },
      });
      return { result: { shown: args.settingId, note: 'The user sees the setting in your thread and can change it there.' } };
    },
  },
} satisfies Partial<Specs>;

const SPECS = { ...THREAD_SPECS, ...GOAL_SPECS, ...LAYOUT_SPECS, ...USER_SPECS, ...BROWSER_TOOLS } satisfies Specs;

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

function stepIn(thread: Thread, stepId: string) {
  const step = thread.steps.find((s) => s.id === stepId);
  if (!step) throw new Error(`No step ${stepId} in "${thread.title}"; get_goal lists the step ids`);
  return step;
}

/** True when the draft changed the goal (a new revision landed). */
function editGoal(dispatch: (a: Action) => void, thread: Thread, caller: Thread, draft: GoalDraft, state?: () => State) {
  dispatch({ type: 'edit-goal', threadId: thread.id, draft, by: caller.providers[0] });
  return !state || state().threads.find((t) => t.id === thread.id)!.revisions.length > thread.revisions.length;
}

function sidebar(state: State, caller: Thread) {
  return { pinned: pinnedThreads(state.threads, caller.spaceId).map((t) => t.id), unpinned: activeThreads(state.threads, caller.spaceId).map((t) => t.id) };
}

const isPinned = (t: Thread) => t.orbitSlot !== undefined && t.status !== 'settled';

const providerOf = (provider: Provider | undefined, caller: Thread) => provider ?? caller.providers[0];

const count = (threads: Thread[]) => (threads.length === 1 ? `"${threads[0].title}"` : `${threads.length} threads`);

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

const asObject = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v : { result: v });

const fail = (text: string): AgentToolResult => ({ text, isError: true });

function goalOf(thread: Thread) {
  return { threadId: thread.id, title: thread.title, goal: thread.goal, status: thread.status, steps: thread.steps.map(stepOf) };
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
