import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { Config, Console, Effect } from 'effect';
import { Command, Flag } from 'effect/cli';
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Capabilities } from '@mochi/schema';
import { version } from '../../../../package.json' with { type: 'json' };
import { launchCore } from '../launch.ts';
import { resolveAuth } from './auth.ts';

const serve = Command.make(
  'serve',
  {
    host: Flag.String('host').pipe(
      Flag.withDescription('Address to bind; beyond loopback needs --token'),
      Flag.withFallbackConfig(Config.String('MOCHI_SERVE_HOST')),
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
    data: Flag.String('data').pipe(
      Flag.withDescription(
        'Data folder; the desktop app’s works while the app is closed',
      ),
      Flag.withFallbackConfig(Config.NonEmptyString('MOCHI_CORE_DATA')),
      Flag.withDefault(path.join(homedir(), '.mochi', 'serve')),
    ),
  },
  (flags) =>
    Effect.gen(function* () {
      const auth = yield* resolveAuth(flags);
      mkdirSync(flags.data, { recursive: true });
      const url = `http://${flags.host}:${flags.port}`;
      yield* Console.log(
        auth.isGenerated
          ? `Mochi Core on ${url}/#token=${auth.token}`
          : `Mochi Core on ${url}`,
      );
      return yield* launchCore({
        host: flags.host,
        port: flags.port,
        tokens: auth.tokens,
        origins: auth.origins,
        userData: flags.data,
        // Built beside this file: dist-electron/serve.js and the renderer's dist/.
        ui: path.join(import.meta.dirname, '..', 'dist'),
        logFile: path.join(flags.data, 'logs', 'mochi.log'),
        otlpUrl: yield* Config.option(Config.URL('MOCHI_OTLP_URL')),
      });
    }),
).pipe(
  Command.withDescription('Run Core headless and serve the UI to a browser'),
);

const mochi = Command.make('mochi').pipe(Command.withSubcommands([serve]));

Command.run(mochi, { version }).pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);
