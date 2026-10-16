import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Page } from '../browser/pages.ts';
import type { BrowserAct } from '../host/types/browser.ts';
import { draftFrom } from '../goals/edit.ts';
import { singleLayout } from '../layout/tree.ts';
import { DEFAULT_SETTINGS, type AccountsState, type ProviderConfig } from '../host/types/settings.ts';
import { DEFAULT_SPACES, firstPrompt, type Provider, type Space } from '../model.ts';
import { DEFAULT_ACCOUNTS, linkedAccountId } from '../settings/accounts.ts';
import type { ConfigChange, McpEntry, SkillEntry } from '../settings/agentConfig.ts';
import { DEFAULT_PREFS, setPrefs, type AgentControl, type Prefs } from '../settings/prefs.ts';
import type { Action, State } from '../store/index.tsx';
import { layoutReducer } from '../store/layout.ts';
import { panesReducer } from '../store/panes.ts';
import { initialQueue, queueReducer } from '../store/queue.ts';
import { sidechatReducer } from '../store/sidechat.ts';
import { initialThreads, threadsReducer } from '../store/threads.ts';
import { CLAUDE_DEMO_MODELS } from './models.ts';
import { decideTool, runTool, type ToolEnv } from './tools.ts';
import { asks, TOOL_NAMES, tierOf, type ToolName } from './toolTable.ts';
import { applyUndo } from './undo.ts';

const SLICES = [threadsReducer, queueReducer, panesReducer, layoutReducer, sidechatReducer];
const reduce = (s: State, a: Action): State => (a.type === 'tool-undo' ? applyUndo(s, a.undo).state : SLICES.reduce((x, r) => r(x, a), s));

/** The demo profile "latitude", you looking at "rl" (Claude), with "rl"'s pane holding one browser tab. */
function setup({ control = 'everything' as AgentControl, url = 'http://localhost:5173/', gitBranches = null as string[] | null, gitCurrent = 'main' as string | null, failing = [] as string[] } = {}) {
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
    notifications: { quiet: { isOn: false, start: 22, end: 8 }, muted: [] },
  } as unknown as State;
  const toasts: { text: string; undo?: () => void }[] = [];
  const notices: string[] = [];
  const acts: BrowserAct[] = [];
  const commands: string[] = [];
  const removed: string[] = [];
  const evals: string[] = [];
  const answers: boolean[] = [];
  const pushes: string[] = [];
  const opened: string[] = [];
  const prs: { title: string; body: string }[] = [];
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
    pages: { get: (k) => pages.get(k), update: (k, patch) => void pages.set(k, { ...(pages.get(k) as Page), ...patch }), open: (k) => void opened.push(k) },
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
      answerDialog: async (_id, { accept }) => void (answers.push(accept), pages.set('rl/tab-1', { ...pages.get('rl/tab-1')!, dialog: null })),
    },
    cwdOf: () => '/repo/rl',
    models: async () => CLAUDE_DEMO_MODELS,
    profiles: {
      list: () => profiles,
      update: (id, patch) => void (profiles = profiles.map((p) => (p.id === id ? { ...p, ...patch } : p))),
      remove: (id) => void (profiles = profiles.filter((p) => p.id !== id)),
    },
    theme: () => 'system',
    settings: settings.host,
    themes: { list: async () => [] },
    remote: { status: async () => ({ settings: { isEnabled: false, allowsNetwork: false, machineName: '', reachesAnywhere: false }, hostName: 'mac', addresses: [], devices: [], members: [], isRemoved: false, relay: { status: 'off' } }) },
    isDesktop: true,
    git: {
      branches: async () => (gitBranches ? { current: gitCurrent, defaultBranch: 'main', isDirty: false, branches: gitBranches.map((name) => ({ name, isRemote: false })) } : Promise.reject(new Error('not a git repo'))) as never,
      push: async (cwd) => void pushes.push(cwd), createPr: async (_cwd, pr) => (prs.push(pr), 'https://github.com/o/r/pull/9'),
      runCheck: async (_cwd, command) => (failing.includes(command) ? { exitCode: 1, output: 'ℹ tests 714\nℹ fail 5', ms: 9 } : { exitCode: 0, output: 'ok', ms: 9 }),
    },
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
  const t = { env, call, ok, err, asking, thread, card, state: () => state, prefs: () => prefs, profiles: () => profiles, settings, toasts, notices, acts, commands, removed, evals, answers, pages, pushes, prs, opened };
  return t;
}

