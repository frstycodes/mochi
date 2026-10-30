import { Effect, Stream } from 'effect';
import { coreClient } from '../host/desktop/rpc.ts';

/**
 * How the interface reaches one Core: its RPCs called by tag, the way `CoreWsRpcs` names them. This computer's Core is
 * `loopback`; another computer's is a `device` channel main secured (`portTransport`); the web build without a Core is `page`.
 */
export interface Transport {
  kind: 'loopback' | 'device' | 'page';
  /** A request/response RPC; rejects with Core's refusal or a dropped connection. */
  call: (tag: string, payload?: unknown) => Promise<unknown>;
  /** A streaming RPC: each item, then `onEnd` (with the error when it failed). Returns a stop. */
  stream: (
    tag: string,
    payload: unknown,
    onItem: (item: unknown) => void,
    onEnd: (error?: unknown) => void,
  ) => () => void;
}

type LooseClient = Record<
  string,
  (
    payload?: unknown,
  ) => Effect.Effect<unknown, unknown> | Stream.Stream<unknown, unknown>
>;
const loose = async () => (await coreClient()) as unknown as LooseClient;

/** This computer's Core over the window's own socket (`coreClient`). */
export function loopbackTransport(): Transport {
  return {
    kind: 'loopback',
    call: async (tag, payload) =>
      Effect.runPromise(
        (await loose())[tag]!(payload) as Effect.Effect<unknown, unknown>,
      ),
    stream(tag, payload, onItem, onEnd) {
      const abort = new AbortController();
      const run = Effect.promise(loose).pipe(
        Effect.flatMap((core) =>
          Stream.runForEach(
            core[tag]!(payload) as Stream.Stream<unknown, unknown>,
            (item) => Effect.sync(() => onItem(item)),
          ),
        ),
      );
      Effect.runPromise(run, { signal: abort.signal }).then(
        () => onEnd(),
        (error: unknown) => !abort.signal.aborted && onEnd(error),
      );
      return () => abort.abort();
    },
  };
}

/** The web build: no Core to call; its store logs in the page (`pageLog`). */
export function pageTransport(): Transport {
  const none = () => new Error('This page has no Core');
  return {
    kind: 'page',
    call: () => Promise.reject(none()),
    stream(_tag, _payload, _onItem, onEnd) {
      queueMicrotask(() => onEnd(none()));
      return () => {};
    },
  };
}
