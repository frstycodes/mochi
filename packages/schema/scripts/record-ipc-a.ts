// Records inputs and outputs of the account, browser, data, fs, git, library, notify, ports and pty namespaces from the web
// build's implementations of the same contract (`src/host/web/*`), for the schema round-trip tests. Run from the repo root:
// `node --import ./scripts/test-env.ts packages/schema/scripts/record-ipc-a.ts`. Outside the package's tsconfig on purpose.
import { writeFileSync } from 'node:fs';
import { account } from '../../../src/host/web/account.ts';
import { browser } from '../../../src/host/web/browser.ts';
import { data } from '../../../src/host/web/data.ts';
import { fs } from '../../../src/host/web/fs.ts';
import { git } from '../../../src/host/web/git.ts';
import { library } from '../../../src/host/web/library.ts';
import { notify } from '../../../src/host/web/notify.ts';
import { ports } from '../../../src/host/web/ports.ts';
import { pty } from '../../../src/host/web/pty.ts';

const hosts = { account, browser, data, fs, git, library, notify, ports, pty } as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>;
const cwd = '/repo';
const target = { path: 'apps/web/routes/admin/usage.tsx', staged: false };
const calls: Record<string, [string, unknown[]][]> = {
  account: [['get', []], ['signOut', []]],
  browser: [
    ['create', [{ url: 'https://example.com', spaceId: 'personal' }]],
    ['navigate', ['view-1', 'http://localhost:3000/']],
    ['command', ['view-1', 'reload']],
    ['setBounds', ['view-1', { x: 0, y: 40, width: 800, height: 600, radius: 8 }]],
    ['setBounds', ['view-1', null]],
    ['emulate', ['view-1', { width: 390, height: 844, scale: 0.8, dpr: 3, mobile: true, touch: true, colorScheme: 'dark', reducedMotion: false }]],
    ['act', ['view-1', { kind: 'click', ref: 'g1-e3' }]],
    ['act', ['view-1', { kind: 'scroll', dx: 0, dy: 400 }]],
    ['waitFor', ['view-1', { text: 'Done', timeoutMs: 1000 }]],
    ['scroll', ['view-1', { x: 0, y: 120 }]],
    ['find', ['view-1', 'usage', { forward: true, isNewSearch: true, matchCase: false }]],
    ['menuCommand', ['view-1', 'copy', { x: 10, y: 20 }]],
    ['logs', ['view-1']],
    ['snapshot', ['view-1']],
    ['suggest', ['duckduckgo', 'effect schema']],
    ['defaultBrowser', []],
  ],
  data: [['load', []], ['save', ['{"v":1}', { t1: '{"thread":{}}' }]], ['loadReplay', ['t1']], ['appendReplay', ['t1', '{"at":1}\n']], ['replayUsage', []], ['clearReplays', [['t1']]], ['clearReplays', []]],
  fs: [['list', [cwd]], ['read', [cwd, 'package.json']], ['write', [cwd, 'a.ts', 'export {};\n', { baseMtimeMs: 0 }]], ['search', [cwd, 's1', 'usage', { isCaseSensitive: false, isRegex: false, isWholeWord: false }]], ['editors', []], ['pickFolder', ['~/code']], ['folders', ['~']], ['entries', ['~']]],
  git: [
    ['status', [cwd]],
    ['diff', [cwd, 'uncommitted']],
    ['diff', [cwd, 'branch', 'main']],
    ['stage', [cwd, target]],
    ['commit', [cwd, 'feat(admin): usage page']],
    ['push', [cwd, 'octocat']],
    ['createPr', [cwd, { title: 'Usage page', body: 'Adds it.', base: 'main' }, 'ghe.example.com/octocat']],
    ['pr', [cwd]],
    ['worktreePrs', [[cwd]]],
    ['prReview', [cwd, 42]],
    ['refStates', [cwd, [{ owner: 'latitude', repo: 'app', number: 42, kind: 'pr' }]]],
    ['ghAccounts', []],
    ['sync', [cwd]],
    ['addWorktree', [cwd, 't-1', 'feat/usage', { base: 'main' }]],
    ['branches', [cwd]],
    ['branchNameError', [cwd, 'feat/usage']],
    ['switchBranch', [cwd, 'main', { changes: 'stash' }]],
    ['worktrees', [cwd]],
    ['head', [cwd]],
    ['checkpoint', [cwd, 't-1', 'turn']],
    ['checkpoint', [cwd, 't-1', 3]],
    ['restoreFiles', [cwd, 't-1', 'undo', ['a.ts']]],
    ['rewindPreview', [cwd, 't-1', 2]],
    ['turnDiff', [cwd, 'a'.repeat(40)]],
    ['runCheck', [cwd, 'pnpm test']],
    ['repoSlug', [cwd]],
  ],
  library: [
    ['list', ['personal']],
    ['setEnabled', ['personal', 'skill-1', true]],
    ['importFromAccount', ['personal', 'claude', ['skills', 'mcp']]],
    ['discoverSkills', ['anthropics/skills']],
    ['installSkill', ['personal', 'anthropics/skills', 'pdf', { scope: 'user', providers: ['claude'] }]],
    ['searchSkillsSh', ['react']],
    ['popularSkillsSh', []],
    ['marketplaces', []],
    ['marketplaceCatalog', ['claude-plugins-official']],
    ['addConnector', ['personal', { url: 'https://mcp.example.com/mcp', alias: 'work' }, { inPane: true }]],
    ['oauthApps', []],
    ['connectorSettings', []],
    ['listConnectorTools', ['example']],
    ['setConnectorSettings', ['example', { isOff: false, tools: { search: 'allow' } }]],
    ['runSetup', ['slack', 'view-1', { params: { workspace: 'acme' } }]],
    ['updateSetupStep', ['slack', 'create-app', { role: 'button', name: 'Create App', within: { role: 'dialog' } }]],
  ],
  notify: [
    ['show', [{ title: 'Done', body: 'The tests pass', id: 'n1' }]],
    ['close', [['n1']]],
    ['addressed', [{ threadId: 't1', isViewed: true }]],
    ['watch', [{ threads: [{ id: 't1', title: 'Usage page', cwd, githubUser: 'octocat' }], autofix: [{ threadId: 't1', title: 'Usage page', pr: 42, cwd, since: 1_760_000_000_000 }], kinds: ['done'], quiet: { isOn: true, start: 22, end: 7 }, muted: [], needsYou: ['t1'], dockBadge: true }]],
    ['pendingOpen', []],
    ['permission', []],
  ],
  ports: [['list', [[cwd]]], ['kill', [4321]], ['allocate', ['t1']], ['targets', [cwd]]],
  pty: [['spawn', [{ cwd, cols: 80, rows: 24, command: 'pnpm dev', port: 5300, threadId: 't1' }]], ['write', ['pty-1', 'ls\r']], ['resize', ['pty-1', 120, 40]], ['kill', ['pty-1']]],
};

const timeout = () => new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 500));
const recorded: Record<string, { method: string; input: unknown[]; output?: unknown }[]> = {};
for (const [ns, list] of Object.entries(calls)) {
  recorded[ns] = [];
  for (const [method, input] of list) {
    const output = await Promise.race([hosts[ns][method](...input), timeout()]).then(
      (value) => ({ value }),
      (error: Error) => (console.log(`${ns}.${method}: ${error.message}`), null),
    );
    // JSON drops `undefined` keys, as IPC's structured clone keeps them; outputs here are JSON-shaped.
    recorded[ns].push({ method, input, ...(output && output.value !== undefined && { output: JSON.parse(JSON.stringify(output.value)) }) });
  }
}
writeFileSync(new URL('../fixtures/ipc-a.json', import.meta.url), `${JSON.stringify(recorded, null, 1)}\n`);
console.log(Object.entries(recorded).map(([k, v]) => `${k}: ${v.length} calls, ${v.filter((c) => 'output' in c).length} outputs`).join('\n'));
process.exit(0);
