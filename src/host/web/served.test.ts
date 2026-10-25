import assert from 'node:assert/strict';
import { test, vi } from 'vite-plus/test';
import { servedNamespace } from './served.ts';

const calls = vi.hoisted(() => [] as [string, unknown][]);
vi.mock('../desktop/rpc.ts', () => ({
  callCore: async (tag: string, args: unknown) => (
    calls.push([tag, args]),
    'ok'
  ),
}));

test('a served page calls Core for requests and gets inert push channels', async () => {
  const notify = servedNamespace('notify');
  assert.equal(await notify.show({ title: 'Done' }), 'ok');
  assert.deepEqual(calls, [['notify.show', [{ title: 'Done' }]]]);
  const unsubscribe = notify.onClick(() => assert.fail('never fires'));
  assert.equal(typeof unsubscribe, 'function');
  unsubscribe();
});
