import {
  MessageChannelMain,
  type MessagePortMain,
  type WebContents,
} from 'electron';
import { Cause, Effect, Fiber, Stream } from 'effect';
import type { DeviceClient } from '@mochi/core/remote/device';
import {
  CHANNEL_MESSAGE,
  type ChannelReply,
  type ChannelRequest,
} from '../../src/backends/channel.ts';

type Procedure = (
  payload: unknown,
) => Effect.Effect<unknown, unknown> | Stream.Stream<unknown, unknown>;

/**
 * Serves one window's port from a followed machine's client: each request runs that Core RPC over the paired link this side
 * already secured, and its answer or stream items go back. The machine's Core decides what this computer may call (scopes).
 */
export function serveChannel(port: MessagePortMain, client: DeviceClient) {
  const running = new Map<number, Fiber.Fiber<unknown, unknown>>();
  const post = (reply: ChannelReply) => port.postMessage(reply);
  const stop = (id: number) => {
    const fiber = running.get(id);
    running.delete(id);
    if (fiber) void Effect.runPromise(Fiber.interrupt(fiber));
  };

  port.on('message', ({ data }: { data: ChannelRequest }) => {
    if ('cancel' in data) return stop(data.id);
    const { id, tag, payload } = data;
    const procedure = (
      client as unknown as Record<string, Procedure | undefined>
    )[tag];
    if (typeof procedure !== 'function')
      return post({ id, error: `That computer has no ${tag}` });
    const result = procedure(payload);
    const run: Effect.Effect<ChannelReply, unknown> = Stream.isStream(result)
      ? Stream.runForEach(result, (item) =>
          Effect.sync(() => post({ id, item })),
        ).pipe(Effect.as({ id, end: true } as const))
      : Effect.map(result, (value) => ({ id, value }));
    running.set(
      id,
      Effect.runFork(
        run.pipe(
          Effect.matchCause({
            onSuccess: post,
            onFailure: (cause) => {
              if (Cause.hasInterruptsOnly(cause)) return;
              const error = Cause.squash(cause);
              post({
                id,
                error: error instanceof Error ? error.message : String(error),
              });
            },
          }),
          Effect.ensuring(Effect.sync(() => void running.delete(id))),
        ),
      ),
    );
  });
  port.on('close', () => [...running.keys()].forEach(stop));
  port.start();

  return () => {
    [...running.keys()].forEach(stop);
    post({ closed: true });
    port.close();
  };
}

/**
 * Every trusted window's channel to every followed machine that's online: opened when either appears, closed when the
 * machine goes offline or is forgotten, and opened again for a page that reloads (its old ports went with it).
 */
export function createChannels(isTrusted: (url: string) => boolean) {
  /** By window, then machine id. */
  const open = new Map<WebContents, Map<string, () => void>>();

  const closeWindow = (contents: WebContents) => {
    open.get(contents)?.forEach((close) => close());
    open.delete(contents);
  };

  /** One window's channels: closed for machines gone offline, opened for ones that came online. */
  const syncWindow = (
    contents: WebContents,
    online: ReadonlyMap<string, DeviceClient>,
  ) => {
    const channels = open.get(contents) ?? new Map<string, () => void>();
    open.set(contents, channels);
    for (const [machineId, close] of channels) {
      if (online.has(machineId)) continue;
      close();
      channels.delete(machineId);
    }
    for (const [machineId, client] of online) {
      if (channels.has(machineId)) continue;
      const { port1, port2 } = new MessageChannelMain();
      channels.set(machineId, serveChannel(port1, client));
      contents.postMessage(CHANNEL_MESSAGE, { machineId }, [port2]);
    }
  };

  return {
    /** `online` is each machine with a client while it's connected; call on any change to either side. */
    sync(windows: WebContents[], online: ReadonlyMap<string, DeviceClient>) {
      for (const contents of open.keys())
        if (contents.isDestroyed() || !windows.includes(contents))
          open.delete(contents);
      for (const contents of windows)
        if (!contents.isDestroyed() && isTrusted(contents.getURL()))
          syncWindow(contents, online);
    },
    /** A page loaded again: its ports are gone, so the next `sync` opens new ones. */
    reloaded: closeWindow,
  };
}
