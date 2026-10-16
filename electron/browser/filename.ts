import { extname } from 'node:path';

/** `name`, else `name (1)`, `name (2)`… with the number before the extension: the first one `isTaken` lets through. */
export function uniqueName(name: string, isTaken: (candidate: string) => boolean) {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let n = 1; isTaken(candidate); n++) candidate = `${stem} (${n})${ext}`;
  return candidate;
}
