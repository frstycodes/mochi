import { isSharedSetting, settingsCatalog, type SettingSources } from '../settings/catalog.ts';

/** The shared settings' values as Settings reads them from `sources`; a row not loaded there is left out. */
export function sharedValues(sources: SettingSources): Record<string, string> {
  return Object.fromEntries(
    settingsCatalog().flatMap((row) => {
      const value = isSharedSetting(row.key) ? row.read(sources) : undefined;
      return value === undefined ? [] : [[row.key, value]];
    }),
  );
}

/** Keys both computers read and disagree on; one the other side doesn't know (an older Mochi) isn't a difference. */
export function driftedKeys(local: Record<string, string>, remote: Record<string, string>) {
  return Object.keys(local).filter((key) => key in remote && remote[key] !== local[key]);
}
