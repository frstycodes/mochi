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
