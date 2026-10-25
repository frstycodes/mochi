import assert from 'node:assert/strict';
import { Stream } from 'effect';
import { test, vi } from 'vite-plus/test';
import { servedNamespace } from './served.ts';

const calls = vi.hoisted(() => [] as [string, unknown][]);
vi.mock('../desktop/rpc.ts', () => ({
  callCore: async (tag: string, args: unknown) => (
    calls.push([tag, args]),
    'ok'
  ),
  coreClient: async () => ({
    agentPush: () =>
      Stream.make(
        { channel: 'projects:onChange', payload: 'mine', windowId: 3 },
        { channel: 'projects:onChange', payload: 'space' },
      ),
  }),
}));

test('a served page calls Core for requests and hears what Core pushes to no window in particular', async () => {
  const projects = servedNamespace('projects');
  assert.equal(await projects.list('space'), 'ok');
  assert.deepEqual(calls, [['projects.list', ['space']]]);
  const heard = await new Promise<string>((resolve) =>
    projects.onChange(resolve),
  );
  assert.equal(heard, 'space');
});
