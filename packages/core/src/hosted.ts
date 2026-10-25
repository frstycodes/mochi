import { tmpdir } from 'node:os';
import path from 'node:path';
import { Context, Effect, Layer } from 'effect';
import { fs } from './fs/host.ts';
import { git } from './git/host.ts';
import { hostMethods } from './hostMethods.ts';
import { projectsHost } from './projects/host.ts';
import { useDocs } from './store/client.ts';
import { Store } from './store/store.ts';

/**
 * The `host.*` namespaces Core serves itself rather than relaying to main, so they work under `mochi serve` too. Their
 * modules read and write Core's documents through `store/client.ts`, pointed here at this process's store.
 */
export class Hosted extends Context.Service<Hosted>()('mochi/core/Hosted', {
  make: (userData: string | undefined) =>
    Effect.gen(function* () {
      const store = yield* Store;
      const services = yield* Effect.context<never>();
      const run = <A, E>(effect: Effect.Effect<A, E>) =>
        Effect.runPromiseWith(services)(effect);
      useDocs({
        list: (table) => run(store.listDocs(table)),
        set: (table, key, value) => run(store.setDoc(table, key, value)),
        append: (input) => run(store.append(input)),
      });
      // Tests run without a data folder; their uploaded icons go to a scratch one.
      const projects = projectsHost(
        userData ?? path.join(tmpdir(), 'mochi-core'),
      );
      return {
        /** `<ns>.<method>` handlers for one connection's window. */
        handlers: (windowId: number | undefined) => ({
          ...hostMethods('git', git, windowId),
          ...hostMethods('fs', fs, windowId),
          ...hostMethods('projects', projects, windowId),
        }),
      };
    }),
}) {
  static readonly layer = (userData: string | undefined) =>
    Layer.effect(this, this.make(userData));
}
