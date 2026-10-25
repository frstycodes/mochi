import { Config } from 'effect';

/** Core's environment: main picks the port and the token when it forks Core. A malformed value fails startup with a `ConfigError`. */
export const coreConfig = Config.all({
  port: Config.Port('MOCHI_CORE_PORT'),
  token: Config.Redacted('MOCHI_CORE_TOKEN'),
  origins: Config.String('MOCHI_CORE_ORIGINS').pipe(
    Config.withDefault(''),
    Config.map((origins) => origins.split(',').filter(Boolean)),
  ),
  userData: Config.NonEmptyString('MOCHI_CORE_DATA'),
  logFile: Config.NonEmptyString('MOCHI_LOG_FILE'),
  // An OpenTelemetry collector's base URL: spans are exported there too.
  otlpUrl: Config.option(Config.URL('MOCHI_OTLP_URL')),
});
