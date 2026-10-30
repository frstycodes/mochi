import type { Transport } from './transport.ts';

/**
 * The secured channel main hands a window for another computer (`electron/remote/channels.ts`): a `MessagePort` carrying
 * that computer's Core RPCs, which main runs over its paired link. The device key and the handshake stay in main.
 */
export type ChannelRequest =
  | { id: number; tag: string; payload: unknown }
  | { id: number; cancel: true };

export type ChannelReply =
  | { id: number; item: unknown }
  | { id: number; value: unknown }
  | { id: number; end: true }
  | { id: number; error: string }
  /** The computer went offline or was forgotten: the channel is done. */
  | { closed: true };

/** What main posts with each port, as `window.postMessage` data (`electron/preload.ts`). */
export const CHANNEL_MESSAGE = 'backend:port';

interface Pending {
  onItem?: (item: unknown) => void;
  onEnd?: (error?: unknown) => void;
  resolve?: (value: unknown) => void;
  reject?: (error: unknown) => void;
}

/**
 * Another computer's Core over the port main gave this window. Once main closes it, calls reject and streams end silently,
 * so nothing follows it again: `onClosed` is where its entry leaves the registry.
 */
export function portTransport(
  port: MessagePort,
  onClosed: () => void,
): Transport {
  let next = 0;
  let isClosed = false;
  const pending = new Map<number, Pending>();
  const send = (request: ChannelRequest) => port.postMessage(request);

  port.onmessage = ({ data }: MessageEvent<ChannelReply>) => {
    if ('closed' in data) {
      isClosed = true;
      for (const p of pending.values())
        p.reject?.(new Error('That computer went offline'));
      pending.clear();
      port.close();
      return onClosed();
    }
    const p = pending.get(data.id);
    if (!p) return;
    if ('item' in data) return p.onItem?.(data.item);
    pending.delete(data.id);
    if ('value' in data) {
      p.resolve?.(data.value);
      p.onItem?.(data.value);
      return p.onEnd?.();
    }
    if ('end' in data) return p.onEnd?.();
    const error = new Error(data.error);
    p.reject?.(error);
    p.onEnd?.(error);
  };

  return {
    kind: 'device',
    call: (tag, payload) =>
      new Promise((resolve, reject) => {
        if (isClosed) return reject(new Error('That computer went offline'));
        const id = ++next;
        pending.set(id, { resolve, reject });
        send({ id, tag, payload });
      }),
    stream(tag, payload, onItem, onEnd) {
      if (isClosed) return () => {};
      const id = ++next;
      pending.set(id, { onItem, onEnd });
      send({ id, tag, payload });
      return () => {
        if (!pending.delete(id) || isClosed) return;
        send({ id, cancel: true });
      };
    },
  };
}
