import { tmpdir } from 'node:os';
import path from 'node:path';
import { Context, Effect, Layer } from 'effect';
import { accountHost, AccountService } from './account/service.ts';
import { dataHost } from './data/host.ts';
import { fs } from './fs/host.ts';
import { git } from './git/host.ts';
import { GitHub } from './github/service.ts';
import { setDataDir } from './agents/paths.ts';
import { hostMethods } from './hostMethods.ts';
import { Capabilities } from './hostServer.ts';
import { libraryHost } from './library/host.ts';
import { startLibraryUpdates } from './library/updates.ts';
import { ports } from './ports/host.ts';
import { projectsHost } from './projects/host.ts';
import { ptyHost } from './pty/host.ts';
import { remoteHost } from './remote/host.ts';
import { Remote } from './remote/tag.ts';
import { settingsHost } from './settings/host.ts';
import { useDocs } from './store/client.ts';
import { Store } from './store/store.ts';
import { themesHost } from './themes/host.ts';
import { usageHost } from './usage/host.ts';

/**
 * The `host.*` namespaces Core serves itself rather than relaying to main, so they work under `mochi serve` too. Their
 * modules read and write Core's documents through `store/client.ts`, pointed here at this process's store.
 */
export class Hosted extends Context.Service<Hosted>()('mochi/core/Hosted', {
  make: (userData: string | undefined) =>
    Effect.gen(function* () {
      const store = yield* Store;
      const github = yield* GitHub;
      const services = yield* Effect.context<never>();
      const run = <A, E>(effect: Effect.Effect<A, E>) =>
        Effect.runPromiseWith(services)(effect);
      useDocs({
        list: (table) => run(store.listDocs(table)),
        set: (table, key, value) => run(store.setDoc(table, key, value)),
        append: (input) => run(store.append(input)),
      });
      const capabilities = yield* Capabilities;
      const account = yield* AccountService;
      const remote = yield* Remote;
      // Tests run without a data folder; theirs is a scratch one.
      const data = userData ?? path.join(tmpdir(), 'mochi-core');
      setDataDir(data);
      if (userData) startLibraryUpdates();
      const forgetConnector = (id: string) =>
        capabilities.offers('main')
          ? run(
              capabilities.call({
                capability: 'main',
                method: 'forgetConnector',
                args: [id],
              }),
            ).then(() => {})
          : Promise.resolve();
      const namespaces = {
        git,
        fs,
        ports,
        projects: projectsHost(data),
        pty: ptyHost(data),
        data: dataHost(data),
        themes: themesHost(data),
        settings: settingsHost,
        account: accountHost(account),
        library: libraryHost(forgetConnector),
        remote: remoteHost(remote),
        usage: usageHost(data, (cwd, since, githubUser) =>
          run(github.authoredPrs(cwd, since, githubUser)),
        ),
      };
      return {
        /** `<ns>.<method>` handlers for one connection, which ends with the scope (its terminals with it). */
        handlers: (windowId: number | undefined) =>
          Effect.map(
            Effect.acquireRelease(
              Effect.sync(() => new AbortController()),
              (connection) => Effect.sync(() => connection.abort()),
            ),
            ({ signal: closed }) =>
              Object.fromEntries(
                Object.entries(namespaces).flatMap(([ns, methods]) =>
                  Object.entries(
                    hostMethods(ns, methods, { windowId, closed }),
                  ),
                ),
              ),
          ),
      };
    }),
}) {
  static readonly layer = (userData: string | undefined) =>
    Layer.effect(this, this.make(userData));
}
