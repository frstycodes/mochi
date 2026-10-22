import { Effect, Exit, Layer, Scope } from 'effect';
import { RpcClient } from 'effect/rpc';
import { CoreRpcs } from './rpc.ts';
import { layerClient, type ClientPort } from './transport.ts';

/** The protocol lives as long as the caller's scope, not just until `make` returns. */
export const makeCoreClient = (port: ClientPort) => Effect.flatMap(Layer.build(layerClient(port)), (context) => RpcClient.make(CoreRpcs).pipe(Effect.provide(context)));

/** For callers outside Effect. `close` releases the port and drops the client from Core. */
export async function connectCore(port: ClientPort) {
  const scope = Scope.makeUnsafe();
  const client = await Effect.runPromise(Scope.provide(makeCoreClient(port), scope));
  return { client, close: () => Effect.runPromise(Scope.close(scope, Exit.void)) };
}
