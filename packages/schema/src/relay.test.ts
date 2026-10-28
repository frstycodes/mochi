import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vite-plus/test';
import { Schema } from 'effect';
import { scopeOf } from './capabilities.ts';
import {
  commandScope,
  COMMAND_SCOPES,
  CommandResult,
  DeviceLinkFrame,
  HelloFrame,
  MachineLinkFrame,
  RemoteCommand,
} from './relay.ts';

const fixtures = JSON.parse(
  readFileSync(new URL('../fixtures/relay.json', import.meta.url), 'utf8'),
);
const decode = Schema.decodeUnknownSync(RemoteCommand);
const isRefused = (command: unknown) =>
  Schema.decodeUnknownOption(RemoteCommand)(command)._tag === 'None';

test('recorded commands and frames round-trip', () => {
  for (const command of fixtures.commands) {
    assert.deepEqual(decode(command), command);
    assert.deepEqual(
      Schema.encodeSync(RemoteCommand)(decode(command)),
      command,
    );
  }
  for (const hello of fixtures.hello)
    assert.deepEqual(Schema.decodeUnknownSync(HelloFrame)(hello), hello);
  for (const frame of fixtures.machineFrames)
    assert.deepEqual(
      Schema.encodeSync(MachineLinkFrame)(
        Schema.decodeUnknownSync(MachineLinkFrame)(frame),
      ),
      frame,
    );
  for (const result of fixtures.results)
    assert.deepEqual(
      Schema.encodeSync(CommandResult)(
        Schema.decodeUnknownSync(CommandResult)(result),
      ),
      result,
    );
});

test('commands keep only their own fields, and titles come back trimmed', () => {
  assert.deepEqual(
    decode({
      type: 'fork',
      threadId: 't',
      point: { kind: 'checkpoint', n: 2 },
      extra: 1,
    }),
    { type: 'fork', threadId: 't', point: { kind: 'checkpoint', n: 2 } },
  );
  assert.deepEqual(
    decode({
      type: 'create',
      title: '  Fix login  ',
      provider: 'codex',
      project: null,
    }),
    { type: 'create', title: 'Fix login', provider: 'codex', project: null },
  );
  assert.deepEqual(decode({ type: 'catalog', extra: 1 }), { type: 'catalog' });
  assert.deepEqual(
    decode({
      type: 'change',
      threadId: 't',
      action: 'revert',
      target: { path: 'src/a.ts', staged: false, patch: '@@', extra: 1 },
    }),
    {
      type: 'change',
      threadId: 't',
      action: 'revert',
      target: { path: 'src/a.ts', staged: false, patch: '@@' },
    },
  );
  assert.deepEqual(
    decode({
      type: 'add-project',
      name: 'fresh',
      publish: 'private',
      path: '/tmp',
    }),
    { type: 'add-project', name: 'fresh', publish: 'private' },
  );
  assert.deepEqual(
    decode({
      type: 'clone-project',
      source: { github: 'frstycodes/mochi', dest: '/etc' },
    }),
    { type: 'clone-project', source: { github: 'frstycodes/mochi' } },
  );
  const image = {
    mediaType: 'image/png',
    data: 'x',
    thumb: 'x',
    original: '/Users/me/secret.png',
  };
  assert.deepEqual(
    decode({
      type: 'create',
      title: 'x',
      provider: 'claude',
      project: null,
      images: [image],
    }),
    {
      type: 'create',
      title: 'x',
      provider: 'claude',
      project: null,
      images: [{ mediaType: 'image/png', data: 'x', thumb: 'x' }],
    },
  );
});

