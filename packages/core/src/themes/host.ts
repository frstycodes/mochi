import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import type { ThemesHost } from '@mochi/domain/host/types/themes';
import {
  checkCustomFile,
  customFileName,
  customTheme,
} from '@mochi/domain/themes/custom';
import type { ColorTheme } from '@mochi/domain/themes/model';
import { checkRef, createMarketplace } from '@mochi/domain/themes/openVsx';
import type { HostMethods } from '../hostMethods.ts';

/** Main keeps these: they open a file picker and the default editor. */
export type InMain = 'importFile' | 'openCustom';

// userData/themes/<namespace>.<name>.json holds an installed extension's themes, already read out of its .vsix;
// userData/themes/custom/ holds the user's own theme files as written.
const rootOf = (userData: string) => join(userData, 'themes');
export const customDirOf = (userData: string) =>
  join(rootOf(userData), 'custom');

const marketplace = createMarketplace(async (data, maxBytes) =>
  inflateRawSync(data, { maxOutputLength: maxBytes }),
);

/** `host.themes`, its files under `userData/themes`. */
export const themesHost = (userData: string) => {
  const root = () => rootOf(userData);
  const customDir = () => customDirOf(userData);
  const installedFile = (namespace: string, name: string) =>
    join(root(), `${namespace}.${name}.json`);
  return {
    async list() {
      const installed = await readdir(root()).catch(() => [] as string[]);
      const extensions = await Promise.all(
        installed
          .filter((f) => f.endsWith('.json'))
          .map((f) => readJson<ColorTheme[]>(join(root(), f))),
      );
      const custom = await customFiles(customDir());
      const customThemes = await Promise.all(
        custom.map(async (file) =>
          parsedOrNull(file, await readFile(join(customDir(), file), 'utf8')),
        ),
      );
      return [
        ...extensions.flatMap((e) => (Array.isArray(e) ? e : [])),
        ...customThemes.filter((t) => !!t),
      ];
    },
    async search(_caller, query, offset) {
      return marketplace.search(query, offset);
    },
    async inspect(_caller, namespace, name, version, displayName) {
      const ref = checkRef(namespace, name, version);
      return marketplace.inspect(
        ref.namespace,
        ref.name,
        ref.version,
        displayName,
      );
    },
    async install(_caller, namespace, name, version, displayName) {
      const ref = checkRef(namespace, name, version);
      const found = await marketplace.inspect(
        ref.namespace,
        ref.name,
        ref.version,
        displayName,
      );
      if (!found.length) throw new Error(`${displayName} has no color themes`);
      await mkdir(root(), { recursive: true });
      await writeFile(
        installedFile(ref.namespace, ref.name),
        JSON.stringify(found),
      );
      return found;
    },
    async uninstall(_caller, namespace, name) {
      const ref = checkRef(namespace, name);
      await rm(installedFile(ref.namespace, ref.name), { force: true });
    },
    async saveCustom(_caller, text, file) {
      return saveCustomText(
        userData,
        text,
        file === undefined ? undefined : checkCustomFile(file),
      );
    },
    async readCustom(_caller, file) {
      return readFile(join(customDir(), checkCustomFile(file)), 'utf8');
    },
    async removeCustom(_caller, file) {
      await rm(join(customDir(), checkCustomFile(file)), { force: true });
    },
  } satisfies HostMethods<Omit<ThemesHost, InMain>>;
};

/** Saves a custom theme as `file`, or under a fresh name from its own. */
export async function saveCustomText(
  userData: string,
  text: string,
  file?: string,
) {
  const dir = customDirOf(userData);
  const name =
    file ??
    customFileName(
      customTheme('new.json', text).theme.name,
      await customFiles(dir),
    );
  const theme = customTheme(name, text);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), text);
  return theme;
}

async function customFiles(dir: string) {
  return (await readdir(dir).catch(() => [] as string[])).filter((f) =>
    /\.jsonc?$/i.test(f),
  );
}

/** A file the user broke by hand drops out of the list instead of failing it. */
function parsedOrNull(file: string, text: string) {
  try {
    return customTheme(file, text);
  } catch (error) {
    console.warn(`themes: skipping custom/${file}:`, (error as Error).message);
    return null;
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}
