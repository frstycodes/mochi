import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Provider } from '../../../../apps/desktop/src/model.ts';
import { HARNESS_IDS } from '../../../../apps/desktop/src/settings/harnesses.ts';
import {
  composeInstructions,
  instructionsFileOf,
  SHARED_INSTRUCTIONS,
  type ProfileFolder,
} from '../../../../apps/desktop/src/settings/instructionFiles.ts';
import { userData } from './paths.ts';

// A long file would crowd every turn's context; past this it is cut, and Settings says how long it is.
const MAX_CHARS = 64 * 1024;

const folderOf = (spaceId: string) => join(userData(), 'profiles', spaceId);

/** The profile's folder with its files, made (empty) the first time so there is something to open. */
export async function profileFolder(spaceId: string): Promise<ProfileFolder> {
  const dir = folderOf(spaceId);
  await mkdir(dir, { recursive: true });
  const names = [
    { name: SHARED_INSTRUCTIONS, provider: null },
    ...HARNESS_IDS.map((provider) => ({
      name: instructionsFileOf(provider),
      provider,
    })),
  ];
  const files = await Promise.all(
    names.map(async ({ name, provider }) => {
      // 'wx' leaves an existing file alone.
      await writeFile(join(dir, name), '', { flag: 'wx' }).catch(() => {});
      const text = await readText(join(dir, name));
      return {
        name,
        provider,
        lines: text.trim() ? text.trimEnd().split('\n').length : 0,
      };
    }),
  );
  return { dir, files };
}

/** What a new thread in the profile gets on `provider`; empty when the folder or its files don't exist. */
export async function profileInstructions(spaceId: string, provider: Provider) {
  const dir = folderOf(spaceId);
  const [shared, own] = await Promise.all([
    readText(join(dir, SHARED_INSTRUCTIONS)),
    readText(join(dir, instructionsFileOf(provider))),
  ]);
  return composeInstructions(
    shared.slice(0, MAX_CHARS),
    own.slice(0, MAX_CHARS),
  );
}

/** Duplicating a profile copies its folder; a source with no folder yet copies nothing. */
export async function copyProfileFolder(fromId: string, toId: string) {
  await cp(folderOf(fromId), folderOf(toId), {
    recursive: true,
    force: false,
    errorOnExist: false,
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

const readText = (path: string) => readFile(path, 'utf8').catch(() => '');