test('malformed commands are refused, never half-read', () => {
  const controls = {
    model: 'opus',
    effort: 'high',
    speed: '',
    access: 'Manual',
  };
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
    {
      type: 'change',
      threadId: 't',
      action: 'delete',
      target: { path: 'a', staged: false },
    },
    { type: 'change', threadId: 't', action: 'stage', target: { path: 'a' } },
    {
      type: 'comment',
      threadId: 't',
      path: 'a',
      side: 'left',
      line: 1,
      text: 'x',
    },
    { type: 'diff', threadId: 't', scope: 'all' },
    { type: 'checkpoint-diff', threadId: 't', n: -1 },
    { type: 'terminal-open', threadId: 't', cols: 0, rows: 24 },
    { type: 'terminal-open', threadId: 't', cols: 80, rows: 1e6 },
    { type: 'terminal-write', threadId: 't', terminalId: 'p', data: '' },
    {
      type: 'rewind',
      threadId: 't',
      point: { kind: 'message', index: 1 },
      mode: 'everything',
    },
    { type: 'side-chat', threadId: 't', text: '  ' },
    { type: 'setting', key: '', value: 'x' },
    {
      type: 'create',
      title: 'x',
      provider: 'claude',
      project: null,
      controls: { ...controls, access: 'Root' },
    },
    {
      type: 'create',
      title: 'x',
      provider: 'claude',
      project: null,
      images: [{ ...png, mediaType: 'image/svg+xml' }],
    },
    {
      type: 'create',
      title: 'x',
      provider: 'claude',
      project: null,
      images: Array.from({ length: 9 }, () => png),
    },
    { type: 'delete' },
    { type: 'pin', threadId: 't', isPinned: true, order: 'first' },
    { type: 'pin', threadId: 't', isPinned: true, order: null },
    { type: 'seen' },
    { type: 'seen', queueIds: Array.from({ length: 501 }, (_, i) => `q${i}`) },
    { type: 'add-project', name: 'x', publish: 'internal' },
    {
      type: 'create',
      title: 'x',
      provider: 'claude',
      project: 'p'.repeat(129),
    },
    ...['../up', '..', 'a/b', '', 'with space'].map((name) => ({
      type: 'add-project',
      name,
    })),
    ...[
      { url: '/Users/me/repo' },
      { url: '--upload-pack=x' },
      { url: 'ext::sh -c x' },
      { github: 'owner/..' },
      { github: 'owner' },
      { url: 'https://a.com/b/c', github: 'b/c' },
      'https://github.com/a/b',
    ].map((source) => ({ type: 'clone-project', source })),
  ])
    assert.ok(isRefused(bad), JSON.stringify(bad));
});

test('a hello on another protocol is refused, and a device frame must be an RPC message or its members', () => {
  assert.throws(
    () => Schema.decodeUnknownSync(HelloFrame)({ type: 'hello', version: 5 }),
    /protocol 6/,
  );
  const isDeviceFrame = Schema.is(DeviceLinkFrame);
  assert.ok(
    isDeviceFrame({
      _tag: 'Request',
      id: '1',
      tag: 'thread',
      payload: {},
      headers: [],
    }),
  );
  assert.ok(isDeviceFrame({ type: 'members', members: [] }));
  for (const bad of [
    { _tag: 'Exit' },
    { type: 'command', id: 'c1', command: { type: 'catalog' } },
    { type: 'snapshot' },
    null,
    'Request',
  ])
    assert.ok(!isDeviceFrame(bad), JSON.stringify(bad));
});

test('a thread action is one of the whitelisted store actions, read field by field, never one the device names freely', () => {
  const png = { mediaType: 'image/png', data: 'x', thumb: 'x' };
  assert.deepEqual(
    decode({
      type: 'thread-action',
      threadId: 't',
      action: { type: 'queued-remove', id: 'm-1', threadId: 'other' },
    }),
    {
      type: 'thread-action',
      threadId: 't',
      action: { type: 'queued-remove', id: 'm-1' },
    },
    'the thread is the command’s, not one the action names',
  );
  assert.deepEqual(
    decode({
      type: 'thread-action',
      threadId: 't',
      action: {
        type: 'queued-add',
        message: {
          draft: 'look',
          images: [{ ...png, original: '/Users/me/shot.png' }],
          id: 'm-9',
        },
      },
    }),
    {
      type: 'thread-action',
      threadId: 't',
      action: {
        type: 'queued-add',
        message: { draft: 'look', images: [png] },
      },
    },
    'no path of the sending computer, and the machine picks the id',
  );
  for (const bad of [
    { type: 'thread-action', threadId: 't', action: { type: 'delete' } },
    { type: 'thread-action', threadId: 't', action: { type: 'tick' } },
    { type: 'thread-action', threadId: 't', action: { type: 'say' } },
    { type: 'thread-action', threadId: 't' },
    {
      type: 'thread-action',
      threadId: 't',
      action: { type: 'controls', controls: { model: 'x' } },
    },
    {
      type: 'thread-action',
      threadId: 't',
      action: { type: 'grant-answer', grantId: 'g', answer: 'always' },
    },
    {
      type: 'thread-action',
      threadId: 't',
      action: { type: 'queued-add', message: { draft: '  ' } },
    },
    {
      type: 'thread-action',
      threadId: 't',
      action: { type: 'autofix-set', pr: -1, isOn: true },
    },
  ])
    assert.ok(isRefused(bad), JSON.stringify(bad));
});

