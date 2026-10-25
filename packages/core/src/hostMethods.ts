import { Effect, Schema } from 'effect';
import { definitionOf } from '@mochi/schema';

/** Who made a `host.*` call Core serves itself: the window it came from (none for a served browser), and its cancellation. */
export interface Caller {
  readonly windowId: number | undefined;
  /** Aborts when the call is interrupted, as when its socket closes. */
  readonly signal: AbortSignal;
  /** Aborts when the caller's connection closes: one per connection, so it also names it. */
  readonly closed: AbortSignal;
}

/** A `host.<ns>` interface's promise methods as Core serves them, the caller first. Event methods arrive through `push`. */
export type HostMethods<T> = {
  [
    K in keyof T as T[K] extends (...args: never[]) => Promise<unknown>
      ? K
      : never
  ]: T[K] extends (...args: infer A) => infer R
    ? (caller: Caller, ...args: A) => R
    : never;
};

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * `<ns>.<method>` RPC handlers for `methods`. Args arrive decoded by `HostRpcs`; results go through each method's JSON codec
 * and back, as they did when main answered (`hostHandlers`). Spread after `hostHandlers`, they take those tags from main.
 */
export const hostMethods = (
  ns: string,
  methods: object,
  { windowId, closed }: Omit<Caller, 'signal'>,
) =>
  Object.fromEntries(
    Object.entries(methods).map(([method, handle]) => {
      const tag = `${ns}.${method}`;
      const output = Schema.toCodecJson(definitionOf(tag).output);
      return [
        tag,
        (args: ReadonlyArray<unknown>) =>
          Effect.tryPromise({
            try: (signal) =>
              (handle as (...args: unknown[]) => Promise<unknown>)(
                { windowId, signal, closed } satisfies Caller,
                ...args,
              ),
            catch: messageOf,
          }).pipe(
            Effect.flatMap((value) =>
              Schema.encodeUnknownEffect(output)(value).pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(output)),
                Effect.mapError(messageOf),
              ),
            ),
          ),
      ];
    }),
  );
