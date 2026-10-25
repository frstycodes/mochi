let dataDir: (() => string) | undefined;

/** Mochi's data folder (Electron's `userData`): main reads it from `app` on use, Core gets the folder it was started with. */
export const setDataDir = (dir: string | (() => string)) =>
  void (dataDir = typeof dir === 'string' ? () => dir : dir);

export function userData() {
  if (!dataDir)
    throw new Error('Mochi’s data folder is read before setDataDir');
  return dataDir();
}
