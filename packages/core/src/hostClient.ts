import { Cause, Effect, Exit, Layer } from 'effect';
import { RpcClient } from 'effect/rpc';
import { HostRpcs } from '@mochi/schema';
import { layerClient, type ClientPort } from './transport.ts';

type HostClient = Record<string, (args: ReadonlyArray<unknown>) => Effect.Effect<unknown, string>>;

/** Calls `<namespace>.<method>` over `port`. A failure rejects with an `Error` carrying the handler's message. */
export const makeHostCaller = (port: ClientPort) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(layerClient(port));
    const client = (yield* (RpcClient.make(HostRpcs) as Effect.Effect<unknown>).pipe(Effect.provide(context))) as HostClient;
    return async (tag: string, args: ReadonlyArray<unknown>) => {
      const exit = await Effect.runPromiseExit(client[tag]!(args));
      if (Exit.isSuccess(exit)) return exit.value;
      const error = Cause.squash(exit.cause);
      throw new Error(typeof error === 'string' ? error : error instanceof Error ? error.message : String(error));
    };
  });
