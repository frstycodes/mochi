import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { host } from '../host/index.ts';
import { listeningPorts } from './devServer.ts';
import { refreshPorts, watchPorts } from './ports.ts';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('every watched thread shares one scan per tick, and polling stops with the last watcher', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const list = mock.method(host.ports, 'list', async (cwds: string[]) => cwds.map((cwd) => (cwd === '/gone' ? { error: 'cwd is not a directory' } : { ports: [{ port: 5173, pid: 1, command: cwd, startedAt: 0 }] })));
  const stops = [watchPorts('t1', '/a'), watchPorts('t1', '/a'), watchPorts('t2', '/b'), watchPorts('t3', '/gone')];
  await flush();
  assert.equal(list.mock.callCount(), 1);
  assert.deepEqual(list.mock.calls[0].arguments[0], ['/a', '/b', '/gone']);
  assert.equal(listeningPorts('t2')?.[0].command, '/b');
  assert.equal(listeningPorts('t3'), undefined);

  t.mock.timers.tick(3000);
  assert.equal(list.mock.callCount(), 2);
  refreshPorts();
  await flush();
  assert.equal(list.mock.callCount(), 3);

  stops[0]();
  stops[2]();
  stops[3]();
  t.mock.timers.tick(3000);
  assert.deepEqual(list.mock.calls[3].arguments[0], ['/a']);
  stops[1]();
  t.mock.timers.tick(9000);
  assert.equal(list.mock.callCount(), 4);
  assert.equal(listeningPorts('t1')?.[0].command, '/a');
});
