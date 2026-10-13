import assert from 'node:assert/strict';
import { test } from 'node:test';
import WebSocket from 'ws';
import { DEFAULT_SCOPES, type CommandResult, type RemoteCommandRequest } from '../../src/host/types/remote.ts';
import { isPrivate } from './interfaces.ts';
import { ActionLog } from './log.ts';
import { PROTOCOL_VERSION, type ServerFrame } from './protocol.ts';
import { startRemoteServer, type RendererBridge } from './server.ts';
import { tokenAuth } from './testAuth.ts';

const DEVICES = {
  laptop: { deviceId: 'd-laptop', name: 'Laptop', scopes: DEFAULT_SCOPES },
  viewer: { deviceId: 'd-viewer', name: 'Viewer', scopes: ['read' as const] },
};

/** A renderer stand-in: its store is a counter of applied actions, numbered within one epoch. */
function renderer(epoch = 'e1') {
  const runs: RemoteCommandRequest[] = [];
  const store = { epoch, seq: 0 };
  const bridge: RendererBridge = {
    snapshot: async () => ({ epoch: store.epoch, seq: store.seq, saved: { threads: [{ activity: [{ patch: '+secret' }] }], checkpoints: { t: {} } } }),
    run: async (request): Promise<CommandResult> => {
      runs.push(request);
      return { isOk: true };
    },
  };
  return { bridge, runs, store };
}

async function serve(capacity?: number) {
  const r = renderer();
  const log = new ActionLog(capacity);
  const server = await startRemoteServer({ hosts: ['127.0.0.1'], port: 0, authenticate: tokenAuth(DEVICES), bridge: r.bridge, log, machineName: () => 'Studio' });
  /** What the renderer does for each action: applies it, then pushes it. */
  const act = (n = 1) => {
    for (let i = 0; i < n; i++) server.publish(r.store.epoch, ++r.store.seq, { type: 'tick', n: r.store.seq });
  };
  return { server, act, ...r };
}

/** A device: every frame the server sends, readable in order. */
async function connect(port: string, hello: object) {
  const socket = new WebSocket(`ws://${port}`);
  const frames: ServerFrame[] = [];
  const waiters: (() => void)[] = [];
  socket.on('message', (data) => {
    frames.push(JSON.parse(data.toString()) as ServerFrame);
    waiters.splice(0).forEach((w) => w());
  });
  await new Promise((resolve, reject) => socket.once('open', resolve).once('error', reject));
  socket.send(JSON.stringify({ type: 'hello', version: PROTOCOL_VERSION, ...hello }));
  let read = 0;
  const next = async (): Promise<ServerFrame> => {
    while (read >= frames.length) await new Promise<void>((resolve) => waiters.push(resolve));
    return frames[read++];
  };
  /** Reads until `count` frames of `type` have arrived. */
  const until = async <T extends ServerFrame['type']>(type: T, count = 1) => {
    const seen: Extract<ServerFrame, { type: T }>[] = [];
    while (seen.length < count) {
      const frame = await next();
      if (frame.type === type) seen.push(frame as Extract<ServerFrame, { type: T }>);
    }
    return seen;
  };
  const command = (id: string, command: object) => socket.send(JSON.stringify({ type: 'command', id, command }));
  const close = () => new Promise((resolve) => (socket.once('close', resolve), socket.close()));
  return { next, until, command, close, frames };
}

test('a new device gets a snapshot, then every action in order with its sequence number', async () => {
  const { server, act } = await serve();
  act(2);
  const device = await connect(server.addresses[0], { auth: 'laptop' });
  assert.deepEqual(await device.next(), { type: 'welcome', version: PROTOCOL_VERSION, deviceId: 'd-laptop', machineName: 'Studio', scopes: DEFAULT_SCOPES });
  const snapshot = await device.next();
  assert.equal(snapshot.type === 'snapshot' && snapshot.seq, 2);
  act(3);
  const actions = await device.until('action', 3);
  assert.deepEqual(actions.map((a) => a.seq), [3, 4, 5]);
  await device.close();
  await server.close();
});

