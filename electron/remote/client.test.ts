import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FollowedMachine, StreamFrame } from '../../src/host/types/remote.ts';
import { followMachine, openLan, type Route } from './client.ts';
import { plainDevice, serve } from './fixtures.ts';
import { PairingRefused } from './pairing.ts';

/** A follower of `address` as the device `name`, recording what it sees. */
function follow(routes: () => Route[], name = 'laptop') {
  const states: FollowedMachine[] = [];
  const frames: StreamFrame[] = [];
  const welcomes: { addresses: string[] }[] = [];
  const follower = followMachine({
    machine: { id: 'm1', name: 'Studio' },
    routes,
    secure: async (raw) => plainDevice(raw, name),
    onChange: (state) => states.push(state),
    onFrame: (frame) => frames.push(frame),
    onWelcome: (welcome) => welcomes.push(welcome),
  });
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(check(), 'timed out');
  };
  return { follower, states, frames, welcomes, until };
}

const lan = (address: string): Route => ({ kind: 'lan', open: () => openLan(address) });

test('a follower goes online over the LAN, applies the snapshot and actions, and runs commands', async () => {
  const { server, act, runs } = await serve();
  act(2);
  const { follower, frames, until } = follow(() => [lan(server.addresses[0])]);
  await until(() => follower.state().status === 'online' && frames.length === 1);
  assert.equal(follower.state().route, 'lan');
  assert.deepEqual(frames.map((f) => [f.type, f.seq]), [['snapshot', 2]]);
  act(2);
  await until(() => frames.length === 3);
  assert.deepEqual(frames.slice(1).map((f) => [f.type, f.seq]), [['action', 3], ['action', 4]]);
  assert.deepEqual(await follower.command({ type: 'interrupt', threadId: 't1' }), { isOk: true });
  assert.deepEqual(runs.map((r) => r.command.type), ['interrupt']);
  follower.close();
  await server.close();
});

test('after a dropped connection it resumes with only the actions it missed; a resync starts from a snapshot', async () => {
  const { server, act } = await serve();
  const { follower, frames, until } = follow(() => [lan(server.addresses[0])]);
  await until(() => frames.length === 1);
  act(1);
  await until(() => frames.length === 2);
  server.disconnect('d-laptop');
  await until(() => follower.state().status === 'offline');
  act(2);
  await until(() => follower.state().status === 'online' && frames.length === 4);
  assert.deepEqual(frames.slice(2).map((f) => [f.type, f.seq]), [['action', 2], ['action', 3]]);
  follower.resync();
  await until(() => frames.length === 5);
  assert.deepEqual([frames[4].type, frames[4].seq], ['snapshot', 3]);
  follower.close();
  await server.close();
});

test('commands while offline fail at once instead of waiting to run later', async () => {
  const { follower, until } = follow(() => [lan('127.0.0.1:1')]);
  await until(() => follower.state().status === 'offline');
  assert.deepEqual(await follower.command({ type: 'interrupt', threadId: 't1' }), { isOk: false, error: 'Studio is offline' });
  follower.close();
});

test('a refusal through the relay stops retrying; one on the LAN does not', async () => {
  const refused = (kind: Route['kind']): Route => ({ kind, open: async () => Promise.reject(new PairingRefused('That computer removed this one; pair again')) });
  const viaRelay = follow(() => [refused('relay')]);
  await viaRelay.until(() => viaRelay.follower.state().status === 'refused');
  assert.equal(viaRelay.follower.state().error, 'That computer removed this one; pair again');
  viaRelay.follower.close();
  const viaLan = follow(() => [refused('lan')]);
  await viaLan.until(() => viaLan.follower.state().status === 'offline');
  viaLan.follower.close();
});
