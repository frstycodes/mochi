import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Page } from '../browser/pages.ts';
import type { BrowserAct } from '../host/types/browser.ts';
import { singleLayout } from '../layout/tree.ts';
import type { AccountsState, ProviderConfig } from '../host/types/settings.ts';
import { DEFAULT_SPACES, type Provider, type Space } from '../model.ts';
import { DEFAULT_ACCOUNTS, linkedAccountId } from '../settings/accounts.ts';
import type { ConfigChange, McpEntry, SkillEntry } from '../settings/agentConfig.ts';
import { DEFAULT_PREFS, type AgentControl, type Prefs } from '../settings/prefs.ts';
import type { Action, State } from '../store/index.tsx';
import { layoutReducer } from '../store/layout.ts';
import { panesReducer } from '../store/panes.ts';
import { initialQueue, queueReducer } from '../store/queue.ts';
import { sidechatReducer } from '../store/sidechat.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { CLAUDE_FALLBACK_MODELS } from './models.ts';
import { decideTool, runTool, type ToolEnv } from './tools.ts';
import { asks, TOOL_NAMES, tierOf, type ToolName } from './toolTable.ts';
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
  const toasts: { text: string; undo?: () => void }[] = [];
  const notices: string[] = [];
  const acts: BrowserAct[] = [];
  const commands: string[] = [];
  const removed: string[] = [];
  const evals: string[] = [];
  const pages = new Map<string, Page>([['rl/tab-1', { hostId: `view-${++nextView}`, url, title: 'Dev', isLoading: false, canGoBack: true, canGoForward: false, error: null } as Page]]);
  let prefs: Prefs = { ...DEFAULT_PREFS, agentControl: control };
  let profiles: Space[] = [...DEFAULT_SPACES, { id: 'scratch', name: 'Scratch', icon: 'star', plans: { claude: '', codex: '' }, github: 'octo' }];
  const settings = fakeSettings();
  const env: ToolEnv = {
    getState: () => state,
    dispatch: (a) => void (state = reduce(state, a)),
    prefs: { get: () => prefs, set: (patch) => void (prefs = { ...prefs, ...patch }) },
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
      eval: async (_id, script) => (evals.push(script), script.includes('throw') ? Promise.reject(new Error('Error: nope\n    at <anonymous>:1:7')) : { value: '42', isTruncated: false }),
      waitFor: async (_id, until) => ({ isMet: until.text === 'Hello', waitedMs: 120 }),
    },
    cwdOf: () => '/repo/rl',
    models: async () => CLAUDE_FALLBACK_MODELS,
    profiles: {
      list: () => profiles,
      update: (id, patch) => void (profiles = profiles.map((p) => (p.id === id ? { ...p, ...patch } : p))),
      remove: (id) => void (profiles = profiles.filter((p) => p.id !== id)),
    },
    settings: settings.host,
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
  /** Starts an asking call and hands back its card once it's open (asks that preview first resolve a tick later). */
  const asking = async (name: string, args?: Record<string, unknown>) => {
    const queued = t.state().queue.length;
    const result = call(name, args);
    for (let i = 0; i < 20 && t.state().queue.length === queued; i++) await new Promise((r) => setTimeout(r, 0));
    return { result, card: t.state().queue.at(-1)! };
  };
  const t = { env, call, ok, err, asking, thread, card, state: () => state, prefs: () => prefs, profiles: () => profiles, settings, toasts, notices, acts, commands, removed, evals, pages };
  return t;
}

/**
 * `host.settings` for the profile tools, over in-memory config files: preview shows each change as one file edit, apply
 * refuses when a file moved since its preview (main's stale check). Any credential method throws.
 */
