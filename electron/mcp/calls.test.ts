import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { afterEach, test, vi } from 'vite-plus/test';
import type { AgentToolCall } from '../../src/host/types/agent.ts';
import { WINDOW_GONE, toolCalls, type Renderer } from './calls.ts';

afterEach(() => vi.useRealTimers());

class FakeRenderer extends EventEmitter {
  sent: AgentToolCall[] = [];
  send(_channel: string, call: AgentToolCall) {
    this.sent.push(call);
  }
}

const request = { threadId: 't1', name: 'browser_eval', args: {} };

test('a call waiting on a widget is never cut short by its tier, only by the overall timeout', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const calls = toolCalls(31 * 60_000);
  const renderer = new FakeRenderer();
  let result: unknown;
  void calls.call(renderer as unknown as Renderer, request).then((r) => (result = r));
  vi.advanceTimersByTime(30_000);
  await Promise.resolve();
  assert.equal(result, undefined, 'still waiting after 30s');
  vi.advanceTimersByTime(31 * 60_000);
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

test('a reload hands the waiting calls to the reloaded page once, and its answer still resolves them', async () => {
  const calls = toolCalls(60_000);
  const main = new FakeRenderer();
  const other = new FakeRenderer();
  let result: unknown;
  void calls.call(main as unknown as Renderer, request).then((r) => (result = r));
  const elsewhere = calls.call(other as unknown as Renderer, request);
  assert.deepEqual(calls.undelivered(main as unknown as Renderer), [], 'a page that got the call is not handed it again');
  main.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
  main.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
  assert.deepEqual(calls.undelivered(main as unknown as Renderer), [], 'in-page and subframe navigations keep the page');
  main.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  await new Promise(setImmediate);
  assert.equal(result, undefined, 'the reload leaves the call waiting');
  const [again] = calls.undelivered(main as unknown as Renderer);
  assert.deepEqual(again, main.sent[0]);
  assert.deepEqual(calls.undelivered(main as unknown as Renderer), [], 'handed out once');
  calls.resolve(again.id, { text: 'answered after reload' });
  await new Promise(setImmediate);
  assert.deepEqual(result, { text: 'answered after reload' });
  calls.resolve(other.sent[0].id, { text: 'still here' });
  assert.deepEqual(await elsewhere, { text: 'still here' });
});

test('a crash or a closed window fails every call waiting on that renderer', async () => {
  const calls = toolCalls(60_000);
  const main = new FakeRenderer();
  const crashed = calls.call(main as unknown as Renderer, request);
  main.emit('render-process-gone');
  assert.deepEqual(await crashed, { text: WINDOW_GONE, isError: true });
  const closed = calls.call(main as unknown as Renderer, request);
  main.emit('destroyed');
  assert.deepEqual(await closed, { text: WINDOW_GONE, isError: true });
  assert.equal(main.listenerCount('did-start-navigation'), 1, 'listeners attach once per renderer');
});
