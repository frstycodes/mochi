// Records sample calls of the projects, remote, schedule, sim, themes, usage and windows namespaces for the schema
// round-trip tests: outputs from the web build's hosts (`src/host/web/*`), inputs and refusals from main's own tests
// (`packages/schema/src/relay.test.ts`, `electron/ipc/*`). Run from the repo root:
// `node --import ./scripts/test-env.ts packages/schema/scripts/record-ipc-b.ts`.
import { writeFileSync } from 'node:fs';
import { projects } from '../../../src/host/web/projects.ts';
import { remote } from '../../../src/host/web/remote.ts';
import { schedule } from '../../../src/host/web/schedule.ts';
import { sim } from '../../../src/host/web/sim.ts';
import { usage } from '../../../src/host/web/usage.ts';
import { windows } from '../../../src/host/web/windows.ts';
import { customTheme } from '../../../src/themes/custom.ts';

type Call = { input?: unknown[]; output?: unknown; event?: unknown };
const calls: Record<string, Call[]> = {};
const add = (key: string, call: Call) => (calls[key] ??= []).push(JSON.parse(JSON.stringify(call)));
async function record<A extends unknown[], R>(key: string, method: (...args: A) => Promise<R>, ...input: A) {
  const output = await method(...input);
  add(key, { input, ...(output !== undefined && { output }) });
  return output;
}

// projects
const progress: unknown[] = [];
const changes: unknown[] = [];
projects.onProgress((p) => progress.push(p));
projects.onChange((s) => changes.push(s));
await record('projects.migrate', projects.migrate, 'personal', ['/Users/me/code/mochi', '/Users/me/code/site']);
const added = await record('projects.addFolder', projects.addFolder, 'personal', '/Users/me/code/notes');
await record('projects.clone', projects.clone, 'personal', { github: 'frstycodes/mochi' }, { parentDir: '/Users/me/code', opId: 'op1', githubUser: 'octo' });
await record('projects.clone', projects.clone, 'personal', { url: 'https://github.com/frstycodes/agent-skills.git' }, { parentDir: '/Users/me/code', opId: 'op2' });
await record('projects.create', projects.create, 'personal', 'scratch', { parentDir: '/Users/me/code', publish: 'private', githubUser: 'ghe.acme.com/alice_acme' });
await record('projects.rename', projects.rename, 'personal', added.id, 'Notes');
await record('projects.relocate', projects.relocate, 'personal', added.id, '/Users/me/notes');
await record('projects.setIcon', projects.setIcon, 'personal', added.id, 'data:image/png;base64,iVBORw0KGgo=');
await record('projects.list', projects.list, 'personal');
await record('projects.remove', projects.remove, 'personal', added.id);
await record('projects.githubRepos', projects.githubRepos);
await record('projects.githubRepos', projects.githubRepos, 'octo');
for (const event of progress.slice(0, 2)) add('projects.onProgress', { event });
add('projects.onChange', { event: changes[0] });

