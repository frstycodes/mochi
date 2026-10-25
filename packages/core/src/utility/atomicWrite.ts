import { rename, writeFile } from 'node:fs/promises';

export async function writeFileAtomic(
  path: string,
  data: string,
  mode?: number,
) {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, data, { mode });
  await rename(tmp, path);
}
