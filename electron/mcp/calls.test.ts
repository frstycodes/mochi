import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { AgentToolCall } from '../../src/host/types/agent.ts';
import { RELOADED, toolCalls, type Renderer } from './calls.ts';

class FakeRenderer extends EventEmitter {
  sent: AgentToolCall[] = [];
  send(_channel: string, call: AgentToolCall) {
    this.sent.push(call);
  }
}

const request = { threadId: 't1', name: 'browser_eval', args: {} };

test('a call waiting on a widget is never cut short by its tier, only by the overall timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = toolCalls(31 * 60_000);
  const renderer = new FakeRenderer();
  let result: unknown;
  void calls.call(renderer as unknown as Renderer, request).then((r) => (result = r));
  t.mock.timers.tick(30_000);
  await Promise.resolve();
  assert.equal(result, undefined, 'still waiting after 30s');
  t.mock.timers.tick(31 * 60_000);
  await new Promise(setImmediate);
  assert.deepEqual(result, { text: 'Mochi did not answer in time', isError: true });
});

test('the answer resolves the call it was for', async () => {
  const calls = toolCalls(60_000);
  const renderer = new FakeRenderer();
  const a = calls.call(renderer as unknown as Renderer, request);
  const b = calls.call(renderer as unknown as Renderer, { ...request, name: 'get_thread' });
  calls.resolve(renderer.sent[1].id, { text: 'b' });
  calls.resolve(renderer.sent[0].id, { text: 'a' });
  assert.deepEqual([await a, await b], [{ text: 'a' }, { text: 'b' }]);
});

test('a reload or crash fails every call waiting on that renderer, and only on it', async () => {
  const calls = toolCalls(60_000);
  const main = new FakeRenderer();
  const other = new FakeRenderer();
  const waiting = calls.call(main as unknown as Renderer, request);
  const elsewhere = calls.call(other as unknown as Renderer, request);
  main.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
  main.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
  main.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  assert.deepEqual(await waiting, { text: RELOADED, isError: true });
  const crashed = calls.call(main as unknown as Renderer, request);
  main.emit('render-process-gone');
  assert.deepEqual(await crashed, { text: RELOADED, isError: true });
  calls.resolve(other.sent[0].id, { text: 'still here' });
  assert.deepEqual(await elsewhere, { text: 'still here' });
  assert.equal(main.listenerCount('did-start-navigation'), 1, 'listeners attach once per renderer');
});