function fakeSettings() {
  const calls: string[] = [];
  const files = new Map<string, string>();
  const accounts: AccountsState = { accounts: [...DEFAULT_ACCOUNTS, { id: 'claude-work', provider: 'claude', name: 'Work', configDir: '/acct/claude-work' }], links: { personal: { claude: 'claude-work' } } };
  const config = {
    claude: {
      instructions: 'Be brief.\nAPI_TOKEN=sk-live-abcdefghijklmnop\n',
      servers: [
        { def: { name: 'github', type: 'stdio', command: 'npx', args: ['gh-mcp', '--token', 'ghp_abcdefghijklmnopqrstuvwxyz'], env: { GITHUB_TOKEN: 'ghp_ZYXWVUTSRQPONMLKJIHGFEDCBA' } }, enabled: true, scope: 'user', needs: [] },
        { def: { name: 'linear', type: 'http', url: 'https://mcp.linear.app/mcp', headers: { Authorization: 'Bearer ${LINEAR_TOKEN}' } }, enabled: false, scope: 'user', needs: ['LINEAR_TOKEN'] },
      ] as McpEntry[],
      skills: [{ name: 'review', description: 'Review a diff', dir: '/acct/skills/review', enabled: true }],
    },
    codex: { instructions: '', servers: [] as McpEntry[], skills: [] as SkillEntry[] },
  };
  const providerConfig = (spaceId: string, provider: Provider): ProviderConfig => ({
    provider,
    account: accounts.accounts.find((a) => a.id === linkedAccountId(accounts.links, spaceId, provider))!,
    instructions: { path: `/acct/${provider}/${provider === 'claude' ? 'CLAUDE.md' : 'AGENTS.md'}`, text: config[provider].instructions },
    mcpServers: config[provider].servers,
    skills: config[provider].skills,
    plugins: [],
    projectInstructions: null,
  });
  const pathOf = (c: ConfigChange) => `/acct/${c.provider}/${c.kind === 'instructions' ? 'instructions' : c.kind.startsWith('skill') ? 'settings.json' : '.claude.json'}`;
  const apply = (c: ConfigChange) => {
    const own = config[c.provider];
    if (c.kind === 'instructions') own.instructions = c.text;
    if (c.kind === 'mcp-set') own.servers = [...own.servers, { def: c.server, enabled: true, scope: 'user', needs: [] }];
    if (c.kind === 'mcp-remove') own.servers = own.servers.filter((s) => s.def.name !== c.name);
    if (c.kind === 'mcp-enabled') own.servers = own.servers.map((s) => (s.def.name === c.name ? { ...s, enabled: c.enabled } : s));
    if (c.kind === 'skill-enabled') own.skills = own.skills.map((s) => (s.name === c.name ? { ...s, enabled: c.enabled } : s));
  };
  const host: ToolEnv['settings'] = {
    accounts: async () => accounts,
    detect: async (accountId) => ({ provider: 'claude', accountId, path: '/bin/claude', version: '2.1', login: accountId === 'claude-work' ? { state: 'logged-in', method: 'Claude account', plan: 'Max' } : { state: 'logged-out' } }),
    linkAccount: async (spaceId, provider, id) => ((accounts.links[spaceId] = { ...accounts.links[spaceId], [provider]: id }), accounts),
    agentConfig: async (spaceId) => ({ claude: providerConfig(spaceId, 'claude'), codex: providerConfig(spaceId, 'codex') }),
    previewConfig: async (_spaceId, changes) => ({
      edits: changes.map((c) => ({ path: pathOf(c), before: files.get(pathOf(c)) ?? '', after: c.kind === 'instructions' ? c.text : JSON.stringify(c) })),
      copies: [],
      notes: [],
    }),
    applyConfig: async (_spaceId, changes, befores) => {
      if (changes.some((c) => (files.get(pathOf(c)) ?? '') !== befores[pathOf(c)])) throw new Error('A file changed since you reviewed it');
      for (const c of changes) {
        apply(c);
        files.set(pathOf(c), JSON.stringify(c));
      }
      return { backupDir: '/backups/1' };
    },
    testMcp: async () => ({ tools: ['search', 'open'] }),
  };
  const recorded = new Proxy(host, {
    get: (target, key: string) => {
      if (!(key in target)) throw new Error(`profile tools must not call settings.${key}`);
      calls.push(key);
      return target[key as keyof typeof target];
    },
  });
  return { host: recorded, calls, files, accounts, config };
}

let nextView = 0;

const lastLog = (t: { activity: { text: string }[] }) => t.activity.at(-1)!.text;

// {TIERS}

test('every tool in the table has a handler', async () => {
  const { call } = setup();
  for (const name of TOOL_NAMES) assert.doesNotMatch((await call(name, { __probe: true })).text, /No Mochi tool/, name);
});

test('only deletes and settings ask; everything else runs without a widget', () => {
  assert.deepEqual(TOOL_NAMES.filter((name) => asks(tierOf(name))), [
    'delete_thread',
    'update_setting',
    'update_profile',
    'link_account',
    'set_profile_instructions',
    'set_mcp_server_enabled',
    'add_mcp_server',
    'set_skill_enabled',
    'remove_mcp_server',
    'remove_profile',
  ]);
});

test('auto tools never wait: creating and messaging threads run straight through, no widget', async () => {
  const t = setup();
  const created = await t.ok('create_thread', { prompt: 'Add a rate limit dashboard' });
  await t.ok('send_to_thread', { threadId: 'adm', text: 'Use the new limits table' });
  await t.ok('rename_thread', { threadId: 'adm', title: 'Admin usage page' });
  assert.ok(t.thread(created.id));
  assert.equal(t.state().queue.some((q) => q.tool), false, 'no widget was shown');
});

