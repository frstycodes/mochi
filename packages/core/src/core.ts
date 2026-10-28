import { Effect, Redacted } from 'effect';
import { NodeRuntime } from '@effect/platform-node';
import { Capabilities } from '@mochi/schema';
import { osKind } from './backend/backend.ts';
import { coreConfig } from './config.ts';
import { launchCore } from './launch.ts';

// Core's entry: main forks it as a utilityProcess, and plain `node` runs it too (tests). `mochi serve` is `serve/serve.ts`.
const program = Effect.gen(function* () {
  const config = yield* coreConfig;
  return yield* launchCore({
    port: config.port,
    tokens: new Map([[Redacted.value(config.token), Capabilities.allScopes]]),
    origins: config.origins,
    userData: config.userData,
    backend: { kind: osKind(process.platform) },
    logFile: config.logFile,
    otlpUrl: config.otlpUrl,
  });
});

NodeRuntime.runMain(program);