// remote: the web host is off; a live status and the protocol test's commands fill in the rest
await record('remote.status', remote.status);
await record('remote.removeMember', remote.removeMember, 'd-laptop');
await record('remote.setDeviceScopes', remote.setDeviceScopes, 'd-laptop', ['read', 'operate']);
await record('remote.otherMachines', remote.otherMachines);
await record('remote.machines', remote.machines);
await record('remote.cachedMachines', remote.cachedMachines);
await record('remote.answerApproval', remote.answerApproval, 'a1', true);
await record('remote.cacheMachine', remote.cacheMachine, 'm1', '{}');
await record('remote.commandResult', remote.commandResult, 'c1', { isOk: true, detail: 'a1b2c3d' });
await record('remote.commandResult', remote.commandResult, 'c2', { isOk: false, error: 'No such thread' });
await record('remote.commandResult', remote.commandResult, 'c3', { isOk: true, data: { terminalId: 'p1' } });
await record('remote.commandResult', remote.commandResult, 'c4', { isOk: true, data: { data: '$ ls\n', next: 5 } });
await record('remote.commandResult', remote.commandResult, 'c5', { isOk: true, data: { projects: [{ ref: 'p1', name: 'mochi' }], models: {}, defaults: { claude: '', codex: '' } } });
const controls = { model: 'claude-opus-5-5', effort: 'high', speed: '', access: 'Auto' };
const commands = [
  { type: 'catalog' },
  { type: 'settings' },
  { type: 'projects' },
  { type: 'send', threadId: 't', text: 'Run the tests' },
  { type: 'resolve', queueId: 'q', answers: [['Yes'], []] },
  { type: 'interrupt', threadId: 't' },
  { type: 'fork', threadId: 't', point: { kind: 'checkpoint', n: 2 } },
  { type: 'handoff', threadId: 't', to: 'codex' },
  { type: 'rewind', threadId: 't', point: { kind: 'message', index: 2 }, mode: 'files' },
  { type: 'side-chat', threadId: 't', text: 'why?' },
  { type: 'seen', queueIds: ['q1', 'q2'] },
  { type: 'create', title: 'Fix login', provider: 'codex', project: null },
  { type: 'create', title: 'x', provider: 'claude', project: 'ref', controls, images: [{ mediaType: 'image/png', data: 'iVBORw0KGgo=', thumb: 'data:image/png;base64,iVBORw0KGgo=' }] },
  { type: 'rename', threadId: 't', title: 'Login fix' },
  { type: 'edit-goal', threadId: 't', goal: 'Login works with SSO' },
  { type: 'pin', threadId: 't', isPinned: true, order: 1.5 },
  { type: 'settle', threadId: 't', isSettled: true },
  { type: 'schedule', threadId: 't', action: 'pause' },
  { type: 'commit', threadId: 't', message: 'fix(auth): refresh the token' },
  { type: 'push', threadId: 't' },
  { type: 'open-pr', threadId: 't', title: 'Fix', body: '' },
  { type: 'delete', threadId: 't' },
  { type: 'add-project', name: 'scratch', publish: 'public' },
  { type: 'clone-project', source: { github: 'frstycodes/mochi' } },
  { type: 'setting', key: 'shell', value: 'zsh' },
  { type: 'diff', threadId: 't', scope: 'branch' },
  { type: 'checkpoint-diff', threadId: 't', n: 0 },
  { type: 'change', threadId: 't', action: 'revert', target: { path: 'src/a.ts', staged: false, patch: '@@' } },
  { type: 'comment', threadId: 't', path: 'src/a.ts', side: 'additions', line: 1, text: 'Rename this' },
  { type: 'files', threadId: 't' },
  { type: 'read-file', threadId: 't', path: 'src/a.ts' },
  { type: 'terminal-open', threadId: 't', cols: 80, rows: 24 },
  { type: 'terminal-write', threadId: 't', terminalId: 'p', data: 'ls\n' },
  { type: 'terminal-resize', threadId: 't', terminalId: 'p', cols: 120, rows: 40 },
  { type: 'terminal-read', threadId: 't', terminalId: 'p', after: 0 },
  { type: 'terminal-close', threadId: 't', terminalId: 'p' },
];
for (const command of commands) await record('remote.command', remote.command, 'm1', command as never);
add('remote.onCommand', { event: { id: 'c1', deviceName: 'Laptop', command: commands[3] } });
add('remote.onMachineFrame', { event: { machineId: 'm1', frame: { type: 'reset' } } });
add('remote.onMachineFrame', { event: { machineId: 'm1', frame: { type: 'thread', threadId: 't1', saved: { thread: { id: 't1' } } } } });
add('remote.onMachineFrame', { event: { machineId: 'm1', frame: { type: 'thread', threadId: 't1', saved: null } } });
add('remote.onMachines', { event: [{ id: 'm1', name: 'Studio', kind: 'mac', status: 'online', route: 'lan', scopes: ['read', 'operate', 'manage', 'code'], lastSeenAt: 1_760_000_000_000 }, { id: 'm2', name: 'Laptop', status: 'refused', scopes: [], error: 'This computer removed you' }] });
const status = await remote.status();
add('remote.set', { input: [{ isEnabled: true, machineName: 'Studio' }], output: { ...status, settings: { ...status.settings, isEnabled: true, machineName: 'Studio' }, addresses: ['127.0.0.1:47123'], relay: { status: 'error', error: 'Sign in to reach this computer from anywhere' } } });
add('remote.onStatus', { event: { ...status, devices: [{ id: 'd-laptop', name: 'Laptop', kind: 'mac', scopes: ['read'], connectedAt: 1_760_000_000_000 }], members: [{ id: 'd-laptop', name: 'Laptop', scopes: ['read', 'operate'], addedAt: 1_760_000_000_000, machineStatus: 'online' }], error: 'Port 47123 is taken' } });
add('remote.join', { input: ['m2'] });
add('remote.follow', { input: [] });
add('remote.onApproval', { event: { id: 'a1', name: 'Laptop', pairingCode: '123456', expiresAt: 1_760_000_060_000 } });