test('create_thread takes a model and effort at or below the default, and refuses dearer ones unless the setting allows', async () => {
  const t = setup();
  t.env.dispatch({ type: 'controls', threadId: 'rl', controls: { model: 'claude-sonnet-5-5', effort: 'high', access: 'Auto' } });
  const cheaper = await t.ok('create_thread', { prompt: 'Rename a variable', model: 'claude-haiku-5-5', effort: 'low' });
  assert.deepEqual(t.thread(cheaper.id).controls, { model: 'claude-haiku-5-5', effort: 'low', access: 'Auto' });
  assert.match(await t.err('create_thread', { prompt: 'x', model: 'claude-opus-5-5' }), /claude-opus-5-5 costs more/);
  assert.match(await t.err('create_thread', { prompt: 'x', effort: 'max' }), /max effort costs more/);
  assert.match(await t.err('create_thread', { prompt: 'x', model: 'gpt-9' }), /isn't offered/);
  t.env.prefs.set({ threadModels: 'any' });
  await t.ok('create_thread', { prompt: 'x', model: 'claude-opus-5-5', effort: 'max' });
  t.env.prefs.set({ threadModels: 'default' });
  assert.match(await t.err('create_thread', { prompt: 'x', model: 'claude-haiku-5-5' }), /Always the default/);
  await t.ok('create_thread', { prompt: 'no choice still works' });
});

test('a delete always waits on its widget, and Cancel leaves everything as it was', async () => {
  const t = setup();
  let isSettled = false;
  const pending = t.call('delete_thread', { threadIds: ['e2e'] }).finally(() => (isSettled = true));
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(isSettled, false, 'still waiting');
  assert.ok(t.thread('e2e'), 'nothing happens while the widget waits');
  assert.match(t.card().title, /Delete "Fix flaky checkout e2e"\?/);
  assert.match(t.card().detail, /can't be undone/);
  assert.equal(t.card().tool!.isDestructive, true);
  decideTool(t.card().tool!.callId, { isApproved: false });
  const r = await pending;
  assert.equal(r.isError, true);
  assert.match(r.text, /denied/);
  assert.ok(t.thread('e2e'), 'cancelled: the thread stays');
  assert.equal(t.state().queue.some((q) => q.tool), false, 'the widget is gone');
  assert.deepEqual(t.thread('rl').activity.at(-1), { ...t.thread('rl').activity.at(-1), text: 'Kept "Fix flaky checkout e2e"', card: { id: t.thread('rl').activity.at(-1)!.card!.id, isOpen: false } });
});

test('the widget sits in the caller’s thread where it asked, and collapses to what happened', async () => {
  const t = setup();
  const pending = t.call('delete_thread', { threadIds: ['e2e'] });
  const entry = t.thread('rl').activity.at(-1)!;
  assert.deepEqual([entry.kind, entry.card], ['event', { id: t.card().id, isOpen: true }]);
  decideTool(t.card().tool!.callId, { isApproved: true });
  await pending;
  assert.equal(lastLog(t.thread('rl')), 'Deleted "Fix flaky checkout e2e"');
  assert.equal(t.thread('rl').activity.at(-1)!.card!.isOpen, false);
  assert.equal(t.toasts.length, 0, 'you just answered it; no toast on top');
});

test('a setting change always waits, shows current and proposed, and Apply or Keep closes it with a record', async () => {
  const t = setup();
  const pending = t.call('update_setting', { key: 'diffStyle', value: 'split', reason: 'Split diffs read better for this refactor' });
  assert.deepEqual(t.card().tool!.setting, { id: 'diffStyle', value: 'split' });
  assert.equal(t.card().detail, 'Split diffs read better for this refactor');
  assert.equal(t.prefs().diffStyle, 'unified', 'nothing changes while it waits');
  decideTool(t.card().tool!.callId, { isApproved: true });
  assert.equal(JSON.parse((await pending).text).changed, 'Set Diffs to Split');
  assert.equal(t.prefs().diffStyle, 'split');
  assert.equal(lastLog(t.thread('rl')), 'Set Diffs to Split');
  const kept = t.call('update_setting', { key: 'driftGuard', value: 'false', reason: 'Too many prompts' });
  decideTool(t.card().tool!.callId, { isApproved: false });
  assert.match((await kept).text, /denied/);
  assert.equal(t.prefs().driftGuard, true);
  assert.equal(lastLog(t.thread('rl')), 'Kept Drift guard: On');
});

test('update_setting validates the key and value before asking, and never touches agent control or permissions', async () => {
  const t = setup();
  assert.match(await t.err('update_setting', { key: 'diffStyle', value: 'sideways', reason: 'x' }), /allowed: unified, split/);
  assert.match(await t.err('update_setting', { key: 'diffStyle', value: 'unified', reason: 'x' }), /already Unified/);
  assert.match(await t.err('update_setting', { key: 'agentControl', value: 'everything', reason: 'x' }), /isn't a setting agents can change/);
  assert.match(await t.err('update_setting', { key: 'permissions', value: 'Full access', reason: 'x' }), /isn't a setting agents can change/);
  assert.equal(t.state().queue.length, 0, 'no widget for a bad call');
  const settings = await t.ok('get_settings');
  assert.ok(settings.some((x: { key: string; value: string }) => x.key === 'diffStyle' && x.value === 'unified'));
  assert.equal(settings.some((x: { key: string }) => x.key === 'agentControl' || x.key === 'permissions'), false);
});

test('read only blocks every write, settings included, and shows agent control in the thread once', async () => {
  const t = setup({ control: 'read' });
  const before = t.state().threads;
  assert.match(await t.err('settle_thread', { threadIds: ['adm'] }), /Read only/);
  assert.match(await t.err('browser_click', { ref: 'e1' }), /Read only/);
  assert.match(await t.err('update_setting', { key: 'diffStyle', value: 'split', reason: 'x' }), /Read only/);
  assert.match(await t.err('delete_thread', { threadIds: ['e2e'] }), /Read only/);
  assert.equal(t.state().threads.filter((x) => x.id !== 'rl').every((x, i) => x === before.filter((y) => y.id !== 'rl')[i]), true, 'no other thread changed');
  assert.equal(t.prefs().diffStyle, 'unified');
  const cards = t.state().queue.filter((q) => q.kind === 'setting');
  assert.equal(cards.length, 1, 'one widget, raised in place');
  assert.deepEqual(cards[0].setting, { id: 'agentControl', suggested: 'everything' });
  assert.equal(t.thread('rl').activity.filter((a) => a.card?.id === cards[0].id).length, 1);
  assert.ok((await t.ok('list_threads')).length > 0, 'reads still work');
});

test('changes runs everything that doesn’t ask, and blocks deletes and settings without showing their widget', async () => {
  const t = setup({ control: 'changes' });
  await t.ok('create_thread', { prompt: 'x' });
  assert.match(await t.err('delete_thread', { threadIds: ['e2e'] }), /Everything, asking before deletes and settings/);
  assert.match(await t.err('update_setting', { key: 'diffStyle', value: 'split', reason: 'x' }), /Everything/);
  assert.equal(t.state().queue.some((q) => q.tool), false, 'no tool widget was shown');
});

test('changes log in the caller, toast with Undo, and Undo puts back only what still holds the result', async () => {
  const t = setup();
  const r = await t.ok('settle_thread', { threadIds: ['adm', 'e2e'] });
  assert.equal(r.changed, 'Settled 2 threads');
  assert.equal(lastLog(t.thread('rl')), 'Claude settled 2 threads');
  assert.equal(t.toasts.at(-1)!.text, 'Claude settled 2 threads');
  t.env.dispatch({ type: 'rename', threadId: 'e2e', title: 'Renamed since' });
  t.toasts.at(-1)!.undo!();
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

test('create_thread creates in the same project without moving your view, and Undo removes it', async () => {
  const t = setup();
  const r = await t.ok('create_thread', { prompt: 'Add a rate limit dashboard', provider: 'codex' });
  const created = t.thread(r.id);
  assert.deepEqual([created.goal, created.providers[0], created.repo?.project], ['Add a rate limit dashboard', 'codex', 'latitude']);
  assert.deepEqual(t.state().views, { latitude: { kind: 'thread', id: 'rl' } });
  assert.equal(t.toasts.at(-1)!.text, 'Claude started "Add a rate limit dashboard"');
  t.toasts.at(-1)!.undo!();
  assert.equal(t.state().threads.some((x) => x.id === r.id), false);
});

test('send_to_thread sends into the other thread as a message from this one, with no Undo', async () => {
  const t = setup();
  await t.ok('send_to_thread', { threadId: 'adm', text: 'Use the new limits table' });
  assert.ok(t.thread('adm').activity.some((a) => a.kind === 'message' && a.text.includes('Use the new limits table')));
  assert.equal(t.toasts.at(-1)!.undo, undefined);
});

test('delete_thread with approval removes the thread everywhere, and the worktree only when ticked', async () => {
  const t = setup();
  t.env.dispatch({ type: 'watch-toggle', threadId: 'e2e' });
  const pending = t.call('delete_thread', { threadIds: ['e2e'] });
  assert.deepEqual(t.card().tool!.options, [{ id: 'removeWorktree', label: 'Also remove its worktree: /repo/rl' }]);
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

test('browser_type types locally, asks on other origins, and is blocked there under Changes', async () => {
  const t = setup();
  await t.ok('browser_snapshot');
  await t.ok('browser_type', { ref: 'e2', text: 'me@example.com', submit: true });
  assert.deepEqual(t.acts, [{ kind: 'type', ref: 'e2', text: 'me@example.com' }, { kind: 'press', key: 'Enter' }]);
  const remote = setup({ url: 'https://example.com/', control: 'changes' });
  await remote.ok('browser_snapshot');
  assert.match(await remote.err('browser_type', { ref: 'e2', text: 'x' }), /Everything, asking before deletes and settings/);
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

test('browser_hover, browser_select and browser_drag act on snapshot refs', async () => {
  const t = setup();
  await t.ok('browser_snapshot');
  await t.ok('browser_hover', { ref: 'e1' });
  await t.ok('browser_select', { ref: 'e2', value: 'Pro' });
  await t.ok('browser_drag', { from: 'e1', to: 'e2' });
  assert.deepEqual(t.acts, [{ kind: 'hover', ref: 'e1' }, { kind: 'select', ref: 'e2', value: 'Pro' }, { kind: 'drag', from: 'e1', to: 'e2' }]);
  assert.match(await t.err('browser_drag', { from: 'e1', to: 'e9' }), /browser_snapshot first/);
});

test('browser_wait_for reports whether the condition was met', async () => {
  const t = setup();
  assert.equal((await t.ok('browser_wait_for', { text: 'Hello' })).isMet, true);
  assert.equal((await t.ok('browser_wait_for', { text: 'Bye', timeoutMs: 100 })).isMet, false);
});

test('browser_upload takes worktree files directly and asks for anything outside it', async () => {
  const t = setup();
  await t.ok('browser_snapshot');
  await t.ok('browser_upload', { ref: 'e2', path: 'fixtures/avatar.png' });
  assert.deepEqual(t.acts.at(-1), { kind: 'upload', ref: 'e2', path: '/repo/rl/fixtures/avatar.png' });
  const pending = t.call('browser_upload', { ref: 'e2', path: '../../etc/hosts' });
  await new Promise((r) => setTimeout(r, 0));
  assert.match(t.card().detail, /\/etc\/hosts/);
  decideTool(t.card().tool!.callId, { isApproved: false });
  assert.equal((await pending).isError, true);
  assert.equal(t.acts.length, 1, 'denied: nothing uploaded');
});

test('browser_eval runs on a local page without asking and logs the origin and the script', async () => {
  const t = setup();
  const r = await t.ok('browser_eval', { script: 'window.store.getState().count' });
  assert.equal(r.value, '42');
  assert.deepEqual(t.evals, ['window.store.getState().count']);
  assert.equal(t.state().queue.some((q) => q.tool), false, 'no card');
  assert.equal(lastLog(t.thread('rl')), 'Claude ran a script on http://localhost:5173: window.store.getState().count');
  assert.equal(t.toasts.length, 0);
});

test('browser_eval on another origin needs approval and shows the whole script', async () => {
  const t = setup({ url: 'https://bank.example.com/' });
  const pending = t.call('browser_eval', { script: 'document.cookie' });
  await new Promise((r) => setTimeout(r, 0));
  assert.match(t.card().title, /Run a script on https:\/\/bank.example.com\?/);
  assert.equal(t.card().code, 'document.cookie');
  assert.deepEqual(t.evals, [], 'nothing ran while the card waits');
  decideTool(t.card().tool!.callId, { isApproved: false });
  assert.match((await pending).text, /denied/);
  assert.deepEqual(t.evals, []);
  const again = t.call('browser_eval', { script: 'document.title' });
  await new Promise((r) => setTimeout(r, 0));
  decideTool(t.card().tool!.callId, { isApproved: true });
  assert.equal(JSON.parse((await again).text).value, '42');
});

test('browser_eval is blocked under Read only, and under Changes on other origins', async () => {
  assert.match(await setup({ control: 'read' }).err('browser_eval', { script: '1' }), /Read only/);
  const remote = setup({ url: 'https://example.com/', control: 'changes' });
  assert.match(await remote.err('browser_eval', { script: '1' }), /Everything, asking before deletes and settings/);
  assert.deepEqual(remote.evals, []);
});

test('browser_eval passes the page error back and still logs the run', async () => {
  const t = setup();
  assert.match(await t.err('browser_eval', { script: 'throw new Error("nope")' }), /nope/);
  assert.match(lastLog(t.thread('rl')), /\(threw\)$/);
});

test('names in the table are verb_noun', () => {
  for (const name of TOOL_NAMES) assert.match(name, /^[a-z]+(_[a-z]+)+$/, name satisfies ToolName);
});

test('widget ids carry a per-launch part, so a reload never reuses a saved entry’s id', async () => {
  const t = setup();
  const pending = t.call('delete_thread', { threadIds: ['e2e'] });
  assert.match(t.card().id, /^q-tool-rl-[a-z0-9]+-\d+$/);
  decideTool(t.card().tool!.callId, { isApproved: false });
  await pending;
});

// {PROFILES}

const SECRETS = ['sk-live-abcdefghijklmnop', 'ghp_abcdefghijklmnopqrstuvwxyz', 'ghp_ZYXWVUTSRQPONMLKJIHGFEDCBA'];
const PROFILE_WRITES = {
  update_profile: { name: 'Lat', reason: 'x' },
  link_account: { provider: 'claude', accountId: 'claude-work', reason: 'x' },
  set_profile_instructions: { append: 'Run pnpm test first.', reason: 'x' },
  set_mcp_server_enabled: { name: 'github', enabled: false, reason: 'x' },
  add_mcp_server: { name: 'docs', command: 'npx', args: ['docs-mcp'], reason: 'x' },
  set_skill_enabled: { name: 'review', enabled: false, reason: 'x' },
  remove_mcp_server: { name: 'github' },
  remove_profile: { profileId: 'scratch' },
};

test('list_profiles shows every profile with its accounts, login state and GitHub account, and marks yours', async () => {
  const t = setup();
  const r = await t.ok('list_profiles');
  assert.deepEqual(r.profiles.map((p: { id: string; isYours: boolean }) => [p.id, p.isYours]), [['latitude', true], ['personal', false], ['liane', false], ['scratch', false]]);
  const personal = r.profiles[1];
  assert.deepEqual(personal.accounts.claude, { id: 'claude-work', name: 'Work', login: { state: 'logged-in', method: 'Claude account', plan: 'Max' }, isOwn: true });
  assert.deepEqual(personal.accounts.codex.login, { state: 'logged-out' });
  assert.equal(r.profiles[3].github, 'octo');
  assert.deepEqual(r.accounts.map((a: { id: string }) => a.id), ['claude-default', 'codex-default', 'claude-work']);
  assert.ok(r.icons.includes('rocket'));
});

test('get_profile_config reads your profile: instructions, servers with tool counts and needs, skills; never a secret', async () => {
  const t = setup();
  const r = await t.ok('get_profile_config');
  assert.equal(r.profile.id, 'latitude');
  const github = r.claude.mcpServers.find((s: { name: string }) => s.name === 'github');
  assert.deepEqual([github.enabled, github.tools, github.envVars], [true, 2, ['GITHUB_TOKEN']]);
  const linear = r.claude.mcpServers.find((s: { name: string }) => s.name === 'linear');
  assert.deepEqual([linear.enabled, linear.tools, linear.needs, linear.headers], [false, null, ['needs LINEAR_TOKEN'], ['Authorization']]);
  assert.deepEqual(r.claude.skills, [{ name: 'review', description: 'Review a diff', enabled: true }]);
  assert.match(r.claude.instructions.text, /^Be brief\./);
  for (const secret of SECRETS) assert.doesNotMatch(JSON.stringify(r), new RegExp(secret), 'secret leaked');
  assert.equal(t.state().queue.length, 0, 'your own profile reads without a card');
  assert.deepEqual(Object.keys((await t.ok('get_profile_config', { provider: 'codex' })).codex ?? {}).sort(), ['account', 'instructions', 'mcpServers', 'skills']);
});

test("another profile's config is refused unless the user approves on a card", async () => {
  const t = setup();
  const denied = await t.asking('get_profile_config', { profileId: 'personal' });
  assert.match(denied.card.title, /read Personal's agent setup\?/);
  decideTool(denied.card.tool!.callId, { isApproved: false });
  const refused = await denied.result;
  assert.equal(refused.isError, true);
  assert.doesNotMatch(refused.text, /Be brief/, 'nothing read');
  const approved = await t.asking('get_profile_config', { profileId: 'personal' });
  decideTool(approved.card.tool!.callId, { isApproved: true });
  assert.equal(JSON.parse((await approved.result).text).profile.id, 'personal');
  assert.match(await setup({ control: 'changes' }).err('get_profile_config', { profileId: 'personal' }), /Everything/, 'below Everything another profile is out of reach');
  assert.match(await t.err('get_profile_config', { profileId: 'nope' }), /No profile nope/);
});

test('update_profile shows current → proposed name and icon, and applies only on Apply', async () => {
  const t = setup();
  const kept = await t.asking('update_profile', { name: 'Latitude HQ', icon: 'rocket', reason: 'Matches the team name' });
  assert.deepEqual(kept.card.tool!.changes, [
    { kind: 'name', from: 'Latitude', to: 'Latitude HQ' },
    { kind: 'icon', from: 'work', to: 'rocket' },
  ]);
  assert.equal(kept.card.detail, 'Matches the team name');
  decideTool(kept.card.tool!.callId, { isApproved: false });
  assert.equal((await kept.result).isError, true);
  assert.equal(t.profiles()[0].name, 'Latitude', 'denied: unchanged');
  const applied = await t.asking('update_profile', { name: 'Latitude HQ', reason: 'x' });
  decideTool(applied.card.tool!.callId, { isApproved: true });
  assert.equal(JSON.parse((await applied.result).text).changed, 'Renamed Latitude to Latitude HQ');
  assert.equal(t.profiles()[0].name, 'Latitude HQ');
  assert.match(await t.err('update_profile', { icon: 'skull', reason: 'x' }), /No icon skull/);
  assert.match(await t.err('update_profile', { name: 'Latitude HQ', reason: 'x' }), /already looks like that/);
});

test('link_account links an existing account to a profile without one, and refuses everything else', async () => {
  const t = setup();
  assert.match(await t.err('link_account', { profileId: 'scratch', provider: 'claude', accountId: 'claude-new', reason: 'x' }), /only links existing accounts/);
  assert.match(await t.err('link_account', { profileId: 'scratch', provider: 'codex', accountId: 'claude-work', reason: 'x' }), /is a Claude Code account/);
  assert.match(await t.err('link_account', { profileId: 'personal', provider: 'claude', accountId: 'claude-default', reason: 'x' }), /already has its own Claude Code account \(Work\)/);
  assert.match(await t.err('link_account', { provider: 'claude', accountId: 'claude-work', reason: 'x' }), /never switches a running thread's account/);
  const { result, card } = await t.asking('link_account', { profileId: 'scratch', provider: 'claude', accountId: 'claude-work', reason: 'Scratch work bills to the Work plan' });
  assert.deepEqual(card.tool!.changes, [{ kind: 'account', provider: 'claude', from: 'Default', to: 'Work' }]);
  assert.deepEqual(card.tool!.notes, ['Work is signed in (Max).', "Scratch isn't this thread's profile."]);
  assert.equal(t.settings.accounts.links.scratch, undefined, 'nothing linked while it waits');
  decideTool(card.tool!.callId, { isApproved: true });
  assert.ok(!(await result).isError);
  assert.deepEqual(t.settings.accounts.links.scratch, { claude: 'claude-work' });
});

test('set_profile_instructions appends with a diff on the card, secrets redacted there, and writes only on Apply', async () => {
  const t = setup();
  const { result, card } = await t.asking('set_profile_instructions', { append: 'Run pnpm test before you push.', reason: 'You keep asking me to' });
  const [edit] = card.tool!.edits!;
  assert.match(edit.after, /Be brief\.\nAPI_TOKEN=\[redacted\]\nRun pnpm test before you push\.\n$/);
  for (const secret of SECRETS) assert.doesNotMatch(JSON.stringify(card), new RegExp(secret), 'the saved card holds no secret');
  assert.equal(t.settings.config.claude.instructions.includes('pnpm test'), false, 'nothing written while it waits');
  decideTool(card.tool!.callId, { isApproved: true });
  const r = JSON.parse((await result).text);
  assert.equal(r.changed, 'Updated the instructions for Latitude');
  assert.equal(r.backupDir, '/backups/1');
  assert.match(t.settings.config.claude.instructions, /sk-live-abcdefghijklmnop\nRun pnpm test/, 'the real file keeps its own value');
  assert.match(await t.err('set_profile_instructions', { text: 'API_TOKEN=[redacted]', reason: 'x' }), /append instead/);
  assert.match(await t.err('set_profile_instructions', { reason: 'x' }), /Pass text .* or append/);
});

test('a config write is refused when the file changed after the card showed its diff', async () => {
  const t = setup();
  const { result, card } = await t.asking('set_mcp_server_enabled', { name: 'github', enabled: false, reason: 'x' });
  t.settings.files.set('/acct/claude/.claude.json', 'edited in Claude Code meanwhile');
  decideTool(card.tool!.callId, { isApproved: true });
  const r = await result;
  assert.equal(r.isError, true);
  assert.match(r.text, /changed since you reviewed it/);
  assert.equal(t.settings.config.claude.servers[0].enabled, true);
  assert.match(lastLog(t.thread('rl')), /^Failed: A file changed since/);
});

test('set_mcp_server_enabled shows the switch current → proposed and the diff', async () => {
  const t = setup();
  const { result, card } = await t.asking('set_mcp_server_enabled', { name: 'github', enabled: false, reason: 'Not needed here' });
  assert.equal(card.title, 'Turn off MCP server github for Latitude?');
  assert.deepEqual(card.tool!.changes, [{ kind: 'switch', label: 'MCP server github (Claude Code)', from: true, to: false }]);
  assert.equal(card.tool!.edits!.length, 1);
  decideTool(card.tool!.callId, { isApproved: true });
  assert.equal(JSON.parse((await result).text).changed, 'Turned off MCP server github for Latitude');
  assert.equal(t.settings.config.claude.servers[0].enabled, false);
  assert.match(await t.err('set_mcp_server_enabled', { name: 'github', enabled: false, reason: 'x' }), /already off/);
  assert.match(await t.err('set_mcp_server_enabled', { name: 'jira', enabled: true, reason: 'x' }), /no MCP server jira/);
});

test('add_mcp_server takes ${VAR} placeholders and refuses anything that looks like a credential, before any card', async () => {
  const t = setup();
  assert.match(await t.err('add_mcp_server', { name: 'gh2', command: 'npx', env: { GITHUB_TOKEN: 'ghp_abcdefghijklmnopqrstuvwxyz' }, reason: 'x' }), /GITHUB_TOKEN looks like a secret.*Settings › Profiles/);
  assert.match(await t.err('add_mcp_server', { name: 'api', url: 'https://api.example.com/mcp', headers: { Authorization: 'Bearer abcdef1234567890' }, reason: 'x' }), /looks like a secret/);
  assert.match(await t.err('add_mcp_server', { name: 'github', command: 'npx', reason: 'x' }), /already has a server named github/);
  assert.match(await t.err('add_mcp_server', { name: 'both', command: 'npx', url: 'https://x.dev/mcp', reason: 'x' }), /not both/);
  assert.equal(t.state().queue.length, 0, 'no card for a refused server');
  const { result, card } = await t.asking('add_mcp_server', { name: 'gh2', command: 'npx', args: ['gh-mcp'], env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' }, reason: 'For PR reviews' });
  assert.equal(card.title, 'Add MCP server gh2 to Latitude?');
  decideTool(card.tool!.callId, { isApproved: true });
  assert.ok(!(await result).isError);
  assert.equal(t.settings.config.claude.servers.at(-1)!.def.env!.GITHUB_TOKEN, '${GITHUB_TOKEN}');
});

test('set_skill_enabled turns a skill off after Apply', async () => {
  const t = setup();
  const { result, card } = await t.asking('set_skill_enabled', { name: 'review', enabled: false, reason: 'It fights the repo’s own review flow' });
  assert.deepEqual(card.tool!.changes, [{ kind: 'switch', label: 'Skill review (Claude Code)', from: true, to: false }]);
  decideTool(card.tool!.callId, { isApproved: true });
  assert.ok(!(await result).isError);
  assert.equal(t.settings.config.claude.skills[0].enabled, false);
  assert.match(await t.err('set_skill_enabled', { name: 'deploy', enabled: true, reason: 'x' }), /no skill deploy/);
});

test('remove_mcp_server asks on a delete card naming the server, with the diff', async () => {
  const t = setup();
  const denied = await t.asking('remove_mcp_server', { name: 'linear' });
  assert.equal(denied.card.title, 'Remove MCP server linear from Latitude?');
  assert.equal(denied.card.tool!.isDestructive, true);
  assert.equal(denied.card.tool!.edits!.length, 1);
  decideTool(denied.card.tool!.callId, { isApproved: false });
  await denied.result;
  assert.equal(t.settings.config.claude.servers.length, 2, 'cancelled: kept');
  const approved = await t.asking('remove_mcp_server', { name: 'linear' });
  decideTool(approved.card.tool!.callId, { isApproved: true });
  assert.ok(!(await approved.result).isError);
  assert.deepEqual(t.settings.config.claude.servers.map((s) => s.def.name), ['github']);
});

test('remove_profile refuses the last profile and any with threads, and removes an empty one after Delete', async () => {
  const t = setup();
  assert.match(await t.err('remove_profile', { profileId: 'latitude' }), /still has \d+ threads \(\d+ live\)/);
  const { result, card } = await t.asking('remove_profile', { profileId: 'scratch' });
  assert.equal(card.title, 'Remove the profile Scratch?');
  assert.equal(card.tool!.isDestructive, true);
  decideTool(card.tool!.callId, { isApproved: true });
  assert.ok(!(await result).isError);
  assert.equal(t.profiles().some((p) => p.id === 'scratch'), false);
  const alone = setup();
  for (const p of alone.profiles()) if (p.id !== 'latitude') alone.env.profiles.remove(p.id);
  assert.match(await alone.err('remove_profile', { profileId: 'latitude' }), /last profile/);
});

test('every profile write asks: Read only and Changes block them all, with no card and nothing touched', async () => {
  for (const control of ['read', 'changes'] as const) {
    const t = setup({ control });
    for (const [name, args] of Object.entries(PROFILE_WRITES)) assert.match(await t.err(name, args), control === 'read' ? /Read only/ : /Everything/, name);
    assert.equal(t.state().queue.some((q) => q.tool), false);
    assert.deepEqual(t.settings.calls, [], 'not even a preview');
    assert.ok((await t.ok('list_profiles')).profiles.length, 'reads still work');
  }
});

test('every profile write waits on its card: nothing is applied before Apply', async () => {
  const t = setup();
  for (const [name, args] of Object.entries(PROFILE_WRITES)) {
    const { result, card } = await t.asking(name, name === 'link_account' ? { ...args, profileId: 'scratch' } : args);
    assert.ok(card.tool, `${name} opened a card`);
    assert.equal(t.settings.calls.includes('applyConfig') || t.settings.calls.includes('linkAccount'), false, `${name} wrote before Apply`);
    decideTool(card.tool!.callId, { isApproved: false });
    assert.equal((await result).isError, true);
  }
  assert.equal(t.profiles().length, 4);
});