test('each thread action needs its own scope, and one Core doesn’t know needs a scope no device has', () => {
  const action = (type: string) => ({
    type: 'thread-action',
    threadId: 't',
    action: { type },
  });
  assert.equal(commandScope(action('controls')), 'operate');
  assert.equal(commandScope(action('queued-add')), 'operate');
  assert.equal(commandScope(action('grant-answer')), 'operate');
  assert.equal(commandScope(action('goal-remove')), 'manage');
  assert.equal(commandScope(action('autofix-set')), 'manage');
  assert.equal(commandScope(action('proposal-start')), 'manage');
  for (const unknown of ['delete', 'toString', '__proto__', 'constructor'])
    assert.equal(commandScope(action(unknown)), 'local', unknown);
  assert.equal(commandScope({ type: 'thread-action', threadId: 't' }), 'local');
  assert.equal(commandScope({ type: 'hasOwnProperty' }), 'local');
  assert.equal(commandScope({ type: 'send' }), 'operate');
  assert.equal(commandScope(undefined), 'local');
  assert.equal(
    scopeOf('device.command', { command: action('goal-remove') }),
    'manage',
  );
});

test('a send carries the composer’s images and references, and needs something to send', () => {
  const png = { mediaType: 'image/png', data: 'x', thumb: 'x' };
  const send = { type: 'send', threadId: 't' };
  assert.deepEqual(
    decode({
      ...send,
      text: '',
      images: [{ ...png, original: '/Users/me/a.png' }],
      mentions: [
        {
          kind: 'file',
          id: 'file:src/a.ts',
          title: 'src/a.ts',
          path: 'src/a.ts',
          isDir: false,
        },
      ],
      typedSkills: ['simplify'],
      steers: true,
    }),
    {
      ...send,
      text: '',
      images: [png],
      mentions: [
        {
          kind: 'file',
          id: 'file:src/a.ts',
          title: 'src/a.ts',
          path: 'src/a.ts',
          isDir: false,
        },
      ],
      typedSkills: ['simplify'],
      steers: true,
    },
  );
  assert.deepEqual(decode({ ...send, text: '', queuedId: 'm-1' }), {
    ...send,
    text: '',
    queuedId: 'm-1',
  });
  for (const bad of [
    { ...send, text: '  ' },
    { ...send, text: 'x', images: Array.from({ length: 9 }, () => png) },
    {
      ...send,
      text: 'x',
      mentions: [
        {
          kind: 'file',
          id: 'f',
          title: 'f',
          path: '/etc/passwd',
          isDir: false,
        },
      ],
    },
    { ...send, text: 'x', mentions: [{ kind: 'shell', id: 'x', title: 'x' }] },
  ])
    assert.ok(isRefused(bad), JSON.stringify(bad));
});

test('pane commands decode, and refuse what would escape the thread or read nothing', () => {
  const ok = {
    type: 'write-file',
    threadId: 't',
    path: 'src/a.ts',
    text: 'x',
    baseMtimeMs: 1,
  };
  assert.deepEqual(decode(ok), ok);
  for (const path of ['/etc/passwd', '../x', 'a/../../x', 'C:/x'])
    assert.ok(isRefused({ ...ok, path }), path);
  assert.deepEqual(decode({ ...ok, force: true }), { ...ok, force: true });

  const diff = { type: 'turn-diff', threadId: 't', from: 'abcd1234' };
  assert.deepEqual(decode(diff), diff);
  assert.deepEqual(decode({ ...diff, to: 'beef' }), { ...diff, to: 'beef' });
  assert.ok(isRefused({ ...diff, from: 'not-hex' }));
  assert.ok(isRefused({ ...diff, to: 'xyz!' }));

  const search = {
    type: 'search',
    threadId: 't',
    pattern: 'foo',
    isCaseSensitive: false,
    isRegex: false,
    isWholeWord: false,
  };
  assert.deepEqual(decode(search), search);
  assert.ok(isRefused({ ...search, pattern: '   ' }));
  assert.ok(isRefused({ ...search, pattern: '' }));

  for (const type of ['read-image', 'read-task-output']) {
    const c = { type, threadId: 't', path: '/tmp/a.png' };
    assert.deepEqual(decode(c), c);
  }
});

