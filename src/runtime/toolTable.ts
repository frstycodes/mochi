import { z } from 'zod';
import { SETTING_SECTIONS } from '../settings/settingSections.ts';

/**
 * Every Mochi tool an agent can call, in one table (RUNTIME.md › Mochi tools): main builds the MCP servers from it and
 * the renderer enforces `tier` from it. Descriptions are written for the agent reading them.
 */
export type Tier = 'read' | 'change' | 'destructive' | 'setting';

export const TIERS = ['read', 'change', 'destructive', 'setting'] as const satisfies Tier[];

/** Tiers that put a widget in the thread every time: a delete waits for its answer, a setting widget is the user's to change. */
export const ASKING_TIERS = ['destructive', 'setting'] as const satisfies Tier[];

const threadId = z.string().optional().describe('A thread in this profile (ids come from list_threads); defaults to your own thread');
const otherThread = z.string().describe('A thread in this profile; ids come from list_threads');
const threadIds = z.array(z.string()).min(1).describe('Threads in this profile; ids come from list_threads');
const tabId = z.string().optional().describe("One of your thread's browser tabs from browser_tabs; defaults to the active one");
const ref = z.string().describe('An element ref like "g3-e12" from the latest browser_snapshot');
const profileId = z.string().optional().describe('A profile id from list_profiles; defaults to your own');
const configProvider = z.enum(['claude', 'codex']).optional().describe("Which harness's config; defaults to your own");
const reason = z.string().min(1).max(240).describe('Why, in a sentence the user reads on the widget');

