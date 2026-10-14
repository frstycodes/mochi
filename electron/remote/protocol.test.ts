import assert from 'node:assert/strict';
import test from 'node:test';
import { hasScope, parseCommand } from './protocol.ts';

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
