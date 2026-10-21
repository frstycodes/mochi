import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { host } from '../host/index.ts';
import { watchPorts } from './ports.ts';

test('a thread is polled only while something watches it', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const list = mock.method(host.ports, 'list', async () => []);
  const stopFirst = watchPorts('t1', '/repo');
  const stopSecond = watchPorts('t1', '/repo');
  assert.equal(list.mock.callCount(), 1);
  t.mock.timers.tick(3000);
  assert.equal(list.mock.callCount(), 2);
  stopFirst();
  t.mock.timers.tick(3000);
  assert.equal(list.mock.callCount(), 3);
  stopSecond();
  t.mock.timers.tick(9000);
  assert.equal(list.mock.callCount(), 3);
  watchPorts('t1', '/repo')();
  assert.equal(list.mock.callCount(), 4);
});
