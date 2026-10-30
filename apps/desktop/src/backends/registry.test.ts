import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { Backend } from '@mochi/schema';
import type { Replica } from '../store/replica.ts';
import { createBackends, LOCAL_BACKEND } from './registry.ts';
import type { Transport } from './transport.ts';

const info = (id: string, name: string): Backend.BackendInfo => ({
  id,
  name,
  kind: 'mac',
  appVersion: '1.0.0',
  protocolVersion: 8,
  capabilities: [],
  scopes: ['read'],
});

/** A transport whose `backend.watch` pushes when the test says, and that counts open streams. */
function fakeTransport(kind: Transport['kind'] = 'device') {
  const watchers = new Set<(item: unknown) => void>();
  const transport: Transport = {
    kind,
    call: () => Promise.resolve(null),
    stream(_tag, _payload, onItem) {
      watchers.add(onItem);
      return () => void watchers.delete(onItem);
    },
  };
  return {
    transport,
    push: (i: unknown) => watchers.forEach((w) => w(i)),
    watchers,
  };
}

function fakeReplica() {
  let isStopped = false;
  return {
    replica: { stop: () => (isStopped = true) } as unknown as Replica,
    isStopped: () => isStopped,
  };
}

test('the registry adds a computer as it connects and removes it as it disconnects, this computer first', () => {
  const registry = createBackends();
  const seen: string[][] = [];
  registry.subscribe((list) => seen.push(list.map((b) => b.id)));

  const mini = fakeTransport();
  const miniReplica = fakeReplica();
  registry.add({
    id: 'mini',
    isLocal: false,
    transport: mini.transport,
    replica: miniReplica.replica,
  });
  const local = fakeTransport('loopback');
  const localReplica = fakeReplica();
  registry.add({
    id: LOCAL_BACKEND,
    isLocal: true,
    transport: local.transport,
    replica: localReplica.replica,
  });
  assert.deepEqual(
    registry.list().map((b) => b.id),
    [LOCAL_BACKEND, 'mini'],
  );

  mini.push(info('mini', 'Mac mini'));
  local.push(info('core-1', 'MacBook'));
  assert.equal(registry.get('mini')?.descriptor?.name, 'Mac mini');
  assert.equal(registry.get(LOCAL_BACKEND)?.descriptor?.id, 'core-1');

  registry.remove('mini');
  assert.deepEqual(
    registry.list().map((b) => b.id),
    [LOCAL_BACKEND],
  );
  assert.equal(miniReplica.isStopped(), true, 'its replica stops with it');
  assert.equal(mini.watchers.size, 0, 'its descriptor is no longer followed');
  mini.push(info('mini', 'Renamed'));
  assert.equal(registry.get('mini'), undefined);

  registry.remove(LOCAL_BACKEND);
  assert.equal(
    localReplica.isStopped(),
    false,
    'this computer’s replica is the window’s store',
  );
  assert.deepEqual(seen.at(-1), []);
});

test('a computer that connects again replaces its old entry', () => {
  const registry = createBackends();
  const first = fakeTransport();
  const firstReplica = fakeReplica();
  registry.add({
    id: 'mini',
    isLocal: false,
    transport: first.transport,
    replica: firstReplica.replica,
  });
  first.push(info('mini', 'Mac mini'));
  const second = fakeTransport();
  registry.add({
    id: 'mini',
    isLocal: false,
    transport: second.transport,
    replica: fakeReplica().replica,
  });
  assert.equal(registry.list().length, 1);
  assert.equal(firstReplica.isStopped(), true);
  assert.equal(
    registry.get('mini')?.descriptor,
    undefined,
    'until the new channel answers',
  );
  assert.equal(registry.get('mini')?.transport, second.transport);
});

test('a dropped descriptor stream is followed again', async () => {
  const registry = createBackends(0);
  let opened = 0;
  let reopened = () => {};
  const isReopened = new Promise<void>((resolve) => (reopened = resolve));
  const transport: Transport = {
    kind: 'device',
    call: () => Promise.resolve(null),
    stream(_tag, _payload, _onItem, onEnd) {
      if (++opened === 1) queueMicrotask(() => onEnd(new Error('dropped')));
      else reopened();
      return () => {};
    },
  };
  registry.add({
    id: 'mini',
    isLocal: false,
    transport,
    replica: fakeReplica().replica,
  });
  await isReopened;
  assert.equal(opened, 2);
});