// schedule
const triggerLists: unknown[] = [];
schedule.onChange((triggers) => triggerLists.push(triggers));
const start = { provider: 'claude', spaceId: 'personal', cwd: '/Users/me/code/mochi', workspace: { mode: 'worktree', branch: 'mochi/nightly', isNew: true }, model: 'claude-opus-5-5', effort: 'high', permissionMode: 'acceptEdits' };
await record('schedule.set', schedule.set, { threadId: 't1', name: 'Nightly deps', prompt: 'Update dependencies and run the tests', when: { kind: 'cron', cron: '0 2 * * *' }, missed: 'run-once', start } as never);
await record('schedule.set', schedule.set, { threadId: 't2', name: 'PR review', prompt: 'Review the PR', when: { kind: 'pr', event: 'opened', branch: 'feat/*' }, missed: 'skip', start: { ...start, cwd: null, workspace: undefined }, githubUser: 'octo', sessionId: 's1' } as never);
await record('schedule.setPaused', schedule.setPaused, 't2', true);
await record('schedule.list', schedule.list);
await record('schedule.remove', schedule.remove, 't2');
await record('schedule.drain', schedule.drain);
add('schedule.onChange', { event: triggerLists[0] });
add('schedule.runNow', { input: ['t1'] });
const run = { id: 'r1', threadId: 't1', reason: 'Every day at 02:00', startedAt: 1_760_000_000_000, status: 'running' };
add('schedule.onEvent', { event: { type: 'run-start', run, name: 'Nightly deps', prompt: 'Update dependencies' } });
add('schedule.onEvent', { event: { type: 'run-end', run: { ...run, status: 'limited', endedAt: 1_760_000_100_000, resetsAt: '2026-10-23T02:00:00Z' }, name: 'Nightly deps' } });
add('schedule.onEvent', { event: { type: 'ci', threadId: 't1', result: { pr: 12, url: 'https://github.com/o/r/pull/12', status: 'fail', failed: [{ name: 'lint', state: 'fail', link: 'https://github.com/o/r/runs/1' }] } } });
add('schedule.onEvent', { event: { type: 'autofix', threadId: 't1', event: { kind: 'conflict', pr: 12, url: 'https://github.com/o/r/pull/12', head: 'abc123' } } });
add('schedule.onEvent', { event: { type: 'agent', event: { v: 1, threadId: 't1', type: 'turn-end', status: 'done' } } });

// sim (frames carry bytes, so the test builds its own)
await record('sim.list', sim.list);
const udid = 'A1B2C3D4-0000-4000-8000-000000000001';
await record('sim.boot', sim.boot, udid);
await record('sim.stream', sim.stream, udid);
await record('sim.touch', sim.touch, udid, 'down', 0.5, 0.25);
await record('sim.button', sim.button, udid, 'home');
await record('sim.type', sim.type, udid, 'hello');
await record('sim.key', sim.key, udid, 42);
await record('sim.openUrl', sim.openUrl, udid, 'myapp://settings');
await record('sim.setAppearance', sim.setAppearance, udid, 'dark');
await record('sim.appearance', sim.appearance, udid);
await record('sim.setContentSize', sim.setContentSize, udid, 'accessibility-large');
await record('sim.contentSize', sim.contentSize, udid);
await record('sim.screenshot', sim.screenshot, udid);
await record('sim.startRecording', sim.startRecording, udid);
await record('sim.stopRecording', sim.stopRecording, udid);
await record('sim.stopStream', sim.stopStream, udid);
await record('sim.shutdown', sim.shutdown, udid);
add('sim.buildAndRun', { input: [udid, '/Users/me/code/app'], output: { bundleId: 'com.example.app' } });
add('sim.onBuildLog', { event: { udid, text: '** BUILD SUCCEEDED **' } });

