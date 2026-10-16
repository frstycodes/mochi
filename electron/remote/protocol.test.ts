import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SCOPES, SCOPES } from '../../src/host/types/remote.ts';
import { hasScope, MAX_RESULT_BYTES, parseCommand, resultFrame } from './protocol.ts';

const parse = (command: object) => parseCommand(JSON.stringify({ type: 'command', id: 'c1', command }));

test('every new command parses from a well-formed frame and keeps only its own fields', () => {
  assert.deepEqual(parse({ type: 'fork', threadId: 't', point: { kind: 'checkpoint', n: 2 }, extra: 1 }), { type: 'command', id: 'c1', command: { type: 'fork', threadId: 't', point: { kind: 'checkpoint', n: 2 } } });
  assert.deepEqual(parse({ type: 'create', title: '  Fix login  ', provider: 'codex', project: null }), { type: 'command', id: 'c1', command: { type: 'create', title: 'Fix login', provider: 'codex', project: null } });
  assert.deepEqual(parse({ type: 'schedule', threadId: 't', action: 'pause' }), { type: 'command', id: 'c1', command: { type: 'schedule', threadId: 't', action: 'pause' } });
  assert.deepEqual(parse({ type: 'open-pr', threadId: 't', title: 'Fix', body: '' }), { type: 'command', id: 'c1', command: { type: 'open-pr', threadId: 't', title: 'Fix', body: '' } });
});

test('malformed commands are refused with a reason, never half-read', () => {
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
  ])
    assert.equal(typeof parse(bad), 'string', JSON.stringify(bad));
});

test('steering needs operate; changing and shipping need manage', () => {
  const command = (type: string) => {
    const frame = parse(type === 'handoff' ? { type, threadId: 't', to: 'codex' } : type === 'push' ? { type, threadId: 't' } : { type, threadId: 't', title: 'x' });
    assert.ok(typeof frame !== 'string', type);
    return frame.command;
  };
  assert.equal(hasScope(['read', 'operate'], command('handoff')), true);
  assert.equal(hasScope(['read', 'operate'], command('push')), false);
  assert.equal(hasScope(['read', 'operate'], command('rename')), false);
  assert.equal(hasScope(['manage'], command('push')), true);
});

test('code, terminal, rewind, side chat, settings and delete commands parse strictly', () => {
  const ok = (command: object) => {
    const frame = parse(command);
    assert.ok(typeof frame !== 'string', `${JSON.stringify(command)}: ${frame as string}`);
    return frame.command;
  };
  assert.deepEqual(ok({ type: 'change', threadId: 't', action: 'revert', target: { path: 'src/a.ts', staged: false, patch: '@@', extra: 1 } }), {
    type: 'change',
    threadId: 't',
    action: 'revert',
    target: { path: 'src/a.ts', staged: false, patch: '@@' },
  });
  assert.deepEqual(ok({ type: 'rewind', threadId: 't', point: { kind: 'message', index: 2 }, mode: 'files' }), {
    type: 'rewind',
    threadId: 't',
    point: { kind: 'message', index: 2 },
    mode: 'files',
  });
  assert.deepEqual(ok({ type: 'create', title: 'x', provider: 'claude', project: 'ref', model: 'opus' }), {
    type: 'create',
    title: 'x',
    provider: 'claude',
    project: 'ref',
    model: 'opus',
  });
  assert.deepEqual(ok({ type: 'terminal-read', threadId: 't', terminalId: 'p', after: 0 }), {
    type: 'terminal-read',
    threadId: 't',
    terminalId: 'p',
    after: 0,
  });
  assert.deepEqual(ok({ type: 'catalog', extra: 1 }), { type: 'catalog' });

  for (const bad of [
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
    { type: 'create', title: 'x', provider: 'claude', project: null, model: 7 },
    { type: 'delete' },
  ])
    assert.equal(typeof parse(bad), 'string', JSON.stringify(bad));
});

test('each new command needs its own scope; terminal is never implied by code', () => {
  const scopeOf = (command: object) => {
    const frame = parse(command);
    assert.ok(typeof frame !== 'string');
    return SCOPES.filter((s) => hasScope([s], frame.command));
  };
  assert.deepEqual(scopeOf({ type: 'catalog' }), ['read']);
  assert.deepEqual(scopeOf({ type: 'diff', threadId: 't', scope: 'branch' }), ['code']);
  assert.deepEqual(scopeOf({ type: 'read-file', threadId: 't', path: 'a' }), ['code']);
  assert.deepEqual(scopeOf({ type: 'comment', threadId: 't', path: 'a', side: 'additions', line: 1, text: 'x' }), ['code']);
  assert.deepEqual(scopeOf({ type: 'terminal-open', threadId: 't', cols: 80, rows: 24 }), ['terminal']);
  assert.deepEqual(scopeOf({ type: 'rewind', threadId: 't', point: { kind: 'checkpoint', n: 1 }, mode: 'chat' }), ['operate']);
  assert.deepEqual(scopeOf({ type: 'side-chat', threadId: 't', text: 'why?' }), ['operate']);
  assert.deepEqual(scopeOf({ type: 'delete', threadId: 't' }), ['manage']);
  assert.deepEqual(scopeOf({ type: 'setting', key: 'shell', value: 'zsh' }), ['manage']);
  assert.ok(!hasScope(DEFAULT_SCOPES, { type: 'terminal-open', threadId: 't', cols: 80, rows: 24 }), 'a new device has no terminal');
});

test('a result too large for the relay is refused with its size instead of sent', () => {
  assert.deepEqual(resultFrame('c1', { isOk: true, data: { text: 'hi' } }), { type: 'result', id: 'c1', isOk: true, data: { text: 'hi' } });
  const big = resultFrame('c1', { isOk: true, data: { text: 'x'.repeat(MAX_RESULT_BYTES) } });
  assert.equal(big.type === 'result' && big.isOk, false);
  assert.match(big.type === 'result' && !big.isOk ? big.error : '', /^Too large to send here \(0\.8 MB\)/);
});