/**
 * `host.settings` for the settings tools, over in-memory config files: preview shows each change as one file edit, apply
 * refuses when a file moved since its preview (main's stale check). Any method outside the tools' slice throws: no
 * credential and no settings write is reachable.
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
    commands: [],
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
    get: async () => DEFAULT_SETTINGS,
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
      if (!(key in target)) throw new Error(`settings tools must not call settings.${key}`);
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
  assert.deepEqual(TOOL_NAMES.filter((name) => asks(tierOf(name))), ['delete_thread', 'update_settings', 'set_keybinding', 'add_mcp_server', 'remove_mcp_server', 'remove_profile']);
});

test('auto tools never wait: creating and messaging threads run straight through, no widget', async () => {
  const t = setup();
  const created = await t.ok('create_thread', { prompt: 'Add a rate limit dashboard' });
  await t.ok('send_to_thread', { threadId: 'adm', text: 'Use the new limits table' });
  await t.ok('rename_thread', { threadId: 'adm', title: 'Admin usage page' });
  assert.ok(t.thread(created.id));
  assert.equal(t.state().queue.some((q) => q.tool), false, 'no widget was shown');
});

test('create_thread names the branch from its prompt, unique among the repo branches, and falls back to the prompt alone without git', async () => {
  const named = setup({ gitBranches: ['main', 'feat/rate-limit-dashboard'] });
  const created = await named.ok('create_thread', { prompt: 'Add a rate limit dashboard' });
  assert.equal(named.thread(created.id)?.repo?.branch, 'feat/rate-limit-dashboard-2');
  const offline = setup();
  const fallback = await offline.ok('create_thread', { prompt: 'Fix the login bug' });
  assert.equal(offline.thread(fallback.id)?.repo?.branch, 'fix/login-bug');
});

test('create_thread gives the new thread its own worktree even when your Worktree box is unticked', async () => {
  const t = setup({ gitBranches: ['main'] });
  t.env.prefs.set({ workspaceMode: 'folder' });
  setPrefs({ workspaceMode: 'folder' });
  try {
    const created = await t.ok('create_thread', { prompt: 'Fix the login bug' });
    assert.notEqual(t.thread(created.id)?.repo?.mode, 'folder');
    assert.equal(t.thread(created.id)?.repo?.branch, 'fix/login-bug');
  } finally {
    setPrefs({ workspaceMode: DEFAULT_PREFS.workspaceMode });
  }
});

test('create_thread takes a model and effort at or below the default, and refuses dearer ones unless the setting allows', async () => {
  const t = setup();
  t.env.dispatch({ type: 'controls', threadId: 'rl', controls: { model: 'claude-sonnet-5-5', effort: 'high', speed: '', access: 'Auto' } });
  const cheaper = await t.ok('create_thread', { prompt: 'Rename a variable', model: 'claude-haiku-5-5', effort: 'low' });
  assert.deepEqual(t.thread(cheaper.id).controls, { model: 'claude-haiku-5-5', effort: 'low', speed: '', access: 'Auto' });
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

test('read only blocks every write, settings included, and shows agent control in the thread once', async () => {
  const t = setup({ control: 'read' });
  const before = t.state().threads;
  assert.match(await t.err('settle_thread', { threadIds: ['adm'] }), /Read only/);
  assert.match(await t.err('browser_click', { ref: 'e1' }), /Read only/);
  assert.match(await t.err('update_settings', { changes: [{ key: 'diffStyle', value: 'split' }], reason: 'x' }), /Read only/);
  assert.match(await t.err('delete_thread', { threadIds: ['e2e'] }), /Read only/);
  assert.equal(t.state().threads.filter((x) => x.id !== 'rl').every((x, i) => x === before.filter((y) => y.id !== 'rl')[i]), true, 'no other thread changed');
  assert.equal(t.prefs().diffStyle, 'unified');
  const cards = t.state().queue.filter((q) => q.kind === 'setting');
  assert.equal(cards.length, 1, 'one widget, raised in place');
  assert.deepEqual(cards[0].settings!.changes, [{ key: 'agentControl', value: 'everything' }]);
  assert.equal(cards[0].settings!.by, 'harness');
  assert.equal(t.thread('rl').activity.filter((a) => a.card?.id === cards[0].id).length, 1);
  assert.ok((await t.ok('list_threads')).length > 0, 'reads still work');
});

test('a tool set to Off refuses, Ask waits on a widget showing the call, and your choice beats the level', async () => {
  const t = setup({ control: 'read' });
  t.env.prefs.set({ toolPolicies: { settle_thread: 'allow', rename_thread: 'ask', list_threads: 'off' } });
  await t.ok('settle_thread', { threadIds: ['adm'] });
  assert.equal(t.thread('adm').status, 'settled', 'Allow runs it under Read only');
  assert.match(await t.err('list_threads'), /turned list_threads off for agents in Settings › Mochi access/);
  assert.equal(t.state().queue.some((q) => q.kind === 'setting'), false, 'Off is yours: no agent-control widget');
  const { result, card } = await t.asking('rename_thread', { title: 'Renamed' });
  assert.equal(t.thread('rl').title === 'Renamed', false, 'nothing happens while it waits');
  assert.match(card.title, /wants to rename thread/);
  assert.match(card.code!, /"title": "Renamed"/);
  decideTool(card.tool!.callId, { isApproved: true });
  assert.ok(!(await result).isError);
  assert.equal(t.thread('rl').title, 'Renamed');
  const denied = await t.asking('rename_thread', { title: 'Again' });
  decideTool(denied.card.tool!.callId, { isApproved: false });
  assert.match((await denied.result).text, /denied/);
  assert.equal(t.thread('rl').title, 'Renamed');
});

test("deletes can't be set to run on their own: a saved Allow is ignored and they still ask", async () => {
  const t = setup();
  t.env.prefs.set({ toolPolicies: { delete_thread: 'allow' } as never });
  const { result, card } = await t.asking('delete_thread', { threadIds: ['e2e'] });
  assert.equal(card.tool!.isDestructive, true);
  decideTool(card.tool!.callId, { isApproved: false });
  assert.match((await result).text, /denied/);
  assert.ok(t.thread('e2e'));
});

test('changes runs everything that doesn’t ask, and blocks deletes and settings without showing their widget', async () => {
  const t = setup({ control: 'changes' });
  await t.ok('create_thread', { prompt: 'x' });
  assert.match(await t.err('delete_thread', { threadIds: ['e2e'] }), /Everything, asking before deletes and settings/);
  assert.match(await t.err('update_settings', { changes: [{ key: 'diffStyle', value: 'split' }], reason: 'x' }), /Everything/);
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
  assert.deepEqual((await t.ok('list_threads')).map((x: { id: string }) => x.id), ['rl', 'limit', 'adm', 'e2e', 'auth', 'onb', 'viz']);
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
  assert.deepEqual([firstPrompt(created), created.providers[0], created.repo?.project], ['Add a rate limit dashboard', 'codex', 'latitude']);
  assert.deepEqual(t.state().views, { latitude: { kind: 'thread', id: 'rl' } });
  assert.equal(t.toasts.at(-1)!.text, 'Claude started "Add a rate limit dashboard"');
  t.toasts.at(-1)!.undo!();
  assert.equal(t.state().threads.some((x) => x.id === r.id), false);
});

test('send_to_thread sends into the other thread as a message from this one, with no Undo', async () => {
  const t = setup();
  const sender = t.thread('rl');
  t.env.dispatch({ type: 'say', threadId: 'rl', entry: { who: 'claude', kind: 'tool', text: 'Mcp mochi: send_to_thread', mcp: { server: 'mochi', tool: 'send_to_thread' } } });
  await t.ok('send_to_thread', { threadId: 'adm', text: '  Use the new limits table ' });
  const received = t.thread('adm').activity.at(-1)!;
  assert.deepEqual({ who: received.who, kind: received.kind, text: received.text, from: received.from }, { who: 'you', kind: 'message', text: 'Use the new limits table', from: { threadId: 'rl', title: sender.title } });
  assert.deepEqual(t.thread('rl').activity.findLast((a) => a.kind === 'tool')!.sent, { threadId: 'adm', title: t.thread('adm').title, text: 'Use the new limits table' }, "the sender's call row knows what it sent");
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

test('add_step lands as a plan step by the agent, not a goal revision', async () => {
  const t = setup();
  const before = t.thread('rl').revisions.length;
  await t.ok('add_step', { title: 'Document the limits' });
  const added = t.thread('rl').steps.find((s) => s.title === 'Document the limits')!;
  assert.deepEqual([added.addedBy, t.thread('rl').revisions.length], ['claude', before]);
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

test('browser tools drive an off-screen thread without moving the user', async () => {
  const t = setup();
  t.env.dispatch({ type: 'go', view: { kind: 'thread', id: 'adm' } });
  await t.ok('browser_snapshot');
  assert.deepEqual(t.opened, ['rl/tab-1']);
  assert.deepEqual(t.state().views.latitude, { kind: 'thread', id: 'adm' });
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

test('browser_dialog answers the open dialog; until then the other browser tools fail with its message', async () => {
  const t = setup();
  assert.match(await t.err('browser_dialog', { accept: true }), /No dialog is open/);
  t.pages.set('rl/tab-1', { ...t.pages.get('rl/tab-1')!, dialog: { kind: 'confirm', message: 'Delete it?' } });
  for (const [name, args] of [['browser_snapshot', {}], ['browser_press', { key: 'Enter' }], ['browser_reload', {}], ['browser_open', { url: 'localhost:5173/x' }]] as const)
    assert.equal(await t.err(name, args), 'A confirm dialog is open: "Delete it?"; answer it with browser_dialog', name);
  assert.deepEqual([t.acts, t.commands], [[], []]);
  await t.ok('browser_dialog', { accept: false });
  assert.deepEqual(t.answers, [false]);
  await t.ok('browser_snapshot');
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

// {SETTINGS}

const SECRETS = ['sk-live-abcdefghijklmnop', 'ghp_abcdefghijklmnopqrstuvwxyz', 'ghp_ZYXWVUTSRQPONMLKJIHGFEDCBA'];

type SettingView = { key: string; value: string | null; allowed?: string[]; locked?: string; section?: string; group?: string; server?: Record<string, unknown> };
const byKey = (r: { settings: SettingView[] }, key: string) => r.settings.find((s) => s.key === key)!;
const widget = (t: ReturnType<typeof setup>) => t.state().queue.find((q) => q.settings)!;

test('get_settings reads every app setting and your profile’s, with values, allowed values and what’s locked', async () => {
  const t = setup();
  const r = await t.ok('get_settings');
  assert.equal(r.profile.id, 'latitude');
  assert.deepEqual([byKey(r, 'diffStyle').value, byKey(r, 'diffStyle').allowed], ['unified', ['unified', 'split']]);
  assert.equal(byKey(r, 'theme').value, 'system');
  assert.equal(byKey(r, 'concurrency').value, '6', 'host settings come from main');
  assert.equal(byKey(r, 'alert.needs-you').value, 'true');
  assert.equal(byKey(r, 'quietFrom').value, '22');
  assert.deepEqual([byKey(r, 'permissions').section, byKey(r, 'permissions').group], ['general', 'New threads'], 'the page and its titled section');
  assert.deepEqual([byKey(r, 'idleAlert.gaps').section, byKey(r, 'idleAlert.gaps').group], ['notifications', 'Idle threads']);
  for (const key of ['agentControl', 'permissions', 'threadModels', 'claude.path']) assert.ok(byKey(r, key).locked, `${key} is locked`);
  assert.equal(byKey(r, 'profile.name').value, 'Latitude');
  assert.equal(byKey(r, 'profile.claudeAccount').value, 'claude-default');
  assert.equal(byKey(r, 'profile.claude.mcp.github').value, 'true');
  assert.equal(byKey(r, 'profile.claude.skill.review').value, 'true');
  assert.match(byKey(r, 'profile.claude.instructions').value!, /^Be brief\.\nAPI_TOKEN=\[redacted\]/);
  assert.deepEqual(byKey(r, 'profile.claude.mcp.linear').server!.needs, ['needs LINEAR_TOKEN']);
  assert.equal(byKey(r, 'profile.claude.mcp.github').server!.tools, undefined, 'servers start only for section: profile');
  for (const secret of SECRETS) assert.doesNotMatch(JSON.stringify(r), new RegExp(secret), 'secret leaked');
  const profile = await t.ok('get_settings', { section: 'profile' });
  assert.ok(profile.settings.every((s: SettingView) => s.key.startsWith('profile.')));
  assert.equal(byKey(profile, 'profile.claude.mcp.github').server!.tools, 2);
  assert.equal(t.state().queue.length, 0, 'your own profile reads without a card');
});

test("another profile's settings are refused unless the user approves on a card", async () => {
  const t = setup();
  const denied = await t.asking('get_settings', { profileId: 'personal' });
  assert.match(denied.card.title, /read Personal's settings\?/);
  decideTool(denied.card.tool!.callId, { isApproved: false });
  const refused = await denied.result;
  assert.equal(refused.isError, true);
  assert.doesNotMatch(refused.text, /Be brief/, 'nothing read');
  const approved = await t.asking('get_settings', { profileId: 'personal' });
  decideTool(approved.card.tool!.callId, { isApproved: true });
  const r = JSON.parse((await approved.result).text);
  assert.equal(byKey(r, 'profile.claudeAccount').value, 'claude-work');
  assert.match(await setup({ control: 'changes' }).err('get_settings', { profileId: 'personal' }), /Everything/, 'below Everything another profile is out of reach');
});

test('update_settings puts one live widget in the thread with every suggestion grouped, returns at once, and changes nothing itself', async () => {
  const t = setup();
  const r = await t.ok('update_settings', {
    changes: [
      { key: 'diffStyle', value: 'split' },
      { key: 'profile.name', value: 'Latitude HQ' },
      { key: 'profile.claude.mcp.github', value: 'false' },
      { key: 'profile.claude.instructions', value: 'Be brief.\nRun pnpm test before you push.\n' },
    ],
    reason: 'Set up this profile for the refactor',
  });
  assert.deepEqual(r.shown, ['Diffs', 'Name', 'MCP server github', 'CLAUDE.md']);
  assert.match(r.note, /won't get their answer/);
  assert.equal(r.changed, undefined, 'nothing changed, so no log line or toast');
  const { settings, title, kind } = widget(t);
  assert.equal(kind, 'setting');
  assert.equal(title, 'Claude suggests 4 setting changes');
  assert.equal(settings!.reason, 'Set up this profile for the refactor');
  assert.deepEqual(settings!.changes.map((c) => [c.key, c.profileId]), [
    ['diffStyle', undefined],
    ['profile.name', 'latitude'],
    ['profile.claude.mcp.github', 'latitude'],
    ['profile.claude.instructions', 'latitude'],
  ]);
  assert.equal(settings!.before.diffStyle, 'unified');
  assert.equal(settings!.before['latitude/profile.name'], 'Latitude');
  assert.match(settings!.before['latitude/profile.claude.instructions'], /^\d+:-?\d+$/, 'instructions are kept as a hash, never their text');
  assert.equal(t.thread('rl').activity.at(-1)!.card!.id, widget(t).id, 'it sits in the thread where the agent asked');
  assert.equal(t.prefs().diffStyle, 'unified');
  assert.equal(t.profiles()[0].name, 'Latitude');
  assert.equal(t.settings.config.claude.servers[0].enabled, true);
  assert.equal(t.settings.calls.some((c) => c === 'applyConfig' || c === 'previewConfig'), false, 'no file was even previewed');
  assert.equal(t.toasts.length, 0);
  for (const secret of SECRETS) assert.doesNotMatch(JSON.stringify(t.state().queue), new RegExp(secret), 'the saved widget holds no secret');
});

test('update_settings validates every change before showing anything', async () => {
  const t = setup();
  const one = (key: string, value: string, profileId?: string) => t.err('update_settings', { changes: [{ key, value, ...(profileId && { profileId }) }], reason: 'x' });
  assert.match(await one('diffStyle', 'sideways'), /allowed: unified, split/);
  assert.match(await one('diffStyle', 'unified'), /already Unified/);
  assert.match(await one('terminalFontSize', '99'), /from 9 to 24/);
  assert.match(await one('nope', 'x'), /No setting nope/);
  assert.match(await one('agentControl', 'everything'), /the user's alone/);
  assert.match(await one('permissions', 'Full access'), /the user's alone/);
  assert.match(await one('claude.path', '/tmp/evil'), /the user's alone/);
  assert.match(await one('diffStyle', 'split', 'latitude'), /isn't a profile setting/);
  assert.match(await one('profile.icon', 'skull'), /isn't a value of profile.icon/);
  assert.match(await one('profile.claude.instructions', 'API_TOKEN=[redacted]'), /still holds \[redacted\]/);
  assert.match(await one('claude.model', 'claude-gpt-9'), /isn't offered/);
  assert.match(await t.err('update_settings', { changes: [{ key: 'diffStyle', value: 'split' }, { key: 'diffStyle', value: 'split' }], reason: 'x' }), /appears twice/);
  assert.equal(t.state().queue.length, 0, 'no widget for a bad call');
});

test('get_keybindings lists every command with its chord now and its default, and get_settings leaves shortcuts to it', async () => {
  const t = setup();
  t.env.prefs.set({ keybindings: { palette: 'mod+shift+K', 'go-new': '' } });
  const r = await t.ok('get_keybindings');
  const palette = r.commands.find((c: { id: string }) => c.id === 'palette');
  assert.deepEqual(palette, { id: 'palette', title: 'Command palette', group: 'General', scope: 'global', keys: 'mod+shift+K', default: 'mod+K', isCustom: true });
  assert.equal(r.commands.find((c: { id: string }) => c.id === 'go-new').keys, '', 'a removed shortcut reads as ""');
  assert.ok(r.fixed.some((f: { what: string }) => /composer/.test(f.what)));
  assert.match(r.reserved, /Copy/);
  const settings = await t.ok('get_settings');
  assert.equal(settings.settings.some((s: { key: string }) => s.key.startsWith('keybinding.')), false);
  assert.match(await t.err('update_settings', { changes: [{ key: 'keybinding.palette', value: 'mod+J' }], reason: 'x' }), /set_keybinding/);
});

test('set_keybinding shows current → proposed on a settings widget, and refuses what Settings › Keyboard refuses', async () => {
  const t = setup();
  const r = await t.ok('set_keybinding', { command: 'palette', keys: 'shift+mod+k', reason: 'You asked for ⌘⇧K' });
  assert.deepEqual(r.shown, ['keybinding.palette']);
  const { settings, title } = widget(t);
  assert.equal(title, 'Claude suggests a new shortcut for Command palette');
  assert.deepEqual(settings!.changes, [{ key: 'keybinding.palette', value: 'mod+shift+K' }]);
  assert.deepEqual(settings!.before, { 'keybinding.palette': 'mod+K' });
  assert.deepEqual(t.prefs().keybindings, {}, 'only the user applies it');

  const err = (args: Record<string, string>) => t.err('set_keybinding', { reason: 'x', ...args });
  assert.match(await err({ command: 'nope', keys: 'mod+J' }), /No command nope/);
  assert.match(await err({ command: 'palette', keys: 'cmd+J' }), /isn't a chord/);
  assert.match(await err({ command: 'palette', keys: 'mod+K' }), /already mod\+K/);
  assert.match(await err({ command: 'palette', keys: 'mod+C' }), /mod\+C is reserved: Copy/);
  assert.match(await err({ command: 'palette', keys: 'Tab' }), /needs/);
  assert.match(await err({ command: 'palette', keys: 'mod+P' }), /already used by Go to file \(files-go-to\); pass onConflict/);
});

test('set_keybinding settles a clash on the widget: swap gives the other command the old chord, replace clears it', async () => {
  const swap = setup();
  await swap.ok('set_keybinding', { command: 'palette', keys: 'mod+P', onConflict: 'swap', reason: 'x' });
  assert.deepEqual(widget(swap).settings!.changes, [
    { key: 'keybinding.palette', value: 'mod+P' },
    { key: 'keybinding.files-go-to', value: 'mod+K' },
  ]);
  const replace = setup();
  await replace.ok('set_keybinding', { command: 'palette', keys: 'mod+P', onConflict: 'replace', reason: 'x' });
  assert.deepEqual(widget(replace).settings!.changes[1], { key: 'keybinding.files-go-to', value: '' });
  const cleared = setup();
  await cleared.ok('set_keybinding', { command: 'go-new', keys: '', reason: 'x' });
  assert.match(widget(cleared).title, /removing the shortcut for New thread/);
});

test('account suggestions: only an existing account, only for a profile without its own, never under active threads', async () => {
  const t = setup();
  const account = (profileId: string, value: string) => t.call('update_settings', { changes: [{ key: 'profile.claudeAccount', value, profileId }], reason: 'x' });
  assert.match((await account('scratch', 'claude-new')).text, /isn't a value/);
  assert.match((await account('personal', 'claude-default')).text, /already has its own Claude Code account \(Work\)/);
  assert.match((await account('latitude', 'claude-work')).text, /never switches a running thread's account/);
  assert.ok(!(await account('scratch', 'claude-work')).isError);
  assert.deepEqual(widget(t).settings!.changes, [{ key: 'profile.claudeAccount', value: 'claude-work', profileId: 'scratch' }]);
  assert.equal(widget(t).title, 'Claude suggests changing Claude Code account (Scratch)', 'another profile is named on the widget');
  assert.equal(t.settings.accounts.links.scratch, undefined, 'nothing linked');
});

test('add_mcp_server fills the server into a live widget, refusing anything that looks like a credential', async () => {
  const t = setup();
  assert.match(await t.err('add_mcp_server', { name: 'gh2', command: 'npx', env: { GITHUB_TOKEN: 'ghp_abcdefghijklmnopqrstuvwxyz' }, reason: 'x' }), /GITHUB_TOKEN looks like a secret/);
  assert.match(await t.err('add_mcp_server', { name: 'api', url: 'https://api.example.com/mcp', headers: { Authorization: 'Bearer abcdef1234567890' }, reason: 'x' }), /looks like a secret/);
  assert.match(await t.err('add_mcp_server', { name: 'github', command: 'npx', reason: 'x' }), /already has a server named github/);
  assert.match(await t.err('add_mcp_server', { name: 'both', command: 'npx', url: 'https://x.dev/mcp', reason: 'x' }), /not both/);
  assert.equal(t.state().queue.length, 0);
  const r = await t.ok('add_mcp_server', { name: 'gh2', command: 'npx', args: ['gh-mcp'], env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' }, reason: 'For PR reviews' });
  assert.deepEqual(r.shown, ['MCP server gh2']);
  assert.deepEqual(widget(t).settings!.addServer, { profileId: 'latitude', provider: 'claude', server: { name: 'gh2', type: 'stdio', command: 'npx', args: ['gh-mcp'], env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' }, url: undefined, headers: undefined } });
  assert.equal(t.settings.config.claude.servers.length, 2, 'nothing added');
});

test('remove_mcp_server asks on a delete card naming the server, with the diff, and writes through the stale check', async () => {
  const t = setup();
  const denied = await t.asking('remove_mcp_server', { name: 'linear' });
  assert.equal(denied.card.title, 'Remove MCP server linear from Latitude?');
  assert.equal(denied.card.tool!.isDestructive, true);
  assert.equal(denied.card.tool!.edits!.length, 1);
  decideTool(denied.card.tool!.callId, { isApproved: false });
  await denied.result;
  assert.equal(t.settings.config.claude.servers.length, 2, 'cancelled: kept');
  const stale = await t.asking('remove_mcp_server', { name: 'linear' });
  t.settings.files.set('/acct/claude/.claude.json', 'edited in Claude Code meanwhile');
  decideTool(stale.card.tool!.callId, { isApproved: true });
  assert.match((await stale.result).text, /changed since you reviewed it/);
  assert.equal(t.settings.config.claude.servers.length, 2, 'stale: kept');
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

test('list_profiles shows every profile with its accounts, login state and GitHub account, and marks yours', async () => {
  const t = setup();
  const r = await t.ok('list_profiles');
  assert.deepEqual(r.profiles.map((p: { id: string; isYours: boolean }) => [p.id, p.isYours]), [['latitude', true], ['personal', false], ['liane', false], ['scratch', false]]);
  assert.deepEqual(r.profiles[1].accounts.claude, { id: 'claude-work', name: 'Work', login: { state: 'logged-in', method: 'Claude account', plan: 'Max' }, isOwn: true });
  assert.equal(r.profiles[3].github, 'octo');
  assert.deepEqual(r.accounts.map((a: { id: string }) => a.id), ['claude-default', 'codex-default', 'claude-work']);
});

test('Read only and Changes block every settings suggestion and delete with no widget, and nothing is touched', async () => {
  const writes = {
    update_settings: { changes: [{ key: 'diffStyle', value: 'split' }], reason: 'x' },
    add_mcp_server: { name: 'docs', command: 'npx', reason: 'x' },
    set_keybinding: { command: 'palette', keys: 'mod+shift+K', reason: 'x' },
    remove_mcp_server: { name: 'github' },
    remove_profile: { profileId: 'scratch' },
  };
  for (const control of ['read', 'changes'] as const) {
    const t = setup({ control });
    for (const [name, args] of Object.entries(writes)) assert.match(await t.err(name, args), control === 'read' ? /Read only/ : /Everything/, name);
    assert.equal(t.state().queue.some((q) => q.tool || (q.settings && q.settings.by !== 'harness')), false);
    assert.deepEqual(t.settings.calls, [], 'not even a read');
  }
});

test('claim_criterion records evidence; report and get_report give the turn as data', async () => {
  const t = setup();
  t.env.dispatch({ type: 'edit-goal', threadId: 'rl', draft: { ...draftFrom(t.thread('rl')), criteria: [{ text: '429s carry Retry-After' }] } });
  const [criterion] = t.thread('rl').criteria!;
  assert.match(await t.err('claim_criterion', { criterionId: 'nope', evidence: 'x' }), /get_goal lists them/);
  await t.ok('claim_criterion', { criterionId: criterion.id, evidence: 'curl -i shows Retry-After: 30' });
  assert.deepEqual(t.thread('rl').criteria![0].claim, { evidence: 'curl -i shows Retry-After: 30', at: t.state().now, by: 'claude' });
  await t.ok('report_turn', { decisions: ['Kept the old 429 body'], left: [], question: 'Switch the 429 body to JSON?' });
  const r = await t.ok('get_report', {}, 'adm');
  assert.equal(r.threadId, 'adm');
  const mine = await t.ok('get_report');
  assert.deepEqual([mine.criteria[0].claimed, mine.report.question, mine.report.decisions], ['curl -i shows Retry-After: 30', 'Switch the 429 body to JSON?', ['Kept the old 429 body']]);
});

test('open_pr pushes, then opens a PR whose body Mochi writes from the goal and its checks', async () => {
  const t = setup({ gitBranches: ['main', 'feat/rate-limit'], gitCurrent: 'feat/rate-limit' });
  t.env.dispatch({ type: 'edit-goal', threadId: 'rl', draft: { ...draftFrom(t.thread('rl')), criteria: [{ text: '429s carry Retry-After' }, { text: 'Tests pass', command: 'pnpm test' }] } });
  const [first] = t.thread('rl').criteria!;
  t.env.dispatch({ type: 'criterion-claim', threadId: 'rl', criterionId: first.id, evidence: 'curl -i shows it', by: 'claude' });
  const r = await t.ok('open_pr', { title: 'feat(api): rate limit keys by plan', why: 'Enterprise keys need higher limits.' });
  assert.equal(r.url, 'https://github.com/o/r/pull/9');
  assert.deepEqual(t.pushes, ['/repo/rl']);
  assert.equal(t.prs[0].title, 'feat(api): rate limit keys by plan');
  assert.equal(t.prs[0].body, ['## What', t.thread('rl').goal, '', '## Why', 'Enterprise keys need higher limits.', '', '## Checks', '- [x] 429s carry Retry-After: curl -i shows it', '- [x] Tests pass: `pnpm test` passed'].join('\n'));
});

test('open_pr runs the checks first and refuses on a failing one with the same reason the card shows; Open anyway lets it through, noted', async () => {
  const t = setup({ gitBranches: ['main', 'feat/rate-limit'], gitCurrent: 'feat/rate-limit', failing: ['pnpm test'] });
  t.env.dispatch({ type: 'edit-goal', threadId: 'rl', draft: { ...draftFrom(t.thread('rl')), criteria: [{ text: 'Tests pass', command: 'pnpm test' }] } });
  const [tests] = t.thread('rl').criteria!;
  t.env.dispatch({ type: 'criterion-claim', threadId: 'rl', criterionId: tests.id, evidence: 'all green', by: 'claude' });
  const refusal = await t.err('open_pr', { title: 'fix: x', why: 'y' });
  assert.match(refusal, /open_pr refused: 1 critical gap: Check fails: Tests pass \(ℹ fail 5\)\. Fix it, or ask the user to choose Open anyway/);
  assert.equal(t.thread('rl').criteria![0].check?.status, 'failed', 'the claim no longer counts');
  assert.deepEqual(t.pushes, []);
  t.env.dispatch({ type: 'idle-start', threadId: 'rl' });
  t.env.dispatch({ type: 'idle-update', threadId: 'rl', patch: { canOpenPr: true, audit: { unverified: [{ text: 'Not checked in the app', quote: "I haven't checked it in the app" }] } } });
  await t.ok('open_pr', { title: 'fix: x', why: 'y' });
  assert.match(t.prs[0].body, /## Not verified\n- \*\*Critical, opened anyway:\*\* Check fails: Tests pass\n- Not checked in the app \(agent: "I haven't checked it in the app"\)$/);
});

test('open_pr refuses a detached HEAD and the default branch, and pushes nothing', async () => {
  const detached = setup({ gitBranches: ['main'], gitCurrent: null });
  assert.match(await detached.err('open_pr', { title: 'fix: x', why: 'y' }), /detached HEAD/);
  const onMain = setup({ gitBranches: ['main'] });
  assert.match(await onMain.err('open_pr', { title: 'fix: x', why: 'y' }), /push straight to it/);
  assert.deepEqual([...detached.pushes, ...onMain.pushes], []);
});

test('propose_goal waits for Accept by default; Keep leaves the draft; Apply with undo sets it and Undo puts the draft back', async () => {
  const proposal = { goal: 'PR chips in a deleted worktree show live GitHub state', criteria: [{ text: 'Home folder reads PR state', command: 'pnpm test' }, { text: 'Chip #133 shows its state in the app' }], basis: 'refStates runs gh in the removed folder' };
  const t = setup();
  const draft = t.thread('rl').goal;
  const waiting = await t.ok('propose_goal', proposal);
  assert.match(waiting.status, /Waiting for the user/);
  assert.equal(t.thread('rl').goal, draft, 'nothing changes until you accept');
  t.env.dispatch({ type: 'goal-proposal', threadId: 'rl', decision: 'accept' });
  assert.equal(t.thread('rl').goal, proposal.goal);
  assert.deepEqual(
    t.thread('rl').criteria!.map((c) => [c.text, c.command]),
    [
      ['Home folder reads PR state', 'pnpm test'],
      ['Chip #133 shows its state in the app', undefined],
    ],
  );
  assert.match(await t.err('propose_goal', proposal), /already has the goal you proposed/);

  const kept = setup();
  await kept.ok('propose_goal', proposal);
  kept.env.dispatch({ type: 'goal-proposal', threadId: 'rl', decision: 'keep' });
  assert.deepEqual([kept.thread('rl').goal, kept.thread('rl').proposal?.state], [draft, 'kept']);

  const applied = setup();
  applied.env.prefs.set({ proposedGoals: 'apply' });
  const before = applied.thread('rl').criteria;
  assert.match((await applied.ok('propose_goal', proposal)).status, /Applied; the user can undo/);
  assert.equal(applied.thread('rl').goal, proposal.goal);
  applied.env.dispatch({ type: 'goal-proposal', threadId: 'rl', decision: 'undo' });
  assert.equal(applied.thread('rl').goal, draft);
  assert.deepEqual(applied.thread('rl').criteria?.map((c) => c.text) ?? [], before?.map((c) => c.text) ?? []);
});

test("a goal only Mochi drafted is flagged in get_goal, and claim_criterion and report_turn wait for propose_goal", async () => {
  const t = setup();
  const { id } = await t.ok('create_thread', { prompt: 'Something is off with sum' });
  t.env.dispatch({ type: 'goal-drafted', threadId: id, outcome: 'sum returns correct results', criteria: [{ text: 'Tests pass', command: 'npm test' }] });
  const drafted = await t.ok('get_goal', {}, id);
  assert.equal(drafted.isDraft, true);
  assert.match(drafted.next, /call propose_goal/);
  const [criterion] = t.thread(id).criteria!;
  assert.match(await t.err('claim_criterion', { criterionId: criterion.id, evidence: 'x' }, id), /^Call propose_goal first/);
  assert.match(await t.err('report_turn', { decisions: [], left: [] }, id), /^Call propose_goal first/);
  await t.ok('propose_goal', { goal: 'sum adds its arguments', criteria: [{ text: 'node sum.test.mjs prints ok', command: 'node sum.test.mjs' }] }, id);
  assert.equal((await t.ok('get_goal', {}, id)).isDraft, undefined, 'a proposal waiting on the user is enough');
  await t.ok('report_turn', { decisions: ['Fixed a - b'], left: [] }, id);
  t.env.dispatch({ type: 'edit-goal', threadId: 'rl', draft: draftFrom(t.thread('rl')) });
  assert.equal((await t.ok('get_goal')).isDraft, undefined, 'a goal you wrote is never a draft');
});
