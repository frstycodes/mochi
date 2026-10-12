import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Page } from '../browser/pages.ts';
import type { BrowserAct } from '../host/types/browser.ts';
import { singleLayout } from '../layout/tree.ts';
import type { AgentControl } from '../settings/prefs.ts';
import type { Action, State } from '../store/index.tsx';
import { layoutReducer } from '../store/layout.ts';
import { panesReducer } from '../store/panes.ts';
import { initialQueue, queueReducer } from '../store/queue.ts';
import { sidechatReducer } from '../store/sidechat.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { decideTool, runTool, type ToolEnv } from './tools.ts';
import { TOOL_NAMES, type ToolName } from './toolTable.ts';
import type { ToolUndo } from './undo.ts';
import { applyUndo } from './undo.ts';

const SLICES = [threadsReducer, queueReducer, panesReducer, layoutReducer, sidechatReducer];
const reduce = (s: State, a: Action): State => (a.type === 'tool-undo' ? applyUndo(s, a.undo).state : SLICES.reduce((x, r) => r(x, a), s));

/** The demo profile "latitude", you looking at "rl" (Claude), with "rl"'s pane holding one browser tab. */
function setup({ control = 'everything' as AgentControl, url = 'http://localhost:5173/' } = {}) {
  const view = { kind: 'thread', id: 'rl' } as const;
  let state = {
    ...initialThreads(undefined, true),
    ...initialQueue(undefined, false),
    panes: [{ threadId: 'rl', isOpen: true, tabs: [{ id: 'tab-1', kind: 'browser', url }], activeTab: 'tab-1' }],
    spaceId: 'latitude',
    views: { latitude: view },
    layouts: { latitude: singleLayout(view) },
    orientation: 'row',
    watched: [],
    sidechats: {},
  } as unknown as State;
  const toasts: { text: string; undo?: ToolUndo }[] = [];
  const notices: string[] = [];
  const acts: BrowserAct[] = [];
  const commands: string[] = [];
  const removed: string[] = [];
  const pages = new Map<string, Page>([['rl/tab-1', { hostId: `view-${++nextView}`, url, title: 'Dev', isLoading: false, canGoBack: true, canGoForward: false, error: null } as Page]]);
  let control_ = control;
  const env: ToolEnv = {
    getState: () => state,
    dispatch: (a) => void (state = reduce(state, a)),
    agentControl: () => control_,
    toast: (text, undo) => void toasts.push({ text, undo }),
    notify: (title) => void notices.push(title),
    removeWorktree: async (id) => void removed.push(id),
    pages: { get: (k) => pages.get(k), update: (k, patch) => void pages.set(k, { ...(pages.get(k) as Page), ...patch }) },
    browser: {
      navigate: async (_id, to) => void pages.set('rl/tab-1', { ...pages.get('rl/tab-1')!, url: to }),
      command: async (_id, c) => void commands.push(c),
      capture: async () => 'data:image/png;base64,iVBORw0KGgo=',
      snapshot: async () => ({
        text: '- heading "Dev" [level=1]\n- button "Save" [ref=e1]\n- textbox "Email" [ref=e2]',
        refs: { e1: { role: 'button', name: 'Save', isSubmit: true, isPassword: false }, e2: { role: 'textbox', name: 'Email', isSubmit: false, isPassword: false } },
      }),
      act: async (_id, a) => (acts.push(a), a.kind === 'scroll' ? { note: 'Scrolled to 0, 600 of 2000' } : {}),
      logs: async () => [{ level: 'error', message: 'boom', source: 'http://localhost:5173/main.js', line: 3 }],
    },
    isDesktop: true,
  };
  const call = (name: string, args: Record<string, unknown> = {}, threadId = 'rl') => runTool({ id: 'c1', threadId, name, args }, env);
  const ok = async (name: string, args?: Record<string, unknown>, threadId?: string) => {
    const r = await call(name, args, threadId);
    assert.ok(!r.isError, `${name} failed: ${r.text}`);
    const parsed = JSON.parse(r.text);
    return Array.isArray(parsed) ? parsed : { ...parsed, image: r.image };
  };
  const err = async (name: string, args?: Record<string, unknown>, threadId?: string) => {
    const r = await call(name, args, threadId);
    assert.equal(r.isError, true, `${name} should fail`);
    return r.text;
  };
  const thread = (id: string) => state.threads.find((t) => t.id === id)!;
  const card = () => state.queue.find((q) => q.tool)!;
  return { env, call, ok, err, thread, card, state: () => state, toasts, notices, acts, commands, removed, pages, setControl: (c: AgentControl) => void (control_ = c) };
}