/** The MCP server Mochi's tools are on: agents see them as `mcp__mochi__<tool>`. */
export const MOCHI_SERVER = 'mochi';

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
    description: "Read one thread in detail: goal, its agent's plan (title and status of each item), its last activity, pull requests, and anything it's waiting on you for.",
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
    description:
      "Start a new thread in the same project, with its own agent working on `prompt`. The user stays on the view they are on and can undo it from a toast. Leave model and effort out unless the user named them, or the task is clearly simple enough for a cheaper model or lower effort; never pick something more expensive than the default on your own. The user's setting may refuse a choice; relay its reason. As a sub-thread (`criterionId`, or `isSubThread`) it works on one piece of your goal: it nests under this thread, branches from your branch, opens its PR into it, and hands its result back here.",
    shape: {
      prompt: z.string(),
      criterionId: z.string().optional().describe('Hand this criterion of your goal (an id from get_goal) to the new thread as a sub-thread; its result claims it when handed back'),
      isSubThread: z.boolean().optional().describe('A sub-thread with no criterion of its own: part of your work, nested under this thread'),
      provider: z.enum(['claude', 'codex']).optional().describe("Defaults to this thread's agent"),
      model: z.string().optional().describe("A model id the account offers, like \"claude-sonnet-5-5\"; defaults to this thread's"),
      effort: z.string().optional().describe("low, medium, high, xhigh or max; defaults to this thread's"),
    },
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
  get_goal: { tier: 'read', description: "Read a thread's goal (empty for a question or chat) and what done means: its criteria, each with its id, its check command when Mochi runs one, your claim and Mochi's check result.", shape: { threadId } },
  open_pr: {
    tier: 'change',
    description:
      'Open the pull request for your branch: Mochi pushes it and writes the description from the goal, its criteria and your report, so give only a title and one line of why. Commit first. Use this instead of `gh pr create`.',
    shape: {
      title: z.string().min(1).max(72).describe('Conventional Commits style, like "fix(auth): keep the session cookie"'),
      why: z.string().min(1).max(300).describe('One sentence: why this change'),
    },
  },
  propose_goal: {
    tier: 'change',
    quiet: true,
    description:
      "After your first look at the code, propose this thread's goal: the concrete outcome you found the user is asking for, and 2 to 4 criteria that prove it, each with a command when one would. The user accepts it, or Mochi applies it with an undo. Call it again only when what done means has to change; it replaces the whole goal. Keep working while it waits.",
    shape: {
      goal: z.string().min(1).max(120).describe('What will be true when this is done, specific to what you found'),
      criteria: z
        .array(z.object({ text: z.string().min(1).max(120), command: z.string().optional().describe('A command that proves it, like "pnpm test"; leave out for what the user checks') }))
        .min(1)
        .max(4),
      basis: z.string().max(200).optional().describe('One line: what you saw that makes this the goal'),
    },
  },
  claim_criterion: {
    tier: 'change',
    quiet: true,
    description: "Say one of your goal's criteria is met, with one line of evidence the user can check (a command and its result, a file, a URL). Call it as soon as each criterion is met; get_goal lists the criterion ids.",
    shape: { criterionId: z.string().describe('A criterion id from get_goal'), evidence: z.string().min(1).max(240) },
  },
  report_turn: {
    tier: 'change',
    quiet: true,
    description:
      'At the end of a turn where you changed anything for a goal, report once so the user can skip reading your reply: what changed, decisions you made, what is left, at most one question that needs them, and the next move as a yes/no question. Short lines, no prose.',
    shape: {
      summary: z.string().max(360).optional().describe('What changed, in the user\'s terms, 1 to 3 sentences'),
      decisions: z.array(z.string().max(160)).max(5).describe('Choices you made that the user should know about'),
      left: z.array(z.string().max(160)).max(5).describe('What is still not done'),
      question: z.string().max(240).optional().describe('The one thing you need from the user, if anything'),
      next: z.string().max(160).optional().describe('The next move as one yes/no question naming the exact thing, like "Commit the cookie fix and its test?"'),
      alternative: z
        .object({ label: z.string().min(1).max(32).describe('The other answer, like "Revise the plan"'), draft: z.string().min(1).max(200).describe('What it puts in the message box for the user to finish, like "Before building, I want to change the plan:"') })
        .optional(),
    },
  },
  get_report: {
    tier: 'read',
    description: "Read a thread's latest report as data: goal, criteria with claims, decisions, what's left, the open question, PRs and status. For coordinating other threads without reading their transcripts.",
    shape: { threadId },
  },
  settle_goal: {
    tier: 'change',
    description: 'Close out a goal and settle the thread, with your reason. Use when the goal is met or no longer wanted. Not your own thread.',
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
  browser_dialog: {
    tier: 'change',
    quiet: true,
    description: "Answer the alert or confirm the page is showing: accept true is OK, false is Cancel. While one is open, the other browser tools on that tab fail with its message.",
    shape: { tabId, accept: z.boolean() },
  },
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
  get_settings: {
    tier: 'read',
    description:
      "Read Mochi's settings: each key with its label, section (the Settings page) and group (the titled section on that page), current value, the values it takes, and whether you may propose it. Profile settings (name, icon, GitHub and agent accounts, instructions files, MCP servers, skills) are your profile's unless you pass profileId. section: profile adds each MCP server's tool count (it starts the servers). Secret values are never returned.",
    shape: {
      section: z.enum(SETTING_SECTIONS).optional(),
      profileId,
    },
  },
  update_settings: {
    tier: 'setting',
    description:
      "Suggest setting changes to the user: one settings widget in your thread shows each setting's real control with your value as a suggestion, and the user changes what they want there, now or later. Group related changes in one call. Returns once the widget is shown; you don't get the user's answer (get_settings reads the values later). Keys and values from get_settings; locked keys are refused.",
    shape: {
      changes: z
        .array(z.object({ key: z.string().describe('A key from get_settings'), value: z.string().describe('As get_settings shows values: "true"/"false", an allowed value, a number or text'), profileId }))
        .min(1)
        .max(20),
      reason,
    },
  },
  get_keybindings: {
    tier: 'read',
    description:
      "Read Mochi's keyboard shortcuts: each command's id, title, group, where it listens (global, pane, list), its chord now and its default (\"\" = none), the keys that can't be rebound, and this platform's reserved chords. Chords read like \"mod+shift+K\": mod is ⌘ on macOS and Ctrl elsewhere, nav is ⌃ on macOS and Alt elsewhere, then alt, shift and one key.",
    shape: {},
  },
  set_keybinding: {
    tier: 'setting',
    description:
      'Suggest a new shortcut for one command: a settings widget in your thread shows its current → proposed chord with your reason, and the user applies it there. Ids and chords from get_keybindings; keys "" suggests removing the shortcut. Reserved chords (⌘Q, ⌘Tab, ⌃←/→ on macOS, Alt+Tab elsewhere, Copy and Paste) are refused. A chord another command uses is refused unless onConflict says what happens to it: swap (it gets this command\'s old chord) or replace (it loses its shortcut); both rows show on the widget.',
    shape: {
      command: z.string().describe('A command id from get_keybindings'),
      keys: z.string().describe('Like "mod+shift+K", "nav+1" or "J"; "" for no shortcut'),
      onConflict: z.enum(['swap', 'replace']).optional(),
      reason,
    },
  },
  list_profiles: {
    tier: 'read',
    description:
      "List Mochi's profiles: id, name, icon, the Claude and Codex accounts each runs on (with login state), its GitHub account, and which one is yours. Also every existing agent account, for proposing profile.claudeAccount / profile.codexAccount.",
    shape: {},
  },
  add_mcp_server: {
    tier: 'setting',
    description:
      "Suggest adding an MCP server to a profile's account: a `command` (stdio) or a `url` (http). The user sees it filled in on a settings widget in your thread and adds it there if they want; you don't get their answer. Never pass secrets: put `${VAR}` where a token goes; a value that looks like a credential is refused.",
    shape: {
      profileId,
      provider: configProvider,
      name: z.string().regex(/^[\w-]{1,64}$/).describe('Letters, digits, - and _'),
      command: z.string().min(1).optional(),
      args: z.array(z.string()).optional(),
      env: z.record(z.string(), z.string()).optional().describe('Values like "${GITHUB_TOKEN}" read from the environment'),
      url: z.string().url().optional(),
      headers: z.record(z.string(), z.string()).optional(),
      reason,
    },
  },
  list_connectors: {
    tier: 'read',
    description:
      "List connectors (remote MCP services in Mochi's library): each account with its service, its name (agents pick it by this), whether it's signed in and whether the profile has it; and the directory of services you can connect with connect_account. A service with needsOwnApp signs in through an app of the user's own: do its setup steps yourself in your browser tab (browser_open, browser_snapshot, browser_click), then connect_account with the Client ID and secretRef. Ask the user in chat only for what you can't decide or clear yourself (signing in to a site, 2-step verification, which workspace or account); don't end your turn until the account is signed in or you've hit a blocker, which you report.",
    shape: { profileId },
  },
  connect_account: {
    tier: 'change',
    description:
      "Connect an account on a service (a directory id from list_connectors, or a remote MCP server's https URL) and open its sign-in page in a new tab of your browser, returned here: approve it there yourself, then call list_connectors until the account isSignedIn. With the user's own app, pass its Client ID and secretRef: Mochi reads the secret from the page itself and keeps it in the keychain; you never see it. New threads in the profile get the account's tools.",
    shape: {
      connector: z.string().min(1).describe('A directory id from list_connectors, or an https MCP server URL'),
      alias: z.string().regex(/^[a-z0-9-]{1,32}$/).optional().describe('The account name, like work or personal; defaults to the first free one'),
      clientId: z.string().min(1).max(200).optional().describe("The Client ID of the user's own app, from the service's setup steps"),
      secretRef: z.string().optional().describe("The ref of the Client Secret on the page, or of its Copy button, from your latest browser_snapshot. Never the secret itself"),
      fromSetup: z.boolean().optional().describe("Slack and Google Workspace: use what your last run_setup captured (an existing app's credentials, a token Mochi makes the app from, or Google's new client)"),
      configTokenRef: z.string().optional().describe("Slack only: the ref of a generated app configuration token's Access Token on api.slack.com/apps, or of its Copy button. Mochi creates the app from it, MCP on; no Client ID needed"),
      tabId,
      profileId,
    },
  },
  run_setup: {
    tier: 'change',
    description:
      "Run a service's setup recipe in your browser tab in seconds: Mochi does the known steps itself (for Slack: generates an app configuration token and keeps it, never showing it to you). Its result's next says what to do: connect_account with fromSetup when done; ask the user and pass params when it needs a value; do a step yourself and fix it with update_setup_step when a page changed.",
    shape: {
      connector: z.string().min(1).describe('A directory id with a recipe, like slack'),
      params: z.record(z.string(), z.string()).optional().describe('Answers to what an earlier run asked, like { "workspace": "Acme" }'),
      fromStep: z.string().optional().describe('Resume from this step id, after doing earlier steps yourself'),
      tabId,
    },
  },
  update_setup_step: {
    tier: 'change',
    description:
      "Fix one step of a service's setup recipe for this user after its element changed: the ARIA role and accessible name of the element that worked when you did the step yourself (from browser_snapshot). Only the element changes; the step's kind, URLs and allowed sites never do. The change shows in your thread.",
    shape: {
      connector: z.string().min(1),
      stepId: z.string().min(1).describe('The step id a run stopped at'),
      target: z
        .object({ role: z.string(), name: z.string(), exact: z.boolean().optional(), within: z.object({ role: z.string(), name: z.string(), exact: z.boolean().optional() }).optional() })
        .describe('The element: role like button, name its accessible name; within an enclosing element like a row'),
    },
  },
  remove_mcp_server: {
    tier: 'destructive',
    description: "Remove an MCP server from a profile's account config. The user approves on a delete card showing the file diff; the file is backed up first.",
    shape: { profileId, provider: configProvider, name: z.string().min(1) },
  },
  remove_profile: {
    tier: 'destructive',
    description: "Remove a profile from Mochi. Refused for the last profile and for any profile that still has threads (so never your own). Its accounts and browser data stay on disk.",
    shape: { profileId: z.string().describe('A profile id from list_profiles') },
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
