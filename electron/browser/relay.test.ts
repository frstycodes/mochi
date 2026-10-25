import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test, vi } from 'vite-plus/test';
import { WebSocket } from 'ws';
import { createCdpRelayConnection, serveRelay, type CdpRelayTarget } from './relay.ts';

type Message = Record<string, unknown>;

const makeTarget = (send: CdpRelayTarget['send']): CdpRelayTarget => ({
  send,
  targetId: async () => 'GUEST-TARGET',
  url: () => 'http://localhost:4719/',
  title: () => 'Fixture',
  userAgent: () => 'Electron',
});

// Records what the relay writes; `reply(id)` resolves once the reply to that command id is written.
const recorder = () => {
  const written: Message[] = [];
  const waiting = new Map<unknown, () => void>();
  const write = (raw: string) => {
    const message = JSON.parse(raw) as Message;
    written.push(message);
    waiting.get(message['id'])?.();
  };
  const reply = (...ids: number[]) =>
    Promise.all(
      ids.map((id) =>
        written.some((message) => message['id'] === id)
          ? Promise.resolve()
          : new Promise<void>((resolve) => waiting.set(id, resolve)),
      ),
    );
  return { written, write, reply };
};

test('announces only the page, under its real target id', async () => {
  const { written, write, reply } = recorder();
  const relay = createCdpRelayConnection(makeTarget(vi.fn(async () => ({}))), write);
  relay.receive(JSON.stringify({ id: 1, method: 'Target.setAutoAttach', params: {} }));
  relay.receive(JSON.stringify({ id: 2, method: 'Target.createTarget', params: {} }));
  await reply(1, 2);
  const attach = written.findIndex((message) => message['id'] === 1);
  // The page is announced right after the auto-attach reply, never before it.
  assert.deepEqual(written.slice(attach, attach + 2), [
    { id: 1, result: {} },
    {
      method: 'Target.attachedToTarget',
      params: {
        sessionId: 'mochi-page',
        targetInfo: {
          targetId: 'GUEST-TARGET',
          type: 'page',
          title: 'Fixture',
          url: 'http://localhost:4719/',
          attached: true,
          canAccessOpener: false,
          browserContextId: 'mochi',
        },
        waitingForDebugger: false,
      },
    },
  ]);
  const failed = written.find((message) => message['id'] === 2)?.['error'] as { message: string } | undefined;
  assert.match(failed?.message ?? '', /createTarget/);
});

test('forwards page commands to the tab and lets a slow one finish last', async () => {
  const pending: Array<() => void> = [];
  const send = vi.fn((method: string) => new Promise<unknown>((resolve) => pending.push(() => resolve({ method }))));
  const { written, write, reply } = recorder();
  const relay = createCdpRelayConnection(makeTarget(send), write);
  relay.receive(JSON.stringify({ id: 5, method: 'Page.captureScreenshot', sessionId: 'mochi-page' }));
  relay.receive(JSON.stringify({ id: 6, method: 'DOM.enable', sessionId: 'iframe-session' }));
  // A slow screenshot must not hold up the reply behind it.
  pending[1]!();
  await reply(6);
  assert.deepEqual(written, [{ id: 6, result: { method: 'DOM.enable' }, sessionId: 'iframe-session' }]);
  pending[0]!();
  await reply(5);
  assert.deepEqual(send.mock.calls[0]!, ['Page.captureScreenshot', {}, undefined]);
  assert.deepEqual(send.mock.calls[1]!, ['DOM.enable', {}, 'iframe-session']);
  assert.deepEqual(written.at(-1), { id: 5, result: { method: 'Page.captureScreenshot' }, sessionId: 'mochi-page' });
});

test('resumes paused child frames, so cross-site iframes run', async () => {
  const send = vi.fn(async () => ({}));
  const { write, reply } = recorder();
  const relay = createCdpRelayConnection(makeTarget(send), write);
  // The page's own session is already running; only its children wait.
  relay.receive(JSON.stringify({ id: 1, method: 'Runtime.runIfWaitingForDebugger', sessionId: 'mochi-page' }));
  relay.receive(JSON.stringify({ id: 2, method: 'Runtime.runIfWaitingForDebugger', sessionId: 'iframe-session' }));
  await reply(1, 2);
  assert.deepEqual(
    send.mock.calls,
    [['Runtime.runIfWaitingForDebugger', {}, 'iframe-session']],
  );
});

