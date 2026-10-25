import { expect, it } from '@effect/vitest';
import { Config, ConfigProvider, Effect, Redacted } from 'effect';
import { coreConfig } from './config.ts';

const env = {
  MOCHI_CORE_PORT: '47100',
  MOCHI_CORE_TOKEN: 'secret',
  MOCHI_CORE_DATA: '/tmp/mochi',
  MOCHI_LOG_FILE: '/tmp/mochi/core.log',
};
const parse = (overrides: Record<string, string>) =>
  coreConfig.parse(ConfigProvider.fromEnvRecord({ ...env, ...overrides }));

it.effect('reads Core options from the environment', () =>
  Effect.gen(function* () {
    const config = yield* parse({ MOCHI_CORE_ORIGINS: 'a,,b' });
    expect(config.port).toBe(47100);
    expect(Redacted.value(config.token)).toBe('secret');
    expect(config.origins).toEqual(['a', 'b']);
  }),
);

it.effect('a malformed port fails with a ConfigError', () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(parse({ MOCHI_CORE_PORT: 'abc' }));
    expect(error).toBeInstanceOf(Config.ConfigError);
  }),
);
