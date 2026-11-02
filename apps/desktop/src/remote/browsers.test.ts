import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vite-plus/test';
import type { BrowserEvent } from '@mochi/domain/host/types/browser';
import { host } from '../host/index.ts';
import type { Thread } from '../model.ts';
import { browserCore, runBrowserCommand } from './browsers.ts';

afterEach(() => vi.restoreAllMocks());

const thread = { id: 't1', spaceId: 's' } as Thread;
const tab = { threadId: 't1', tabId: 'b1' };

test('a device’s tab opens as the thread’s own page here, streams its frames to Core and takes its input', async () => {
  // The desktop host: the page gets a native view.
  Object.defineProperty(host, 'isDesktop', { value: true, configurable: true });
  let emit: (event: BrowserEvent) => void = () => {};
  vi.spyOn(host.browser, 'create').mockImplementation(async () => ({
    id: 'v1',
  }));
  const mirror = vi
    .spyOn(host.browser, 'mirror')
    .mockImplementation(async () => {});
  const input = vi
    .spyOn(host.browser, 'input')
    .mockImplementation(async () => {});
  vi.spyOn(host.browser, 'onEvent').mockImplementation((listener) => {
    emit = listener;
    return () => {};
  });
  const sent: { tag: string; payload: unknown }[] = [];
  vi.spyOn(browserCore, 'call').mockImplementation(async (tag, payload) => {
    sent.push({ tag, payload });
  });

  assert.deepEqual(
    await runBrowserCommand(thread, {
      type: 'browser-open',
      ...tab,
      url: 'localhost:5173',
      width: 800,
      height: 600,
    }),
    { isOk: true },
  );
  assert.deepEqual(mirror.mock.calls[0], ['v1', { width: 800, height: 600 }]);

  emit({ id: 'v1', type: 'frame', data: 'data:image/jpeg;base64,AA==' });
  emit({ id: 'v2', type: 'frame', data: 'data:image/jpeg;base64,BB==' });
  assert.deepEqual(
    sent.map((s) => s.tag),
    ['browser.feed'],
    'only the watched page’s frames go to Core',
  );
  assert.equal(
    (sent[0]!.payload as { frame: { url: string } }).frame.url,
    'http://localhost:5173',
  );

  await runBrowserCommand(thread, {
    type: 'browser-input',
    ...tab,
    input: { kind: 'click', x: 10, y: 20 },
  });
  assert.deepEqual(input.mock.calls[0], [
    'v1',
    { kind: 'click', x: 10, y: 20 },
  ]);

  await runBrowserCommand(thread, { type: 'browser-close', ...tab });
  assert.deepEqual(mirror.mock.calls.at(-1), ['v1', null]);
  assert.equal(sent.at(-1)?.tag, 'browser.close');
});

test('input for a tab no device opened here is refused', async () => {
  assert.deepEqual(
    await runBrowserCommand(thread, {
      type: 'browser-input',
      threadId: 't1',
      tabId: 'never-opened',
      input: { kind: 'key', key: 'Enter' },
    }),
    { isOk: false, error: 'That browser tab isn’t open on this computer' },
  );
});