// themes: a custom theme as main parses one, and a marketplace one as Open VSX hands it over
const custom = customTheme('night-owl.json', JSON.stringify({ name: 'Night Owl', type: 'dark', colors: { 'editor.background': '#011627' }, tokenColors: [{ scope: ['comment'], settings: { foreground: '#637777', fontStyle: 'italic' } }, { scope: 'string', settings: { foreground: '#ecc48d' } }] }));
const marketplace = { id: 'ext:dracula-theme.theme-dracula:Dracula', label: 'Dracula', kind: 'dark', source: { kind: 'marketplace', namespace: 'dracula-theme', name: 'theme-dracula', version: '2.25.1', displayName: 'Dracula Official', publisher: 'Dracula Theme' }, theme: { name: 'Dracula', colors: { 'editor.background': '#282a36' }, tokenColors: [], semanticHighlighting: true } };
add('themes.list', { input: [], output: [{ id: 'mochi', label: 'Mochi', kind: 'light', source: { kind: 'mochi' }, theme: { colors: {}, tokenColors: [] } }, marketplace, custom] });
add('themes.search', { input: ['dracula', 0], output: { total: 2, extensions: [{ namespace: 'dracula-theme', name: 'theme-dracula', version: '2.25.1', displayName: 'Dracula Official', description: 'Official Dracula Theme', downloadCount: 120_000, iconUrl: 'https://open-vsx.org/api/dracula-theme/theme-dracula/2.25.1/file/icon.png', themes: [{ label: 'Dracula', kind: 'dark' }] }] } });
add('themes.inspect', { input: ['dracula-theme', 'theme-dracula', '2.25.1', 'Dracula Official'], output: [marketplace] });
add('themes.install', { input: ['dracula-theme', 'theme-dracula', '2.25.1', 'Dracula Official'], output: [marketplace] });
add('themes.uninstall', { input: ['dracula-theme', 'theme-dracula'] });
add('themes.importFile', { input: [], output: null });
add('themes.saveCustom', { input: ['{"name":"Night Owl","colors":{},"tokenColors":[]}'], output: custom });
add('themes.saveCustom', { input: ['{"name":"Night Owl","colors":{},"tokenColors":[]}', 'night-owl.json'], output: custom });
add('themes.readCustom', { input: ['night-owl.json'], output: '{}' });
add('themes.openCustom', { input: ['night-owl.json'] });
add('themes.removeCustom', { input: ['night-owl.jsonc'] });

// usage
const query = { roots: ['/Users/me/code/mochi'], repos: ['/Users/me/code/mochi'], since: null, githubUser: 'octo' };
const week = await usage.report(query);
// The demo week has hundreds of commits; a few of each kind show the shape.
add('usage.report', { input: [query], output: { ...week, tokens: week.tokens.slice(0, 4), commits: week.commits.slice(0, 3), prs: week.prs.slice(0, 3) } });
add('usage.report', { input: [{ roots: [], repos: [], since: 1_760_000_000_000 }], output: { tokens: [{ day: '2026-10-21', harness: 'codex', model: 'unpriced', root: '/r', input: 1, output: 2, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, cost: null, uncached: null }], sessions: [], commits: [], prs: [{ repo: '/r', number: 3, state: 'OPEN', createdAt: 1, mergedAt: null }], errors: ['Pull requests in /r: gh is logged out'] } });

// windows
await record('windows.isFullScreen', windows.isFullScreen);
await record('windows.zoomFactor', windows.zoomFactor);
await record('windows.listApps', windows.listApps);
add('windows.listApps', { input: [], output: { access: 'granted', windows: [{ id: '1234', title: 'Simulator', app: 'Simulator', icon: 'data:image/png;base64,iVBORw0KGgo=' }, { id: 'window:42:0', title: 'Untitled' }] } });
await record('windows.captureApp', windows.captureApp, '1234');
add('windows.captureApp', { input: ['1234'], output: { mediaType: 'image/jpeg', data: '/9j/4AAQ' } });
add('windows.open', { input: ['window/t1'] });
add('windows.broadcast', { input: [{ type: 'focus', threadId: 't1' }] });
add('windows.showAppMenu', { input: [12, 40] });
add('windows.setAppearance', { input: ['dark'] });
add('windows.resetZoom', { input: [] });
add('windows.openScreenRecordingSettings', { input: [] });
add('windows.onFullScreenChange', { event: true });
add('windows.onMessage', { event: { type: 'focus', threadId: 't1' } });