test('a device back after a gap gets only the actions it missed, without a snapshot', async () => {
  const { server, act } = await serve();
  const first = await connect(server.addresses[0], { auth: 'laptop' });
  await first.until('snapshot');
  act(3);
  const [, , last] = await first.until('action', 3);
  await first.close();
  act(4);
  const back = await connect(server.addresses[0], { auth: 'laptop', resume: { epoch: last.epoch, seq: last.seq } });
  const missed = await back.until('action', 4);
  assert.deepEqual(missed.map((a) => a.seq), [4, 5, 6, 7]);
  assert.ok(!back.frames.some((f) => f.type === 'snapshot'));
  await back.close();
  await server.close();
});

test('a gap older than the log, or from another epoch, falls back to a fresh snapshot', async () => {
  const { server, act, store } = await serve(5);
  act(20);
  const stale = await connect(server.addresses[0], { auth: 'laptop', resume: { epoch: 'e1', seq: 3 } });
  const [snapshot] = await stale.until('snapshot');
  assert.equal(snapshot.seq, 20);
  await stale.close();
  // The renderer reloaded: its numbers start over in a new epoch.
  store.epoch = 'e2';
  store.seq = 0;
  act(1);
  const other = await connect(server.addresses[0], { auth: 'laptop', resume: { epoch: 'e1', seq: 20 } });
  const [fresh] = await other.until('snapshot');
  assert.deepEqual([fresh.epoch, fresh.seq], ['e2', 1]);
  await other.close();
  await server.close();
});

test('a device without the scope a command needs is refused, and the renderer never sees it', async () => {
  const { server, runs } = await serve();
  const viewer = await connect(server.addresses[0], { auth: 'viewer' });
  viewer.command('c1', { type: 'interrupt', threadId: 't1' });
  const [result] = await viewer.until('result');
  assert.deepEqual(result, { type: 'result', id: 'c1', isOk: false, error: 'This device can’t interrupt: it needs the operate scope' });
  assert.equal(runs.length, 0);
  await viewer.close();
  await server.close();
});

test('a duplicate command id runs once and both get the first result', async () => {
  const { server, runs } = await serve();
  const laptop = await connect(server.addresses[0], { auth: 'laptop' });
  laptop.command('c1', { type: 'send', threadId: 't1', text: 'hi' });
  laptop.command('c1', { type: 'send', threadId: 't1', text: 'hi' });
  const results = await laptop.until('result', 2);
  assert.deepEqual(results.map((r) => r.isOk), [true, true]);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].command, { type: 'send', threadId: 't1', text: 'hi' });
  assert.equal(runs[0].deviceName, 'Laptop');
  await laptop.close();
  await server.close();
});

test('an unknown device, a wrong version or a first frame that is not hello is refused', async () => {
  const { server } = await serve();
  for (const hello of [{ auth: 'stranger' }, { auth: 'laptop', version: 99 }, { auth: 'laptop', type: 'command' }]) {
    const device = await connect(server.addresses[0], hello);
    assert.equal((await device.next()).type, 'refused');
  }
  await server.close();
});

test('without the code scope a device gets no diffs or checkpoints', async () => {
  const { server } = await serve();
  const viewer = await connect(server.addresses[0], { auth: 'viewer' });
  const [snapshot] = await viewer.until('snapshot');
  assert.deepEqual(snapshot.saved, { threads: [{ activity: [{}] }], checkpoints: {} });
  server.publish('e1', 1, { type: 'agent', event: { type: 'tool', phase: 'end', patch: '+secret' } });
  const [action] = await viewer.until('action');
  assert.deepEqual(action.action, { type: 'agent', event: { type: 'tool', phase: 'end' } });
  await viewer.close();
  await server.close();
});

test('only LAN and Tailscale addresses count as this network', () => {
  const cases = [
    ['192.168.1.4', 'IPv4', true],
    ['10.0.0.2', 'IPv4', true],
    ['172.20.1.1', 'IPv4', true],
    ['172.32.0.1', 'IPv4', false],
    ['100.101.5.9', 'IPv4', true],
    ['100.128.0.1', 'IPv4', false],
    ['8.8.8.8', 'IPv4', false],
    ['fd7a:115c:a1e0::1', 'IPv6', true],
    ['2001:db8::1', 'IPv6', false],
    ['fe80::1', 'IPv6', false],
  ] as const;
  for (const [address, family, expected] of cases) assert.equal(isPrivate(address, family), expected, address);
});
