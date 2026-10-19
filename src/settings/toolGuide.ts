import type { ToolName } from '../runtime/toolTable.ts';

/** Settings › Mochi access shows tools in these groups, in this order. */
export const TOOL_GROUPS = ['Threads', 'Goals and progress', 'Background agents', 'Reading the browser', 'Using the browser', 'Your screen', 'Reaching you', 'Settings and profiles'] as const;

export type ToolGroup = (typeof TOOL_GROUPS)[number];

/**
 * Every Mochi tool as you read it in Settings: its group, a name in words, and what it lets an agent do. The table's own
 * descriptions are written for the agent; these are written for you.
 */
export const TOOL_GUIDE = {
  list_threads: { group: 'Threads', label: 'List threads', description: 'See the threads in this profile: titles, status, project and which are pinned.' },
  get_thread: { group: 'Threads', label: 'Read a thread', description: "See one thread's goal, its agent's plan, recent activity, pull requests and what it's waiting on you for." },
  rename_thread: { group: 'Threads', label: 'Rename threads', description: 'Give a thread a new title. You get an Undo toast.' },
  settle_thread: { group: 'Threads', label: 'Settle threads', description: 'Move finished or abandoned threads out of the active list and stop their agents. Never its own thread.' },
  reactivate_thread: { group: 'Threads', label: 'Reactivate threads', description: 'Bring settled threads back to the active list.' },
  pin_thread: { group: 'Threads', label: 'Pin threads', description: 'Pin threads to the top of the sidebar, up to 5 per profile.' },
  unpin_thread: { group: 'Threads', label: 'Unpin threads', description: 'Move pinned threads back into the regular list.' },
  reorder_threads: { group: 'Threads', label: 'Reorder the sidebar', description: 'Move threads up or down in the sidebar, or set the order of the pinned ones.' },
  watch_thread: { group: 'Threads', label: 'Watch threads', description: "Start or stop watching a thread, so its events toast for you." },
  create_thread: { group: 'Threads', label: 'Start threads', description: 'Start a new thread in the same project with its own agent working on a prompt. You stay where you are and can undo it.' },
  send_to_thread: { group: 'Threads', label: 'Message other threads', description: "Send a message to another thread's agent, as if you typed it in that thread." },
  delete_thread: { group: 'Threads', label: 'Delete threads', description: 'Delete threads for good: stops their agents and removes their history, and optionally their worktrees.' },

  get_goal: { group: 'Goals and progress', label: 'Read goals', description: "See a thread's goal and what done means, with each criterion's claim and check." },
  open_pr: { group: 'Goals and progress', label: 'Open pull requests', description: 'Push its branch and open the pull request, with the description written from the goal and its report.' },
  propose_goal: { group: 'Goals and progress', label: 'Propose goals', description: 'Propose a thread’s goal and its criteria after a first look at the code, and again when what done means changes. How it lands is under Goals and checks.' },
  claim_criterion: { group: 'Goals and progress', label: 'Claim criteria', description: 'Say a criterion is met, with evidence you can check. Mochi still checks it itself.' },
  report_turn: { group: 'Goals and progress', label: 'Report turns', description: 'Sum up a turn for you: what changed, decisions made, what’s left, at most one question, and the next move to offer you.' },
  get_report: { group: 'Goals and progress', label: 'Read reports', description: "Read another thread's latest report, to coordinate without reading its transcript." },
  settle_goal: { group: 'Goals and progress', label: 'Close goals', description: "Close out a goal with a reason and settle its thread. Never its own thread." },

  start_background_agent: { group: 'Background agents', label: 'Start background agents', description: 'Start an agent that works alongside it, in the same worktree or a fresh one, on this profile’s account.' },
  list_background_agents: { group: 'Background agents', label: 'List background agents', description: 'See its background agents and subagents, their status, cost so far and results.' },
  stop_background_agent: { group: 'Background agents', label: 'Stop background agents', description: 'Stop one of its background agents. Partial work stays in the worktree.' },

  browser_tabs: { group: 'Reading the browser', label: 'List browser tabs', description: "See the thread's browser tabs: address, title and which is active." },
  browser_snapshot: { group: 'Reading the browser', label: 'Read pages', description: 'Read the page as text: headings, buttons, fields and links.' },
  browser_screenshot: { group: 'Reading the browser', label: 'Take screenshots', description: 'Capture the page as you see it, or the whole scrollable page.' },
  browser_console: { group: 'Reading the browser', label: 'Read the console', description: "Read the page's recent console messages." },
  browser_wait_for: { group: 'Reading the browser', label: 'Wait for pages', description: 'Wait until the page shows some text, an element or an address.' },

  browser_open: { group: 'Using the browser', label: 'Open pages', description: 'Open an address in the thread’s browser, in the current tab or a new one.' },
  browser_click: { group: 'Using the browser', label: 'Click', description: 'Click things on the page. Submitting a form on a site outside your machine still asks you.' },
  browser_type: { group: 'Using the browser', label: 'Type', description: 'Type into fields. On sites outside your machine, typing still asks you.' },
  browser_press: { group: 'Using the browser', label: 'Press keys', description: 'Press keys like Enter, Escape or the arrows in the page. Enter on a site outside your machine still asks you.' },
  browser_scroll: { group: 'Using the browser', label: 'Scroll', description: 'Scroll the page or an element.' },
  browser_hover: { group: 'Using the browser', label: 'Hover', description: 'Move the pointer over things, to open menus and tooltips.' },
  browser_select: { group: 'Using the browser', label: 'Pick options', description: 'Choose an option in a dropdown.' },
  browser_drag: { group: 'Using the browser', label: 'Drag', description: 'Drag one thing onto another: sortable lists, sliders, boards.' },
  browser_upload: { group: 'Using the browser', label: 'Upload files', description: 'Put a file into an upload field. Files from outside the thread’s worktree still ask you.' },
  browser_eval: { group: 'Using the browser', label: 'Run scripts', description: 'Run JavaScript in the page, where it can read the app’s state. On sites outside your machine it still asks you.' },
  browser_back: { group: 'Using the browser', label: 'Go back', description: 'Go back a page in a tab.' },
  browser_forward: { group: 'Using the browser', label: 'Go forward', description: 'Go forward a page in a tab.' },
  browser_reload: { group: 'Using the browser', label: 'Reload', description: 'Reload a tab.' },
  browser_dialog: { group: 'Using the browser', label: 'Answer page dialogs', description: 'Press OK or Cancel on an alert or confirm the page shows.' },
  browser_handoff: { group: 'Using the browser', label: 'Hand you the browser', description: 'Bring a tab to you for something only you can do, like signing in, then carry on once you’re done.' },
  browser_batch: { group: 'Using the browser', label: 'Run several steps at once', description: 'Run a few browser steps in one go. Each step still asks you wherever it would on its own.' },
  browser_set_device: { group: 'Using the browser', label: 'Change device size', description: 'Show the page at a phone, tablet or laptop size.' },

  open_pane_tab: { group: 'Your screen', label: 'Open pane tabs', description: "Open the preview, changes, terminal, files or side chat in a thread's side pane." },
  split_with: { group: 'Your screen', label: 'Open splits', description: 'Open a thread in a new split beside the one you’re looking at.' },
  close_pane: { group: 'Your screen', label: 'Close panes', description: "Close a thread's side pane. Its tabs are kept." },
  show_file: { group: 'Your screen', label: 'Show files', description: 'Open a file from the project in the side pane, at a line.' },
  open_changes: { group: 'Your screen', label: 'Show changes', description: "Open the thread's diff in the side pane." },

  ask_side_chat: { group: 'Reaching you', label: 'Ask the side chat', description: 'Open the side chat with a question for you, answered by a separate model. The agent doesn’t see the answer.' },
  notify_user: { group: 'Reaching you', label: 'Notify you', description: 'Send you a toast and a system notification for something that needs you now. At most once a minute per thread.' },

  get_settings: { group: 'Settings and profiles', label: 'Read settings', description: 'Read Mochi’s settings and their values. Secrets are never included.' },
  update_settings: { group: 'Settings and profiles', label: 'Suggest settings', description: 'Show settings in the thread with its suggested values. Only you change them.' },
  get_keybindings: { group: 'Settings and profiles', label: 'Read shortcuts', description: 'Read every keyboard shortcut and its default.' },
  set_keybinding: { group: 'Settings and profiles', label: 'Suggest shortcuts', description: 'Show a shortcut change in the thread. Only you apply it.' },
  list_profiles: { group: 'Settings and profiles', label: 'List profiles', description: 'See the profiles, their accounts and sign-in state, and their GitHub accounts.' },
  add_mcp_server: { group: 'Settings and profiles', label: 'Suggest MCP servers', description: 'Show an MCP server, filled in, for you to add to a profile. Never with secrets.' },
  list_connectors: { group: 'Settings and profiles', label: 'List connectors', description: 'See your connector accounts, whether each is signed in, and the services you can connect.' },
  connect_account: { group: 'Settings and profiles', label: 'Suggest connector accounts', description: 'Show a Connect button for a service, for you to sign in to in your browser.' },
  run_setup: { group: 'Settings and profiles', label: 'Run service setups', description: 'Run a service\'s known setup steps in its browser tab, like making a Slack token, keeping secrets from the agent.' },
  update_setup_step: { group: 'Settings and profiles', label: 'Fix setup steps', description: 'Point a setup step at the button that works now, after a site changed.' },
  remove_mcp_server: { group: 'Settings and profiles', label: 'Remove MCP servers', description: "Remove an MCP server from a profile's config, showing you the file change. The file is backed up first." },
  remove_profile: { group: 'Settings and profiles', label: 'Remove profiles', description: 'Remove an empty profile. Its accounts and browser data stay on disk.' },
} as const satisfies Record<ToolName, { group: ToolGroup; label: string; description: string }>;