test('routes page events to the page session once the page is announced', async () => {
  const { written, write, reply } = recorder();
  const relay = createCdpRelayConnection(makeTarget(vi.fn(async () => ({}))), write);
  relay.event('Page.loadEventFired', {}, undefined);
  assert.deepEqual(written, []);
  relay.receive(JSON.stringify({ id: 1, method: 'Target.setAutoAttach', params: {} }));
  await reply(1);
  // Electron passes an empty session id for the page's own events.
  relay.event('Page.loadEventFired', { timestamp: 1 }, '');
  relay.event('Runtime.consoleAPICalled', {}, 'iframe-session');
  assert.deepEqual(written.slice(-2), [
    { method: 'Page.loadEventFired', params: { timestamp: 1 }, sessionId: 'mochi-page' },
    { method: 'Runtime.consoleAPICalled', params: {}, sessionId: 'iframe-session' },
  ]);
});

test('gives a second page session the page commands and events', async () => {
  const send = vi.fn(async () => ({}));
  const { written, write, reply } = recorder();
  const relay = createCdpRelayConnection(makeTarget(send), write);
  relay.receive(JSON.stringify({ id: 1, method: 'Target.setAutoAttach', params: {} }));
  relay.receive(JSON.stringify({ id: 2, method: 'Target.attachToBrowserTarget' }));
  await reply(1, 2);
  const browserSession = (written.find((m) => m['id'] === 2)!['result'] as { sessionId: string }).sessionId;
  relay.receive(
    JSON.stringify({ id: 3, method: 'Target.attachToTarget', params: { targetId: 'GUEST-TARGET', flatten: true }, sessionId: browserSession }),
  );
  relay.receive(JSON.stringify({ id: 4, method: 'Target.attachToTarget', params: { targetId: 'SOMETHING-ELSE' }, sessionId: browserSession }));
  await reply(3, 4);
  const extra = (written.find((m) => m['id'] === 3)!['result'] as { sessionId: string }).sessionId;
  assert.ok(written.find((m) => m['id'] === 4)?.['error']);
  relay.receive(JSON.stringify({ id: 5, method: 'Page.startScreencast', sessionId: extra }));
  await reply(5);
  assert.deepEqual(send.mock.calls.at(-1), ['Page.startScreencast', {}, undefined]);
  written.length = 0;
  relay.event('Page.screencastFrame', { data: 'x' }, undefined);
  assert.deepEqual(
    written.map((m) => m['sessionId']),
    ['mochi-page', extra],
  );
});

test('acknowledges download behavior without touching the tab, and reports downloads on the root session', async () => {
  const send = vi.fn(async () => ({}));
  const { written, write, reply } = recorder();
  const relay = createCdpRelayConnection(makeTarget(send), write);
  relay.receive(JSON.stringify({ id: 1, method: 'Target.setAutoAttach', params: {} }));
  relay.receive(
    JSON.stringify({
      id: 2,
      method: 'Browser.setDownloadBehavior',
      params: { behavior: 'allowAndName', browserContextId: 'mochi', downloadPath: '/srv/artifacts', eventsEnabled: true },
    }),
  );
  await reply(1, 2);
  assert.deepEqual(written.find((m) => m['id'] === 2), { id: 2, result: {} });
  assert.equal(send.mock.calls.length, 0);
  written.length = 0;
  relay.event('Browser.downloadWillBegin', { guid: 'g1', suggestedFilename: 'r.csv' }, '');
  assert.deepEqual(written, [{ method: 'Browser.downloadWillBegin', params: { guid: 'g1', suggestedFilename: 'r.csv' } }]);
});

test('serveRelay listens on loopback under a random path and refuses a wrong path', async () => {
  const relay = await serveRelay(makeTarget(vi.fn(async () => ({}))));
  try {
    assert.match(relay.endpoint, /^ws:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}$/);
    const wrong = new WebSocket(new URL('/wrong', relay.endpoint));
    const [error] = (await once(wrong, 'error')) as [Error];
    assert.match(error.message, /400/);
  } finally {
    relay.close();
  }
});

test('serveRelay closes every connection after the first with 1008', async () => {
  const relay = await serveRelay(makeTarget(vi.fn(async () => ({}))));
  const sockets: WebSocket[] = [];
  try {
    const first = new WebSocket(relay.endpoint);
    sockets.push(first);
    await once(first, 'open');
    const second = new WebSocket(relay.endpoint);
    sockets.push(second);
    const [code] = await once(second, 'close');
    assert.equal(code, 1008);
  } finally {
    for (const socket of sockets) socket.close();
    relay.close();
  }
});

test('serveRelay answers a command sent over the accepted socket', async () => {
  const relay = await serveRelay(makeTarget(vi.fn(async () => ({}))));
  const socket = new WebSocket(relay.endpoint);
  try {
    await once(socket, 'open');
    socket.send(JSON.stringify({ id: 1, method: 'Browser.getVersion' }));
    const [raw] = await once(socket, 'message');
    const reply = JSON.parse(String(raw)) as { id: number; result: { product: string; userAgent: string } };
    assert.equal(reply.id, 1);
    assert.equal(reply.result.product, 'Electron');
    assert.equal(reply.result.userAgent, 'Electron');
  } finally {
    socket.close();
    relay.close();
  }
});
