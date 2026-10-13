import { MOCHI_SERVER, type ToolName } from '../runtime/toolTable.ts';

/**
 * Each Mochi tool in words, like Claude's own tools: while it runs, then in its work-group row. What it changed is the
 * event line under it.
 */
export const MOCHI_CALLS = {
  list_threads: ['Looking through your threads', 'Looked through your threads'],
  get_thread: ['Reading a thread', 'Read a thread'],
  rename_thread: ['Renaming a thread', 'Renamed a thread'],
  settle_thread: ['Settling threads', 'Settled threads'],
  reactivate_thread: ['Bringing threads back', 'Brought threads back'],
  pin_thread: ['Pinning threads', 'Pinned threads'],
  unpin_thread: ['Unpinning threads', 'Unpinned threads'],
  reorder_threads: ['Reordering the sidebar', 'Reordered the sidebar'],
  watch_thread: ['Watching a thread', 'Watched a thread'],
  create_thread: ['Starting a new thread', 'Started a new thread'],
  send_to_thread: ['Messaging a thread', 'Messaged a thread'],
  delete_thread: ['Asking to delete a thread', 'Asked to delete a thread'],
  get_goal: ['Reading the goal', 'Read the goal'],
  set_step_status: ['Updating a step', 'Updated a step'],
  add_step: ['Adding a step', 'Added a step'],
  edit_goal: ['Editing the goal', 'Edited the goal'],
  reorder_steps: ['Reordering the steps', 'Reordered the steps'],
  drop_step: ['Dropping a step', 'Dropped a step'],
  open_pr: ['Opening a pull request', 'Opened a pull request'],
  claim_criterion: ['Checking off a criterion', 'Checked off a criterion'],
  report_turn: ['Reporting progress', 'Reported progress'],
  get_report: ['Reading the progress report', 'Read the progress report'],
  settle_goal: ['Settling the goal', 'Settled the goal'],
  start_background_agent: ['Starting a background agent', 'Started a background agent'],
  list_background_agents: ['Checking the background agents', 'Checked the background agents'],
  stop_background_agent: ['Stopping a background agent', 'Stopped a background agent'],
  browser_tabs: ['Looking at the browser tabs', 'Looked at the browser tabs'],
  browser_open: ['Opening a page', 'Opened a page'],
  browser_snapshot: ['Reading the page', 'Read the page'],
  browser_click: ['Clicking on the page', 'Clicked on the page'],
  browser_type: ['Typing on the page', 'Typed on the page'],
  browser_press: ['Pressing a key', 'Pressed a key'],
  browser_scroll: ['Scrolling the page', 'Scrolled the page'],
  browser_hover: ['Hovering on the page', 'Hovered on the page'],
  browser_select: ['Picking an option', 'Picked an option'],
  browser_drag: ['Dragging on the page', 'Dragged on the page'],
  browser_upload: ['Uploading a file', 'Uploaded a file'],
  browser_wait_for: ['Waiting for the page', 'Waited for the page'],
  browser_eval: ['Running a script on the page', 'Ran a script on the page'],
  browser_screenshot: ['Taking a screenshot', 'Took a screenshot'],
  browser_console: ['Reading the console', 'Read the console'],
  browser_back: ['Going back', 'Went back'],
  browser_forward: ['Going forward', 'Went forward'],
  browser_reload: ['Reloading the page', 'Reloaded the page'],
  browser_set_device: ['Changing the device size', 'Changed the device size'],
  open_pane_tab: ['Opening a side pane tab', 'Opened a side pane tab'],
  focus_thread: ['Switching to a thread', 'Switched to a thread'],
  split_with: ['Opening a split', 'Opened a split'],
  close_pane: ['Closing the side pane', 'Closed the side pane'],
  show_file: ['Showing you a file', 'Showed you a file'],
  open_changes: ['Opening the changes', 'Opened the changes'],
  ask_side_chat: ['Asking the side chat', 'Asked the side chat'],
  notify_user: ['Notifying you', 'Notified you'],
  get_settings: ['Reading your settings', 'Read your settings'],
  update_settings: ['Suggesting setting changes', 'Suggested setting changes'],
  list_profiles: ['Looking at your profiles', 'Looked at your profiles'],
  add_mcp_server: ['Suggesting an MCP server', 'Suggested an MCP server'],
  remove_mcp_server: ['Asking to remove an MCP server', 'Asked to remove an MCP server'],
  remove_profile: ['Asking to remove a profile', 'Asked to remove a profile'],
} satisfies Record<ToolName, [live: string, done: string]>;

/** A call's target (`mochi: rename_thread`) is Mochi's own. */
export const isMochiTarget = (target: string) => target.startsWith(`${MOCHI_SERVER}: `);

/** A Mochi call's words; undefined for another server's call, or a tool this build doesn't know (an older or newer Mochi's log). */
export function mochiCall(call: { verb: string; target: string }): [live: string, done: string] | undefined {
  if (call.verb !== 'Mcp' || !isMochiTarget(call.target)) return undefined;
  return (MOCHI_CALLS as Record<string, [string, string]>)[call.target.slice(MOCHI_SERVER.length + 2)];
}
