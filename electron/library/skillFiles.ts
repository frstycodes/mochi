import { randomUUID } from 'node:crypto';
import { chmod, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

/**
 * Writes a skill's text files as its folder, replacing what Mochi wrote there before. Nothing is run: files are written,
 * and a script with a shebang only gets its execute bit back, which the stored text lost. A folder Mochi didn't write
 * (`isOurs` false) is the user's own skill and is never overwritten.
 */
export async function writeSkillFolder(dir: string, files: Record<string, string>, isOurs: boolean) {
  if ((await exists(dir)) && !isOurs) throw new Error(`${dir} already holds a skill Mochi didn't install; remove or rename it first`);
  const tmp = `${dir}.${randomUUID()}.tmp`;
  try {
    for (const [path, text] of Object.entries(files)) {
      const target = resolve(tmp, path);
      if (relative(tmp, target).startsWith('..')) throw new Error(`${path} points outside its skill folder`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, text);
      if (text.startsWith('#!')) await chmod(target, 0o755);
    }
    await rm(dir, { recursive: true, force: true });
    await rename(tmp, dir);
  } catch (error) {
    await rm(tmp, { recursive: true, force: true });
    throw error;
  }
}

export function removeSkillFolder(dir: string) {
  return rm(dir, { recursive: true, force: true });
}

async function exists(path: string) {
  return stat(path).then(() => true, () => false);
}
