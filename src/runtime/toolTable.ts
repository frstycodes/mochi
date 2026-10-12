import { z } from 'zod';
import { STEP_STATUSES } from '../host/types/agent.ts';

/**
 * Every Mochi tool an agent can call, in one table (RUNTIME.md › Mochi tools): main builds the MCP servers from it and
 * the renderer enforces `tier` from it. Descriptions are written for the agent reading them.
 */
export type Tier = 'read' | 'change' | 'destructive' | 'setting';

export const TIERS = ['read', 'change', 'destructive', 'setting'] as const satisfies Tier[];

/** Tiers that wait on the user's widget in the thread every time; everything else runs without asking. */
export const ASKING_TIERS = ['destructive', 'setting'] as const satisfies Tier[];

const threadId = z.string().optional().describe('A thread in this profile (ids come from list_threads); defaults to your own thread');
const otherThread = z.string().describe('A thread in this profile; ids come from list_threads');
const threadIds = z.array(z.string()).min(1).describe('Threads in this profile; ids come from list_threads');
const stepId = z.string().describe('A step id from get_goal');
const tabId = z.string().optional().describe("One of your thread's browser tabs from browser_tabs; defaults to the active one");
const ref = z.string().describe('An element ref like "e12" from the latest browser_snapshot');

export const TOOL_TABLE = {
  // {THREADS}
  list_threads: {
    tier: 'read',
    description: 'List the threads in this profile with id, title, status, pinned slot, project and provider. Filter by status, pinned, or project name.',
    shape: {
      status: z.enum(['running', 'needs-you', 'review', 'settled']).optional(),
      pinned: z.boolean().optional().describe('true: only pinned threads; false: only unpinned'),
      project: z.string().optional().describe('Project (folder) name'),
    },
  },
  get_thread: {
    tier: 'read',
    description: "Read one thread in detail: goal, steps with status, its last activity, pull requests, and anything it's waiting on you for.",
    shape: { threadId },
  },
  rename_thread: { tier: 'change', description: "Rename a thread. Shows the user an Undo toast.", shape: { threadId, title: z.string().min(1).max(120) } },
  settle_thread: {
    tier: 'change',
    description: "Settle threads whose work is finished or abandoned: they leave the sidebar's active list and their agents stop. Not your own thread. Undoable by the user.",
    shape: { threadIds },
  },
  reactivate_thread: { tier: 'change', description: 'Bring settled threads back to the active list.', shape: { threadIds } },
  pin_thread: { tier: 'change', description: 'Pin threads to the top of the sidebar (at most 5 pinned in a profile), in the order given.', shape: { threadIds } },
  unpin_thread: { tier: 'change', description: 'Unpin threads; they go to the top of the unpinned list.', shape: { threadIds } },
  reorder_threads: {
    tier: 'change',
    description:
      'Reorder the sidebar. Either move one thread before or after another (moving next to a pinned thread pins it), or pass pinnedOrder to set the whole pinned list in order (threads left out are unpinned).',
    shape: {
      threadId: z.string().optional().describe('The thread to move'),
      before: z.string().optional().describe('Put it just above this thread'),
      after: z.string().optional().describe('Put it just below this thread'),
      pinnedOrder: z.array(z.string()).max(5).optional().describe('The full pinned list, top first'),
    },
  },
  watch_thread: { tier: 'change', quiet: true, description: 'Watch a thread (its events toast for the user) or stop watching it.', shape: { threadId: otherThread, watch: z.boolean() } },
  create_thread: {
    tier: 'change',
    description: 'Start a new thread in the same project, with its own agent working on `prompt`. The user stays on the view they are on and can undo it from a toast.',
    shape: { prompt: z.string(), provider: z.enum(['claude', 'codex']).optional().describe("Defaults to this thread's agent") },
  },
  send_to_thread: {
    tier: 'change',
    description: "Send a message to another thread's agent, as if typed in its composer.",
    shape: { threadId: otherThread, text: z.string().min(1) },
  },
  delete_thread: {
    tier: 'destructive',
    description: 'Delete threads for good: stops their agents and removes their history. The user approves in the thread and can choose to remove the worktrees too. Not your own thread.',
    shape: { threadIds },
  },
  // {GOALS}
  get_goal: { tier: 'read', description: "Read a thread's goal and its steps, with each step's id, status, size and acceptance criteria.", shape: { threadId } },
  set_step_status: {
    tier: 'change',
    quiet: true,
    description: "Set a goal step's status. Mark steps running when you start them and done when finished, so the user sees progress.",
    shape: { stepId, status: z.enum(STEP_STATUSES), threadId },
  },
  add_step: {
    tier: 'change',
    quiet: true,
    description: "Add a step to a thread's goal, as a new goal revision.",
    shape: { title: z.string(), size: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().describe('1 small, 2 medium, 3 large'), threadId },
  },
  edit_goal: {
    tier: 'change',
    description: "Change a thread's goal text and/or steps' acceptance criteria, as one new goal revision.",
    shape: {
      threadId,
      goal: z.string().optional().describe('The new goal text'),
      criteria: z
        .array(z.object({ stepId, text: z.string().describe('What done means; empty removes it'), command: z.string().optional().describe('A command that checks it, like "pnpm test"') }))
        .optional(),
    },
  },
  reorder_steps: { tier: 'change', description: 'Reorder goal steps. List step ids top first; steps left out keep their place after them.', shape: { threadId, order: z.array(z.string()).min(1) } },
  drop_step: { tier: 'change', description: "Drop a step that's no longer needed. Done steps can't be dropped.", shape: { threadId, stepId, reason: z.string().optional() } },
  settle_goal: {
    tier: 'change',
    description: 'Close out a goal: drops every open step with your reason and settles the thread. Use when the goal is met or no longer wanted. Not your own thread.',
    shape: { threadId: otherThread, reason: z.string().min(1) },
  },
  // {AGENTS}
  start_background_agent: {
    tier: 'change',
    quiet: true,
    description:
      "Start a background agent that works on its own while you keep going: in your worktree (worktree: same, the default; it sees and edits your files) or a fresh worktree on a new branch (worktree: new). It runs on this profile's account and counts toward the concurrency cap. When it finishes, its report comes to you with the user's next message. For work that needs no answer from you mid-way; for a quick lookup use your own subagents.",
    shape: {
      prompt: z.string().min(1).max(20_000).describe('The whole task: it sees nothing of this conversation'),
      name: z.string().min(1).max(60).describe('A few words the user sees, like "Fix flaky checkout test"'),
      worktree: z.enum(['same', 'new']).optional(),
      provider: z.enum(['claude', 'codex']).optional().describe("Defaults to this thread's agent"),
      model: z.string().optional().describe("A model id the account offers; defaults to this thread's"),
    },
  },
  list_background_agents: {
    tier: 'read',
    description: "List this thread's subagents and background agents: id, name, status, origin (mochi: started with start_background_agent; native: your own), tokens, elapsed, and the result of finished ones.",
    shape: { status: z.enum(['running', 'done', 'failed', 'stopped']).optional() },
  },
  stop_background_agent: { tier: 'change', quiet: true, description: 'Stop one of your running background agents (ids from list_background_agents). Its partial work stays in its worktree.', shape: { id: z.string() } },
  // {BROWSER}
  browser_tabs: { tier: 'read', description: "List your thread's browser tabs in the side pane: tabId, url, title, loading, active.", shape: {} },
  browser_open: {
    tier: 'change',
    quiet: true,
    description: 'Open a URL in your thread\'s in-app browser (the side pane preview), in the active browser tab or a new one. Waits for the page to load. Local dev URLs (localhost, *.test) are the normal case.',
    shape: { url: z.string().describe('Like "localhost:5173" or "https://example.com"'), newTab: z.boolean().optional() },
  },
  browser_snapshot: {
    tier: 'read',
    description: 'Read the page as an accessibility tree: roles, names and text, with [ref=eN] on things you can click or type into. Take one before browser_click / browser_type; refs reset on every snapshot.',
    shape: { tabId },
  },
  browser_click: { tier: 'change', quiet: true, description: 'Click an element from the latest snapshot. On non-local sites, clicking a submit button asks the user first.', shape: { tabId, ref } },
  browser_type: {
    tier: 'change',
    quiet: true,
    description: 'Replace the text in a field from the latest snapshot. submit: true presses Enter after. On non-local sites typing asks the user first.',
    shape: { tabId, ref, text: z.string(), submit: z.boolean().optional() },
  },
  browser_press: { tier: 'change', quiet: true, description: 'Press a key in the page, like "Enter", "Escape", "Tab", "ArrowDown" or a single character.', shape: { tabId, key: z.string().min(1) } },
  browser_scroll: {
    tier: 'change',
    quiet: true,
    description: 'Scroll the page, or the element `ref`, by pixels (positive down / right).',
    shape: { tabId, ref: ref.optional(), dy: z.number().optional().describe('Default 600'), dx: z.number().optional() },
  },
  browser_hover: { tier: 'change', quiet: true, description: 'Move the pointer over an element from the latest snapshot, for menus and tooltips that open on hover.', shape: { tabId, ref } },
  browser_select: { tier: 'change', quiet: true, description: 'Pick an option in a <select> from the latest snapshot, by its label or value.', shape: { tabId, ref, value: z.string() } },
  browser_drag: {
    tier: 'change',
    quiet: true,
    description: 'Drag one element from the latest snapshot onto another with the mouse (sortable lists, sliders, boards).',
    shape: { tabId, from: ref.describe('The ref to pick up'), to: ref.describe('The ref to drop on') },
  },
  browser_upload: {
    tier: 'change',
    quiet: true,
    description: "Put a file into a file input from the latest snapshot. Files inside your thread's worktree go straight in; any other path asks the user first.",
    shape: { tabId, ref, path: z.string().describe('Relative to your worktree, or absolute') },
  },
  browser_wait_for: {
    tier: 'read',
    description: 'Wait until the page shows some text, has an element matching a CSS selector, or its URL contains a string; or, with none of those, just wait. Returns whether it happened.',
    shape: {
      tabId,
      text: z.string().optional(),
      selector: z.string().optional(),
      url: z.string().optional(),
      timeoutMs: z.number().int().min(0).max(25_000).optional().describe('Default 5000, at most 25000'),
    },
  },
  browser_eval: {
    tier: 'change',
    quiet: true,
    description:
      "Run JavaScript in the page's own context, where it can read the app's state; top-level await works. Returns the last expression as JSON (capped at 20k chars), or the error. Stops after 10s. Runs on your local dev pages directly; on any other site it asks the user first, since it runs with their signed-in session there. Prefer the other browser tools when they can do it.",
    shape: { tabId, script: z.string().min(1).max(100_000) },
  },
  browser_screenshot: { tier: 'read', description: 'A PNG of the page as the user sees it, or the whole scrollable page.', shape: { tabId, fullPage: z.boolean().optional() } },
  browser_console: { tier: 'read', description: "The page's recent console messages (all levels), newest last.", shape: { tabId } },
  browser_back: { tier: 'change', quiet: true, description: 'Go back in the tab.', shape: { tabId } },
  browser_forward: { tier: 'change', quiet: true, description: 'Go forward in the tab.', shape: { tabId } },
  browser_reload: { tier: 'change', quiet: true, description: 'Reload the tab.', shape: { tabId } },
  browser_set_device: {
    tier: 'change',
    quiet: true,
    description: 'Emulate a device size: responsive (fills the pane), iphone-se, iphone-16, iphone-16-pro-max, pixel-9, ipad-mini, ipad-pro, laptop.',
    shape: { tabId, device: z.string(), rotated: z.boolean().optional() },
  },
  // {LAYOUT}
  open_pane_tab: {
    tier: 'change',
    quiet: true,
    description: "Open a tab in a thread's side pane: preview (browser), changes, terminal, files or sidechat.",
    shape: { kind: z.enum(['preview', 'changes', 'terminal', 'files', 'sidechat']), threadId },
  },
  focus_thread: { tier: 'change', description: 'Show a thread in the focused split, moving the user there. Undoable.', shape: { threadId: otherThread } },
  split_with: { tier: 'change', description: 'Open a thread in a new split beside the focused one.', shape: { threadId: otherThread } },
  close_pane: { tier: 'change', quiet: true, description: "Close a thread's side pane (its tabs are kept).", shape: { threadId } },
  show_file: {
    tier: 'change',
    quiet: true,
    description: "Open a file from your thread's project in the side pane's file viewer, at a line.",
    shape: { path: z.string().describe('Relative to the project root'), line: z.number().int().positive().optional() },
  },
  open_changes: { tier: 'change', quiet: true, description: "Open the Changes tab (the thread's diff) in the side pane.", shape: { threadId } },
  // {USER}
  ask_side_chat: {
    tier: 'change',
    quiet: true,
    description: "Open your thread's side chat and ask it a question for the user, answered by a separate model that sees this thread. The answer is for the user; it isn't returned to you.",
    shape: { question: z.string().min(1) },
  },
  notify_user: {
    tier: 'change',
    quiet: true,
    description: 'Tell the user something that needs their attention now, as a toast and an OS notification. At most one per minute per thread; say why in `reason`.',
    shape: { title: z.string().min(1).max(80), reason: z.string().min(1).max(240) },
  },
  // {SETTINGS}
  get_settings: { tier: 'read', description: 'Read the Mochi settings you can propose changes to: each key with its label, current value and allowed values.', shape: {} },
  update_setting: {
    tier: 'setting',
    description:
      'Propose changing one Mochi setting (keys and allowed values from get_settings). The user sees the current and proposed value in your thread and applies or keeps it; you get the outcome. Say why in `reason`.',
    shape: { key: z.string().describe('A key from get_settings'), value: z.string().describe('One of the allowed values from get_settings'), reason: z.string().min(1).max(240) },
  },
} as const satisfies Record<string, { tier: Tier; quiet?: true; description: string; shape: z.ZodRawShape }>;

export type ToolName = keyof typeof TOOL_TABLE;

export const TOOL_NAMES = Object.keys(TOOL_TABLE) as ToolName[];

export const tierOf = (name: ToolName): Tier => TOOL_TABLE[name].tier;

export const isQuiet = (name: ToolName) => 'quiet' in TOOL_TABLE[name];

export const asks = (tier: Tier) => (ASKING_TIERS as readonly Tier[]).includes(tier);

/** How long a call may wait on the user's widget. Main and both harnesses get the same limit (RUNTIME.md). */
export const APPROVAL_TIMEOUT_MS = 30 * 60_000;

/** How long main and both harnesses let one Mochi call run: past the card's own limit, so the card times out first and says so. */
export const MOCHI_TIMEOUT_MS = APPROVAL_TIMEOUT_MS + 60_000;
