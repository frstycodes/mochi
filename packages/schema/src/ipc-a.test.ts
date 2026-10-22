import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Schema } from 'effect';
import { accountRpc } from './ipc/account.ts';
import { browserRpc, BrowserEvent } from './ipc/browser.ts';
import { dataRpc } from './ipc/data.ts';
import { FileContent, fsRpc } from './ipc/fs.ts';
import { gitRpc } from './ipc/git.ts';
import { libraryRpc, SetupResult } from './ipc/library.ts';
import { notifyRpc } from './ipc/notify.ts';
import { portsRpc } from './ipc/ports.ts';
import { ptyRpc } from './ipc/pty.ts';

type Method = { input: Schema.Top; output: Schema.Top } | { event: Schema.Top };
const rpcs: Record<string, Record<string, Method>> = { account: accountRpc, browser: browserRpc, data: dataRpc, fs: fsRpc, git: gitRpc, library: libraryRpc, notify: notifyRpc, ports: portsRpc, pty: ptyRpc };
const recorded: Record<string, { method: string; input: unknown[]; output?: unknown }[]> = JSON.parse(readFileSync(new URL('../fixtures/ipc-a.json', import.meta.url), 'utf8'));

const roundTrip = (schema: Schema.Top, value: unknown) => {
  const decoded = Schema.decodeUnknownSync(schema as Schema.Codec<unknown, unknown>)(value);
  assert.deepEqual(Schema.encodeUnknownSync(schema as Schema.Codec<unknown, unknown>)(decoded), value);
};

test('recorded inputs and outputs of the web host decode and encode back', () => {
  for (const [ns, calls] of Object.entries(recorded))
    for (const { method, input, output } of calls) {
      const rpc = rpcs[ns][method];
      assert.ok(rpc && 'input' in rpc, `${ns}.${method}`);
      roundTrip(rpc.input, input);
      if (output !== undefined) roundTrip(rpc.output, output);
    }
});

test('push payloads decode', () => {
  const events: [Method, unknown][] = [
    [browserRpc.onEvent, { id: 'view-1', type: 'state', url: 'https://example.com/', title: 'Example', isLoading: false, canGoBack: true, canGoForward: false, error: null, favicon: null }],
    [browserRpc.onEvent, { id: 'view-1', type: 'dialog', kind: 'confirm', message: 'Leave?' }],
    [browserRpc.onEvent, { id: 'view-1', type: 'dialog', kind: null }],
    [browserRpc.onEvent, { id: 'view-1', type: 'download', name: 'a.zip', path: '/Users/me/Downloads/a.zip', state: 'progress', received: 10, total: 0 }],
    [fsRpc.onSearchHits, { id: 's1', path: 'a.ts', lines: [{ line: 3, text: 'usage()', isCut: false, ranges: [[0, 5]], column: [2, 7] }] }],
    [fsRpc.onChange, { root: '/repo', path: 'a.ts' }],
    [ptyRpc.onData, { id: 'pty-1', data: '$ ' }],
    [ptyRpc.onExit, { id: 'pty-1', exitCode: 0 }],
    [libraryRpc.onDeviceCode, { url: 'https://api.githubcopilot.com/mcp', userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' }],
    [accountRpc.onChange, { status: 'signed-in', user: { id: 'u1', name: 'Ada', email: null, imageUrl: null }, isPersistent: true }],
    [notifyRpc.onOpenThread, 't1'],
  ];
  for (const [rpc, payload] of events) roundTrip((rpc as { event: Schema.Top }).event, payload);
  roundTrip(SetupResult, { status: 'stopped', stepId: 's2', note: 'Create the app', kind: 'click', target: { role: 'button', name: 'Create', within: { role: 'dialog' } }, reason: 'No permission', params: {}, isExpected: true });
});

test('binary file content keeps its bytes', () => {
  const file = { kind: 'binary', bytes: new Uint8Array([137, 80, 78, 71]), mtimeMs: 1 };
  assert.deepEqual(Schema.decodeUnknownSync(FileContent)(file), file);
});

test('inputs main refuses today are refused', () => {
  const refuses = (rpc: Method, input: unknown[]) => assert.throws(() => Schema.decodeUnknownSync((rpc as { input: Schema.Top }).input as Schema.Codec<unknown, unknown>)(input));
  refuses(browserRpc.navigate, ['view-1', 'javascript:alert(1)']);
  refuses(browserRpc.navigate, ['tab-1', 'https://example.com']);
  refuses(browserRpc.openExternal, ['file:///etc/passwd']);
  refuses(browserRpc.act, ['view-1', { kind: 'click', ref: '#submit' }]);
  refuses(browserRpc.act, ['view-1', { kind: 'upload', ref: 'g1-e2', path: 'relative/file.txt' }]);
  refuses(browserRpc.setZoom, ['view-1', 9]);
  refuses(browserRpc.setZoom, ['view-1', Number.NaN]);
  refuses(browserRpc.create, [{ url: 'https://example.com', spaceId: '../escape' }]);
  refuses(gitRpc.replyThread, ['/repo', 'PRRT_1; rm -rf', 'hi']);
  refuses(gitRpc.push, ['/repo', 'not a login']);
  refuses(gitRpc.turnDiff, ['/repo', 'HEAD']);
  refuses(gitRpc.restoreFiles, ['/repo', 't1', 1, []]);
  refuses(gitRpc.addWorktree, ['/repo', '../t1', 'feat/x']);
  refuses(gitRpc.commentPr, ['/repo', 0, 'hi']);
  refuses(gitRpc.commit, ['/repo', '  ']);
  refuses(dataRpc.loadReplay, ['../../etc/passwd']);
  refuses(dataRpc.saveImage, ['image/svg+xml', 'PHN2Zz4=']);
  refuses(fsRpc.openIn, ['notepad', '/repo', 'a.ts']);
  refuses(fsRpc.openIn, ['vscode', '/repo', 'a.ts', 0]);
  refuses(fsRpc.write, ['/repo', 'a.ts', 'x', { baseMtimeMs: Number.POSITIVE_INFINITY }]);
  refuses(ptyRpc.spawn, [{ cwd: '/repo', cols: 0, rows: 24, threadId: 't1' }]);
  refuses(ptyRpc.spawn, [{ cwd: '/repo', cols: 80, rows: 24, port: 80, threadId: 't1' }]);
  refuses(portsRpc.kill, [1]);
  refuses(libraryRpc.addConnector, ['personal', { url: 'http://example.com/mcp', alias: 'work' }]);
  refuses(libraryRpc.addConnector, ['personal', { url: 'https://example.com/mcp', alias: 'Work Account' }]);
  refuses(libraryRpc.importFromAccount, ['personal', 'claude', []]);
  refuses(libraryRpc.setConnectorSettings, ['k', { tools: { search: 'always' } }]);
  refuses(libraryRpc.runSetup, ['slack', 'view-1', { params: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`p${i}`, 'x'])) }]);
  refuses(libraryRpc.reviewUpload, [{ name: 'a.zip', bytes: new Uint8Array(20_000_001) }]);
  refuses(notifyRpc.watch, [{ threads: [], autofix: [], kinds: [], quiet: { isOn: true, start: 24, end: 7 }, muted: [], needsYou: [], dockBadge: false }]);
  refuses(notifyRpc.show, [{ title: 'x'.repeat(201) }]);
});

test('BrowserEvent tells the two dialog events apart', () => {
  const closed = Schema.decodeUnknownSync(BrowserEvent)({ id: 'view-1', type: 'dialog', kind: null });
  assert.deepEqual(closed, { id: 'view-1', type: 'dialog', kind: null });
});
