import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Schema } from 'effect';
import { CommandResult, DeviceLinkFrame, HelloFrame, MachineLinkFrame, RemoteCommand } from './relay.ts';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/relay.json', import.meta.url), 'utf8'));
const decode = Schema.decodeUnknownSync(RemoteCommand);
const isRefused = (command: unknown) => Schema.decodeUnknownOption(RemoteCommand)(command)._tag === 'None';

test('recorded commands and frames round-trip', () => {
  for (const command of fixtures.commands) {
    assert.deepEqual(decode(command), command);
    assert.deepEqual(Schema.encodeSync(RemoteCommand)(decode(command)), command);
  }
  for (const hello of fixtures.hello) assert.deepEqual(Schema.decodeUnknownSync(HelloFrame)(hello), hello);
  for (const frame of fixtures.machineFrames) assert.deepEqual(Schema.encodeSync(MachineLinkFrame)(Schema.decodeUnknownSync(MachineLinkFrame)(frame)), frame);
  for (const result of fixtures.results) assert.deepEqual(Schema.encodeSync(CommandResult)(Schema.decodeUnknownSync(CommandResult)(result)), result);
});

test('commands keep only their own fields, and titles come back trimmed', () => {
  assert.deepEqual(decode({ type: 'fork', threadId: 't', point: { kind: 'checkpoint', n: 2 }, extra: 1 }), { type: 'fork', threadId: 't', point: { kind: 'checkpoint', n: 2 } });
  assert.deepEqual(decode({ type: 'create', title: '  Fix login  ', provider: 'codex', project: null }), { type: 'create', title: 'Fix login', provider: 'codex', project: null });
  assert.deepEqual(decode({ type: 'catalog', extra: 1 }), { type: 'catalog' });
  assert.deepEqual(decode({ type: 'change', threadId: 't', action: 'revert', target: { path: 'src/a.ts', staged: false, patch: '@@', extra: 1 } }), { type: 'change', threadId: 't', action: 'revert', target: { path: 'src/a.ts', staged: false, patch: '@@' } });
  assert.deepEqual(decode({ type: 'add-project', name: 'fresh', publish: 'private', path: '/tmp' }), { type: 'add-project', name: 'fresh', publish: 'private' });
  assert.deepEqual(decode({ type: 'clone-project', source: { github: 'frstycodes/mochi', dest: '/etc' } }), { type: 'clone-project', source: { github: 'frstycodes/mochi' } });
  const image = { mediaType: 'image/png', data: 'x', thumb: 'x', original: '/Users/me/secret.png' };
  assert.deepEqual(decode({ type: 'create', title: 'x', provider: 'claude', project: null, images: [image] }), { type: 'create', title: 'x', provider: 'claude', project: null, images: [{ mediaType: 'image/png', data: 'x', thumb: 'x' }] });
});

test('malformed commands are refused, never half-read', () => {
  const controls = { model: 'opus', effort: 'high', speed: '', access: 'Manual' };
  const png = { mediaType: 'image/png', data: 'x', thumb: 'x' };
  for (const bad of [
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
    { type: 'create', title: 'x', provider: 'claude', project: null, controls: { ...controls, access: 'Root' } },
    { type: 'create', title: 'x', provider: 'claude', project: null, images: [{ ...png, mediaType: 'image/svg+xml' }] },
    { type: 'create', title: 'x', provider: 'claude', project: null, images: Array.from({ length: 9 }, () => png) },
    { type: 'delete' },
    { type: 'pin', threadId: 't', isPinned: true, order: 'first' },
    { type: 'pin', threadId: 't', isPinned: true, order: null },
    { type: 'seen' },
    { type: 'seen', queueIds: Array.from({ length: 501 }, (_, i) => `q${i}`) },
    { type: 'add-project', name: 'x', publish: 'internal' },
    { type: 'create', title: 'x', provider: 'claude', project: 'p'.repeat(129) },
    ...['../up', '..', 'a/b', '', 'with space'].map((name) => ({ type: 'add-project', name })),
    ...[{ url: '/Users/me/repo' }, { url: '--upload-pack=x' }, { url: 'ext::sh -c x' }, { github: 'owner/..' }, { github: 'owner' }, { url: 'https://a.com/b/c', github: 'b/c' }, 'https://github.com/a/b'].map((source) => ({ type: 'clone-project', source })),
  ])
    assert.ok(isRefused(bad), JSON.stringify(bad));
});

test('a hello on another protocol is refused, and a device frame must be an RPC message or its members', () => {
  assert.throws(() => Schema.decodeUnknownSync(HelloFrame)({ type: 'hello', version: 3 }), /protocol 4/);
  const isDeviceFrame = Schema.is(DeviceLinkFrame);
  assert.ok(isDeviceFrame({ _tag: 'Request', id: '1', tag: 'thread', payload: {}, headers: [] }));
  assert.ok(isDeviceFrame({ type: 'members', members: [] }));
  for (const bad of [{ _tag: 'Exit' }, { type: 'command', id: 'c1', command: { type: 'catalog' } }, { type: 'snapshot' }, null, 'Request']) assert.ok(!isDeviceFrame(bad), JSON.stringify(bad));
});