let nextView = 0;

const lastLog = (t: { activity: { text: string }[] }) => t.activity.at(-1)!.text;

// {TIERS}

test('every tool in the table has a handler', async () => {
  const { call } = setup();
  for (const name of TOOL_NAMES) assert.doesNotMatch((await call(name, { __probe: true })).text, /No Mochi tool/, name);
});

test('a consequential tool never runs without approval: Deny leaves everything as it was', async () => {
  const t = setup();
  const pending = t.call('delete_thread', { threadIds: ['e2e'] });
  assert.ok(t.thread('e2e'), 'nothing happens while the card waits');
  assert.match(t.card().title, /Delete "Fix flaky checkout e2e"\?|Delete ".*"\?/);
  assert.match(t.card().detail, /can't be undone/);
  decideTool(t.card().tool!.callId, { isApproved: false });
  const r = await pending;
  assert.equal(r.isError, true);
  assert.match(r.text, /denied/);
  assert.ok(t.thread('e2e'), 'denied: the thread stays');
  assert.equal(t.state().queue.some((q) => q.tool), false, 'the card is gone');
  assert.match(lastLog(t.thread('rl')), /^Denied: Delete/);
});

test('read only blocks every write and shows the setting in the thread', async () => {
  const t = setup({ control: 'read' });
  const before = t.state().threads;
  assert.match(await t.err('settle_thread', { threadIds: ['adm'] }), /Read only/);
  assert.match(await t.err('browser_click', { ref: 'e1' }), /Read only/);
  assert.match(await t.err('delete_thread', { threadIds: ['e2e'] }), /Read only/);
  assert.equal(t.state().threads, before, 'no thread changed');
  const card = t.state().queue.find((q) => q.kind === 'setting')!;
  assert.deepEqual(card.setting, { id: 'agentControl', suggested: 'everything' });
  assert.ok((await t.ok('list_threads')).length > 0, 'reads still work');
});

test('reversible (the default) runs undoable changes but blocks consequential ones without asking', async () => {
  const t = setup({ control: 'reversible' });
  await t.ok('rename_thread', { threadId: 'adm', title: 'Admin usage page' });
  assert.match(await t.err('create_thread', { prompt: 'x' }), /Everything, with confirmation/);
  assert.equal(t.state().queue.some((q) => q.tool), false, 'no card was shown');
});

test('reversible calls log in the caller, toast with Undo, and Undo puts back only what still holds the result', async () => {
  const t = setup();
  const r = await t.ok('settle_thread', { threadIds: ['adm', 'e2e'] });
  assert.equal(r.changed, 'Settled 2 threads');
  assert.equal(lastLog(t.thread('rl')), 'Claude settled 2 threads');
  assert.equal(t.toasts.at(-1)!.text, 'Claude settled 2 threads');
  t.env.dispatch({ type: 'rename', threadId: 'e2e', title: 'Renamed since' });
  t.env.dispatch({ type: 'tool-undo', undo: t.toasts.at(-1)!.undo! });
  assert.equal(t.thread('adm').status, 'running');
  assert.equal(t.thread('e2e').title, 'Renamed since', 'a later change survives the undo');
});

test('quiet tools log but never toast', async () => {
  const t = setup();
  const step = t.thread('rl').steps.find((s) => s.status === 'ready')!;
  await t.ok('set_step_status', { stepId: step.id, status: 'running' });
  assert.equal(t.toasts.length, 0);
  assert.equal(lastLog(t.thread('rl')), `Claude marked "${step.title}" running`);
});

test('another profile is out of reach and bad args are errors, not throws', async () => {
  const t = setup();
  assert.match(await t.err('get_thread', { threadId: 'lobby' }), /No thread lobby in this profile/);
  assert.match(await t.err('rename_thread', { title: 42 }), /title/);
  assert.match(await t.err('rm_rf'), /No Mochi tool/);
  assert.match(await t.err('get_goal', {}, 'ghost'), /No thread ghost/);
});

// {THREADS}

test('list_threads filters by status, pinned and project inside the profile', async () => {
  const t = setup();
  assert.deepEqual((await t.ok('list_threads')).map((x: { id: string }) => x.id), ['rl', 'adm', 'e2e', 'auth', 'onb', 'viz']);
  assert.deepEqual((await t.ok('list_threads', { status: 'settled' })).map((x: { id: string }) => x.id), ['onb', 'viz']);
  assert.deepEqual((await t.ok('list_threads', { pinned: true })).map((x: { id: string }) => x.id), ['rl', 'adm', 'auth']);
  assert.equal((await t.ok('list_threads', { project: 'nope' })).length, 0);
});

test('get_thread returns goal, steps, last activity, PRs and what waits on you', async () => {
  const r = await setup().ok('get_thread', { threadId: 'e2e' });
  assert.equal(r.id, 'e2e');
  assert.ok(r.steps.length && r.lastActivity.length <= 5 && Array.isArray(r.pullRequests) && Array.isArray(r.waitingOnUser));
});

test('rename_thread renames and says from what', async () => {
  const t = setup();
  const r = await t.ok('rename_thread', { threadId: 'adm', title: '  Usage page  ' });
  assert.equal(t.thread('adm').title, 'Usage page');
  assert.match(r.changed, /^Renamed ".*" to "Usage page"$/);
});

test('settle_thread refuses your own thread', async () => {
  assert.match(await setup().err('settle_thread', { threadIds: ['rl'] }), /your own thread/);
});

test('reactivate_thread brings settled threads back', async () => {
  const t = setup();
  await t.ok('reactivate_thread', { threadIds: ['onb'] });
  assert.notEqual(t.thread('onb').status, 'settled');
  assert.match(await t.err('reactivate_thread', { threadIds: ['adm'] }), /None of those threads is settled/);
});

test('pin_thread pins in order and refuses past five', async () => {
  const t = setup();
  await t.ok('pin_thread', { threadIds: ['e2e'] });
  assert.equal(t.thread('e2e').orbitSlot, 5);
  await t.ok('reactivate_thread', { threadIds: ['onb', 'viz'] });
  await t.ok('pin_thread', { threadIds: ['onb'] });
  assert.match(await t.err('pin_thread', { threadIds: ['viz'] }), /Only 5/);
});

test('unpin_thread moves threads to the top of Threads', async () => {
  const t = setup();
  const r = await t.ok('unpin_thread', { threadIds: ['adm'] });
  assert.deepEqual(r.pinned, ['rl', 'auth']);
  assert.equal(t.thread('adm').orbitSlot, undefined);
});

test('reorder_threads moves one next to another, pinning across the boundary, or sets the pinned order', async () => {
  const t = setup();
  let r = await t.ok('reorder_threads', { threadId: 'e2e', before: 'adm' });
  assert.deepEqual(r.pinned, ['rl', 'e2e', 'adm', 'auth']);
  r = await t.ok('reorder_threads', { pinnedOrder: ['auth', 'rl'] });
  assert.deepEqual(r.pinned, ['auth', 'rl']);
  assert.ok(r.unpinned.includes('adm') && r.unpinned.includes('e2e'));
  assert.match(await t.err('reorder_threads', { threadId: 'adm' }), /before or after/);
});

test('watch_thread toggles only when needed', async () => {
  const t = setup();
  await t.ok('watch_thread', { threadId: 'adm', watch: true });
  await t.ok('watch_thread', { threadId: 'adm', watch: true });
  assert.deepEqual(t.state().watched, ['adm']);
  await t.ok('watch_thread', { threadId: 'adm', watch: false });
  assert.deepEqual(t.state().watched, []);
});

test('create_thread asks, then creates in the same project without moving your view', async () => {
  const t = setup();
  const pending = t.call('create_thread', { prompt: 'Add a rate limit dashboard', provider: 'codex' });
  assert.match(t.card().title, /Start a new Codex thread/);
  decideTool(t.card().tool!.callId, { isApproved: true });
  const r = JSON.parse((await pending).text);
  const created = t.thread(r.id);
  assert.deepEqual([created.goal, created.providers[0], created.repo?.project], ['Add a rate limit dashboard', 'codex', 'latitude']);
  assert.deepEqual(t.state().views, { latitude: { kind: 'thread', id: 'rl' } });
});

test('send_to_thread asks, then sends into the other thread as a message from this one', async () => {
  const t = setup();
  const pending = t.call('send_to_thread', { threadId: 'adm', text: 'Use the new limits table' });
  assert.match(t.card().detail, /Use the new limits table/);
  decideTool(t.card().tool!.callId, { isApproved: true });
  await pending;
  assert.ok(t.thread('adm').activity.some((a) => a.kind === 'message' && a.text.includes('Use the new limits table')));
});

test('delete_thread with approval removes the thread everywhere, and the worktree only when ticked', async () => {
  const t = setup();
  t.env.dispatch({ type: 'watch-toggle', threadId: 'e2e' });
  const pending = t.call('delete_thread', { threadIds: ['e2e'] });
  assert.deepEqual(t.card().tool!.options?.map((o) => o.id), ['removeWorktree']);
  decideTool(t.card().tool!.callId, { isApproved: true, options: ['removeWorktree'] });
  const r = JSON.parse((await pending).text);
  assert.equal(t.state().threads.some((x) => x.id === 'e2e'), false);
  assert.equal(t.state().queue.some((q) => q.threadId === 'e2e'), false);
  assert.deepEqual(t.state().watched, []);
  assert.deepEqual(t.removed, ['e2e']);
  assert.equal(r.worktreesRemoved, 1);
  const again = t.call('delete_thread', { threadIds: ['adm'] });
  decideTool(t.card().tool!.callId, { isApproved: true });
  await again;
  assert.deepEqual(t.removed, ['e2e'], 'unticked: the worktree stays');
});

// {GOALS}

test('get_goal returns step ids', async () => {
  const r = await setup().ok('get_goal');
  assert.equal(r.threadId, 'rl');
  assert.ok(r.steps.some((s: { id: string }) => s.id === 'rl5'));
});

test('set_step_status sets the status as the agent and rejects unknown steps', async () => {
  const t = setup();
  await t.ok('set_step_status', { stepId: 'rl5', status: 'done' });
  assert.equal(t.thread('rl').steps.find((s) => s.id === 'rl5')!.status, 'done');
  assert.match(await t.err('set_step_status', { stepId: 'nope', status: 'done' }), /No step nope/);
});

test('add_step lands as a goal revision by the agent', async () => {
  const t = setup();
  const before = t.thread('rl').revisions.length;
  await t.ok('add_step', { title: 'Document the limits', size: 2 });
  const added = t.thread('rl').steps.find((s) => s.title === 'Document the limits')!;
  assert.deepEqual([added.size, added.addedBy, t.thread('rl').revisions.length], [2, 'claude', before + 1]);
});

test('edit_goal changes the goal text and criteria as one revision', async () => {
  const t = setup();
  const before = t.thread('rl').revisions.length;
  await t.ok('edit_goal', { goal: 'Rate limits on every public route', criteria: [{ stepId: 'rl6', text: 'Returns 429', command: 'pnpm test' }] });
  assert.equal(t.thread('rl').goal, 'Rate limits on every public route');
  assert.deepEqual(t.thread('rl').steps.find((s) => s.id === 'rl6')!.acceptance, { text: 'Returns 429', command: 'pnpm test' });
  assert.equal(t.thread('rl').revisions.length, before + 1);
  assert.match(await t.err('edit_goal', { goal: 'Rate limits on every public route' }), /Nothing changed/);
});

test('reorder_steps puts listed steps first', async () => {
  const t = setup();
  await t.ok('reorder_steps', { order: ['rl9', 'rl8'] });
  const open = t.thread('rl').steps.filter((s) => s.status === 'ready').map((s) => s.id);
  assert.deepEqual(open.slice(0, 2), ['rl9', 'rl8']);
});

test('drop_step drops an open step and refuses a done one', async () => {
  const t = setup();
  await t.ok('drop_step', { stepId: 'rl9', reason: 'out of scope' });
  assert.equal(t.thread('rl').steps.find((s) => s.id === 'rl9')!.status, 'dropped');
  assert.match(await t.err('drop_step', { stepId: 'rl1' }), /done steps stay/);
});

test('settle_goal drops the open steps and settles the thread', async () => {
  const t = setup();
  await t.ok('settle_goal', { threadId: 'adm', reason: 'Shipped elsewhere' });
  assert.equal(t.thread('adm').status, 'settled');
  assert.ok(t.thread('adm').steps.filter((s) => s.id !== 'ad1').every((s) => s.status === 'dropped'));
});

// {LAYOUT}

test('open_pane_tab opens the kind asked for', async () => {
  const t = setup();
  await t.ok('open_pane_tab', { kind: 'terminal' });
  assert.ok(t.state().panes.find((p) => p.threadId === 'rl')!.tabs.some((x) => x.kind === 'terminal'));
});

test('focus_thread moves you to the thread', async () => {
  const t = setup();
  await t.ok('focus_thread', { threadId: 'adm' });
  assert.deepEqual(t.state().views.latitude, { kind: 'thread', id: 'adm' });
});

test('split_with opens a split', async () => {
  const t = setup();
  await t.ok('split_with', { threadId: 'adm' });
  assert.equal(t.state().layouts.latitude.root.kind, 'split');
});

test('close_pane closes an open pane only', async () => {
  const t = setup();
  await t.ok('close_pane');
  assert.equal(t.state().panes.find((p) => p.threadId === 'rl')!.isOpen, false);
  assert.match((await t.ok('close_pane')).note, /already closed/);
});

test('show_file opens the file viewer at a line and stays inside the project', async () => {
  const t = setup();
  await t.ok('show_file', { path: 'src/limits.ts', line: 12 });
  assert.deepEqual(t.state().panes.find((p) => p.threadId === 'rl')!.tabs.at(-1)!.file, { path: 'src/limits.ts', line: 12 });
  assert.match(await t.err('show_file', { path: '../secrets' }), /inside the project/);
});

test('open_changes opens the Changes tab', async () => {
  const t = setup();
  await t.ok('open_changes');
  assert.ok(t.state().panes.find((p) => p.threadId === 'rl')!.tabs.some((x) => x.kind === 'changes'));
});

// {USER}

test('ask_side_chat opens the side chat with the question pending', async () => {
  const t = setup();
  await t.ok('ask_side_chat', { question: 'What does this diff change?' });
  assert.ok(t.state().panes.find((p) => p.threadId === 'rl')!.tabs.some((x) => x.kind === 'sidechat'));
  assert.equal(Object.values(t.state().sidechats.rl ?? {})[0]?.pending, 'What does this diff change?');
});

test('notify_user notifies once a minute per thread', async () => {
  const t = setup();
  let now = 1_000_000;
  t.env.now = () => now;
  await t.ok('notify_user', { title: 'Tests are red', reason: 'CI failed on main' });
  assert.match(await t.err('notify_user', { title: 'Again', reason: 'x' }), /One notification per minute/);
  now += 61_000;
  await t.ok('notify_user', { title: 'Green', reason: 'Fixed' });
  assert.deepEqual(t.notices, ['Tests are red', 'Green']);
});

test('show_setting puts a setting card in the thread', async () => {
  const t = setup();
  await t.ok('show_setting', { settingId: 'diffStyle', reason: 'Split diffs read better for this refactor', suggested: 'split' });
  const card = t.state().queue.find((q) => q.kind === 'setting')!;
  assert.deepEqual([card.threadId, card.title, card.setting], ['rl', 'Split diffs read better for this refactor', { id: 'diffStyle', suggested: 'split' }]);
});

// {BROWSER}

test('browser_tabs lists only the caller’s browser tabs', async () => {
  const t = setup();
  assert.deepEqual(await t.ok('browser_tabs'), [{ tabId: 'tab-1', url: 'http://localhost:5173/', title: 'Dev', isLoading: false, isActive: true }]);
  assert.deepEqual(await t.ok('browser_tabs', {}, 'adm'), [], 'adm has no tabs in this setup');
});

test('browser_open navigates the active tab; a non-local origin is logged and toasted', async () => {
  const t = setup();
  const r = await t.ok('browser_open', { url: 'localhost:5173/settings' });
  assert.equal(r.url, 'http://localhost:5173/settings');
  assert.equal(t.toasts.length, 0, 'local: no toast');
  const out = await t.ok('browser_open', { url: 'example.com' });
  assert.match(out.changed, /outside your machine/);
  assert.match(t.toasts.at(-1)!.text, /opened example.com/);
});

test('browser tools fail with a fix when the thread is off screen', async () => {
  const t = setup();
  t.env.dispatch({ type: 'go', view: { kind: 'thread', id: 'adm' } });
  assert.match(await t.err('browser_snapshot'), /focus_thread/);
});

test('browser_snapshot returns the tree with refs', async () => {
  const r = await setup().ok('browser_snapshot');
  assert.match(r.snapshot, /button "Save" \[ref=e1\]/);
});

test('browser_click needs a snapshot ref, and clicks locally without asking', async () => {
  const t = setup();
  assert.match(await t.err('browser_click', { ref: 'e1' }), /browser_snapshot first/);
  await t.ok('browser_snapshot');
  await t.ok('browser_click', { ref: 'e1' });
  assert.deepEqual(t.acts, [{ kind: 'click', ref: 'e1' }]);
});

test('browser_click on a submit button on a non-local origin asks first', async () => {
  const t = setup({ url: 'https://shop.example.com/' });
  await t.ok('browser_snapshot');
  const pending = t.call('browser_click', { ref: 'e1' });
  await new Promise((r) => setTimeout(r, 0));
  assert.match(t.card().title, /Submit a form on shop.example.com/);
  assert.deepEqual(t.acts, [], 'nothing clicked yet');
  decideTool(t.card().tool!.callId, { isApproved: true });
  await pending;
  assert.deepEqual(t.acts, [{ kind: 'click', ref: 'e1' }]);
});

test('browser_type types locally, asks on other origins, and is blocked there under Reversible', async () => {
  const t = setup();
  await t.ok('browser_snapshot');
  await t.ok('browser_type', { ref: 'e2', text: 'me@example.com', submit: true });
  assert.deepEqual(t.acts, [{ kind: 'type', ref: 'e2', text: 'me@example.com' }, { kind: 'press', key: 'Enter' }]);
  const remote = setup({ url: 'https://example.com/', control: 'reversible' });
  await remote.ok('browser_snapshot');
  assert.match(await remote.err('browser_type', { ref: 'e2', text: 'x' }), /Everything, with confirmation/);
  assert.deepEqual(remote.acts, []);
});

test('browser_press sends the key', async () => {
  const t = setup();
  await t.ok('browser_press', { key: 'Escape' });
  assert.deepEqual(t.acts, [{ kind: 'press', key: 'Escape' }]);
});

test('browser_scroll scrolls 600px down by default and reports where', async () => {
  const t = setup();
  const r = await t.ok('browser_scroll');
  assert.deepEqual(t.acts, [{ kind: 'scroll', ref: undefined, dx: 0, dy: 600 }]);
  assert.match(r.note, /Scrolled to/);
});

test('browser_screenshot returns an image', async () => {
  const r = await setup().ok('browser_screenshot');
  assert.deepEqual(r.image, { data: 'iVBORw0KGgo=', mimeType: 'image/png' });
});

test('browser_console returns recent logs', async () => {
  const r = await setup().ok('browser_console');
  assert.deepEqual(r.console, ['error: boom (localhost:5173/main.js:3)']);
});

test('browser_back, browser_forward and browser_reload run their command, and say when there is no history', async () => {
  const t = setup();
  await t.ok('browser_back');
  await t.ok('browser_reload');
  assert.match(await t.err('browser_forward'), /Nothing to go forward/);
  assert.deepEqual(t.commands, ['back', 'reload']);
});

test('browser_set_device sets a preset and rejects unknown ones', async () => {
  const t = setup();
  await t.ok('browser_set_device', { device: 'iphone-16', rotated: true });
  assert.deepEqual([t.pages.get('rl/tab-1')!.device, t.pages.get('rl/tab-1')!.isRotated], ['iphone-16', true]);
  assert.match(await t.err('browser_set_device', { device: 'nokia' }), /No device nokia/);
});

test('names in the table are verb_noun', () => {
  for (const name of TOOL_NAMES) assert.match(name, /^[a-z]+(_[a-z]+)+$/, name satisfies ToolName);
});
