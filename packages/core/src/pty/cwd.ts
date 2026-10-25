import { statSync } from 'node:fs';
import path from 'node:path';

/** Thread cwds are relative to the main process cwd (see src/host/cwd.ts); anything that isn't an existing directory is refused. */
export function resolveCwd(value: string) {
  const dir = path.resolve(process.cwd(), value);
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory())
    throw new Error(`cwd is not a directory: ${dir}`);
  return dir;
}