test('pane commands need the scope their kind of access needs', () => {
  for (const type of ['write-file', 'search', 'turn-diff'] as const)
    assert.equal(COMMAND_SCOPES[type], 'code');
  for (const type of ['read-image', 'read-task-output'] as const)
    assert.equal(COMMAND_SCOPES[type], 'read');
  assert.equal(
    scopeOf('device.command', { command: { type: 'write-file' } }),
    'code',
  );
  assert.equal(
    scopeOf('device.command', { command: { type: 'read-image' } }),
    'read',
  );
  // A device holding only `read` is not granted write-file.
  const held = new Set(['read']);
  assert.equal(
    held.has(scopeOf('device.command', { command: { type: 'write-file' } })),
    false,
  );
});

test('pane command results keep the shape they answer with', () => {
  const decodeResult = Schema.decodeUnknownSync(CommandResult);
  const line = {
    line: 1,
    text: 'x',
    isCut: false,
    ranges: [[0, 1]],
    column: [0, 1],
  };
  for (const data of [
    { text: 'hi', mtimeMs: 42 },
    { status: 'saved', mtimeMs: 3 },
    { status: 'conflict', text: 'theirs', mtimeMs: 4 },
    { hits: [{ path: 'a.ts', lines: [line] }], isTruncated: true },
    { turnFiles: [] },
    { mediaType: 'image/png', base64: 'AAA=' },
  ]) {
    const result = { isOk: true, data };
    assert.deepEqual(decodeResult(result), result);
  }
});

test('thread ops: the PR tab writes need manage, its review code, a badge read; scopeOf routes each', () => {
  const expected = {
    'pr-status': 'read',
    'disk-usage': 'read',
    schedules: 'read',
    ports: 'read',
    'pr-review': 'code',
    'rewind-preview': 'code',
    pr: 'manage',
    sync: 'manage',
    'schedule-set': 'manage',
    'attach-project': 'manage',
    'port-kill': 'manage',
  } as const;
  for (const [type, scope] of Object.entries(expected)) {
    assert.equal(COMMAND_SCOPES[type as keyof typeof expected], scope, type);
    assert.equal(scopeOf('device.command', { command: { type } }), scope);
  }
});

test('thread ops refuse what their handlers never should see', () => {
  const pr = (action: unknown, number: unknown = 12) => ({
    type: 'pr',
    threadId: 't',
    number,
    action,
  });
  assert.ok(isRefused(pr({ kind: 'comment', body: 'x' }, 0)));
  assert.ok(isRefused(pr({ kind: 'comment', body: 'x' }, 1.5)));
  assert.ok(isRefused(pr({ kind: 'comment', body: '  ' })));
  assert.ok(isRefused(pr({ kind: 'close' })));
  assert.ok(isRefused(pr({ kind: 'merge', method: 'octopus', mode: 'now' })));
  assert.ok(isRefused(pr({ kind: 'reply', reviewThreadId: '', body: 'x' })));
  assert.ok(isRefused({ type: 'port-kill', threadId: 't', pid: 0 }));
  assert.ok(isRefused({ type: 'port-kill', threadId: 't', pid: -1 }));
  assert.ok(isRefused({ type: 'attach-project', threadId: 't', project: '' }));
  assert.ok(
    isRefused({
      type: 'schedule-set',
      threadId: 't',
      name: 'x',
      prompt: 'x',
      when: { kind: 'hourly' },
      missed: 'skip',
    }),
  );
  // A path is the owner's to pick: a device can't slip one in.
  assert.deepEqual(
    decode({
      type: 'attach-project',
      threadId: 't',
      project: 'p1',
      path: '/etc',
    }),
    { type: 'attach-project', threadId: 't', project: 'p1' },
  );
});
