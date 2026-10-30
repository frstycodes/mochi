import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Config, Console, Effect, Option } from 'effect';
import { Command, Flag } from 'effect/cli';
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Capabilities } from '@mochi/schema';
import { version } from '../../../../package.json' with { type: 'json' };
import { chromiumLauncher, headlessBrowser } from '../browser/headless.ts';
import { launchCore } from '../launch.ts';
import { resolveAuth } from './auth.ts';
import { dataFlag, login, logout, offerLogin, serveFile } from './login.ts';

const serve = Command.make(
  'serve',
  {
    host: Flag.String('host').pipe(
      Flag.withDescription(
        'Address to bind; beyond loopback needs --token, --tls-cert and --tls-key',
      ),
      Flag.withDefault('127.0.0.1'),
    ),
    port: Flag.Int('port').pipe(
      Flag.withDescription('Port to bind'),
      Flag.withFallbackConfig(Config.Port('MOCHI_SERVE_PORT')),
      Flag.withDefault(4747),
    ),
    token: Flag.Redacted('token').pipe(
      Flag.withDescription(
        'Clients’ token, 43+ characters; generated on loopback when omitted',
      ),
      Flag.withFallbackConfig(Config.Redacted('MOCHI_SERVE_TOKEN')),
      Flag.optional,
    ),
    scopes: Flag.Literals('scope', Capabilities.allScopes).pipe(
      Flag.withDescription('Limit the token to these scopes (repeatable)'),
      Flag.atLeast(0),
    ),
    origins: Flag.String('origin').pipe(
      Flag.withDescription(
        'Another page origin allowed to connect, e.g. https://mochi.example (repeatable)',
      ),
      Flag.atLeast(0),
    ),
    tlsCert: Flag.String('tls-cert').pipe(
      Flag.withDescription('PEM certificate; serves https/wss'),
      Flag.optional,
    ),
    tlsKey: Flag.String('tls-key').pipe(
      Flag.withDescription('PEM private key for --tls-cert'),
      Flag.optional,
    ),
    data: dataFlag,
  },
  (flags) =>
    Effect.gen(function* () {
      const auth = yield* resolveAuth(flags);
      mkdirSync(flags.data, { recursive: true });
      yield* offerLogin(flags.data);
      const url = `${auth.tls ? 'https' : 'http'}://${flags.host}:${flags.port}`;
      yield* Console.log(
        auth.isGenerated
          ? `Mochi Core on ${url}/#token=${auth.token}`
          : `Mochi Core on ${url}`,
      );
      // `mochi login` in another shell finds this Core here, to follow its join.
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          writeFileSync(
            serveFile(flags.data),
            JSON.stringify({
              pid: process.pid,
              url: `${auth.tls ? 'wss' : 'ws'}://${dialHost(flags.host)}:${flags.port}/ws?v=${Capabilities.PROTOCOL_VERSION}`,
              token: auth.token,
              ...(Option.isSome(flags.tlsCert) && {
                certFile: path.resolve(flags.tlsCert.value),
              }),
            }),
            { mode: 0o600 },
          ),
        ),
        () => Effect.sync(() => rmSync(serveFile(flags.data), { force: true })),
      );
      return yield* launchCore({
        host: flags.host,
        port: flags.port,
        tokens: auth.tokens,
        origins: auth.origins,
        tls: Option.isSome(flags.tlsCert)
          ? {
              cert: readFileSync(flags.tlsCert.value),
              key: readFileSync(Option.getOrThrow(flags.tlsKey)),
            }
          : undefined,
        userData: flags.data,
        // Built beside this file: dist-electron/serve.js and the renderer's dist/.
        ui: path.join(import.meta.dirname, '..', 'dist'),
        // No main to own browser views: agents drive headless Chromium, downloaded here on first use.
        browserView: headlessBrowser(
          chromiumLauncher(path.join(flags.data, 'browsers')),
        ),
        // Once signed in: remote access on, through the relay, and each code a computer of yours shows to approve this one.
        serving: (line) => console.log(line),
        logFile: path.join(flags.data, 'logs', 'mochi.log'),
        otlpUrl: yield* Config.option(Config.URL('MOCHI_OTLP_URL')),
      });
    }).pipe(Effect.scoped),
).pipe(
  Command.withDescription('Run Core headless and serve the UI to a browser'),
);

/** Where a client on this computer dials: loopback when bound to every interface. */
const dialHost = (host: string) =>
  host === '0.0.0.0' || host === '::' || host === '[::]'
    ? '127.0.0.1'
    : host.includes(':') && !host.startsWith('[')
      ? `[${host}]`
      : host;

const mochi = Command.make('mochi').pipe(
  Command.withSubcommands([serve, login, logout]),
);

Command.run(mochi, { version }).pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
