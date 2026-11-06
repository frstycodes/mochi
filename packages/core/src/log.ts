import { Logger } from 'effect';
import electronLog from 'electron-log/node';

/** Effect's logfmt lines, appended by electron-log to `file`; main and windows forward theirs through the `log` procedure. */
export const layerLog = (file: string) => {
  electronLog.transports.file.resolvePathFn = () => file;
  electronLog.transports.file.format = '{text}';
  electronLog.transports.console.format = '{text}';
  return Logger.layer([
    Logger.map(Logger.formatLogFmt, (line) => electronLog.info(line)),
  ]);
};

/**
 * An error with its stack, from code outside Core's runtime: `Effect.runSync(Effect.log…)` there runs on Effect's default
 * logger, which writes to the console and never reaches the file.
 */
export function logErrorOutsideCore(message: string, cause: unknown) {
  const detail =
    cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);
  electronLog.error(
    `timestamp=${new Date().toISOString()} level=ERROR message=${JSON.stringify(message)} cause=${JSON.stringify(detail)}`,
  );
}