// Inputs main refuses today: the protocol test's malformed commands and each handler's checks.
const rejected: Record<string, unknown[][]> = {
  'projects.rename': [['personal', 'p1', '   '], ['personal', 'p1', 'x'.repeat(101)]],
  'projects.create': [['personal', 'x', { parentDir: '/a', publish: 'internal' }]],
  'projects.clone': [['personal', { path: '/a' }, { parentDir: '/a', opId: 'o' }], ['personal', { github: 'x' }, { parentDir: '/a', opId: 'o', githubUser: 'a b' }]],
  'projects.migrate': [['personal', Array.from({ length: 1001 }, () => '/a')]],
  'remote.command': [
    { type: 'fork', threadId: 't', point: { kind: 'message', index: -1 } },
    { type: 'handoff', threadId: 't', to: 'gpt' },
    { type: 'create', title: '   ', provider: 'claude', project: null },
    { type: 'create', title: 'x', provider: 'claude' },
    { type: 'rename', threadId: 't', title: 'x'.repeat(300) },
    { type: 'pin', threadId: 't', isPinned: 'yes' },
    { type: 'schedule', threadId: 't', action: 'delete' },
    { type: 'commit', threadId: 't', message: '' },
    { type: 'rm', threadId: 't' },
    { type: 'read-file', threadId: 't', path: '/etc/passwd' },
    { type: 'read-file', threadId: 't', path: 'C:/Windows/win.ini' },
    { type: 'read-file', threadId: 't', path: 'src\\..\\..\\secret' },
    { type: 'read-file', threadId: 't', path: 'src/../../secret' },
    { type: 'read-file', threadId: 't', path: '' },
    { type: 'change', threadId: 't', action: 'delete', target: { path: 'a', staged: false } },
    { type: 'change', threadId: 't', action: 'stage', target: { path: 'a' } },
    { type: 'comment', threadId: 't', path: 'a', side: 'left', line: 1, text: 'x' },
    { type: 'diff', threadId: 't', scope: 'all' },
    { type: 'checkpoint-diff', threadId: 't', n: -1 },
    { type: 'terminal-open', threadId: 't', cols: 0, rows: 24 },
    { type: 'terminal-open', threadId: 't', cols: 80, rows: 1e6 },
    { type: 'terminal-write', threadId: 't', terminalId: 'p', data: '' },
    { type: 'rewind', threadId: 't', point: { kind: 'message', index: 1 }, mode: 'everything' },
    { type: 'side-chat', threadId: 't', text: '  ' },
    { type: 'setting', key: '', value: 'x' },
    { type: 'seen' },
    { type: 'create', title: 'x', provider: 'claude', project: null, controls: { model: 'opus', effort: 'high', speed: '', access: 'Root' } },
    { type: 'create', title: 'x', provider: 'claude', project: null, images: [{ mediaType: 'image/svg+xml', data: 'x', thumb: 'x' }] },
    { type: 'create', title: 'x', provider: 'claude', project: null, images: Array.from({ length: 9 }, () => ({ mediaType: 'image/png', data: 'x', thumb: 'x' })) },
    { type: 'clone-project', source: { url: '--upload-pack=touch /tmp/x' } },
    { type: 'add-project', name: '..' },
    { type: 'delete' },
    { type: 'pin', threadId: 't', isPinned: true, order: 'first' },
    { type: 'pin', threadId: 't', isPinned: true, order: null },
  ].map((command) => ['m1', command]),
  'remote.set': [[{ machineName: 'x'.repeat(65) }], [{ isEnabled: 'yes' }]],
  'remote.setDeviceScopes': [['d1', ['read', 'root']]],
  'schedule.set': [
    [{ threadId: 't', name: 'n', prompt: 'p', when: { kind: 'hourly' }, missed: 'skip', start }],
    [{ threadId: 't', name: 'n', prompt: 'p', when: { kind: 'pr', event: 'merged' }, missed: 'skip', start }],
    [{ threadId: 't', name: 'n', prompt: 'p', when: { kind: 'cron', cron: '0 2 * * *' }, missed: 'always', start }],
    [{ threadId: 't', name: 'x'.repeat(201), prompt: 'p', when: { kind: 'cron', cron: '0 2 * * *' }, missed: 'skip', start }],
  ],
  'schedule.setPaused': [['t', 'yes']],
  'sim.boot': [['not-a-udid'], ['-rf']],
  'sim.touch': [[udid, 'down', 1.5, 0]],
  'sim.key': [[udid, 300], [udid, 4.5]],
  'sim.openUrl': [[udid, '-flag'], [udid, 'not a url']],
  'sim.setContentSize': [[udid, 'huge']],
  'themes.inspect': [['../etc', 'x', '1.0.0', 'X'], ['ns', 'x', '1.0.0 ; rm', 'X']],
  'themes.readCustom': [['../secret.json'], ['theme.txt']],
  'themes.search': [['x', -1], ['x', 1.5]],
  'usage.report': [[{ roots: Array.from({ length: 513 }, () => '/a'), repos: [], since: null }], [{ roots: [], repos: [], since: 'yesterday' }]],
  'windows.open': [['window/t1?x=1'], ['window t1'], ['x'.repeat(201)]],
  'windows.broadcast': [['hello'], [[1, 2]]],
  'windows.showAppMenu': [[-1, 0], [1.5, 2]],
  'windows.setAppearance': [['sepia']],
};

writeFileSync(new URL('../fixtures/ipc-b.json', import.meta.url), `${JSON.stringify({ calls, rejected }, null, 1)}\n`);
console.log(Object.entries(calls).map(([k, v]) => `${k}: ${v.length}`).join(', '));
