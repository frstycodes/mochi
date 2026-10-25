import { app, BrowserWindow, dialog, shell } from 'electron';
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import type { ThemesHost } from '@mochi/domain/host/types/themes';
import {
  checkCustomFile,
  customFileName,
  customTheme,
} from '@mochi/domain/themes/custom';
import type { ColorTheme } from '@mochi/domain/themes/model';
import { checkRef, createMarketplace } from '@mochi/domain/themes/openVsx';
import { LIMITS, loadTheme } from '@mochi/domain/themes/vsix';
import type { Handlers } from './handlers.ts';

// userData/themes/<namespace>.<name>.json holds an installed extension's themes, already read out of its .vsix;
// userData/themes/custom/ holds the user's own theme files as written.
const root = () => join(app.getPath('userData'), 'themes');
const customDir = () => join(root(), 'custom');
const installedFile = (namespace: string, name: string) =>
  join(root(), `${namespace}.${name}.json`);

const marketplace = createMarketplace(async (data, maxBytes) =>
  inflateRawSync(data, { maxOutputLength: maxBytes }),
);

export const themes = {
  async list() {
    const installed = await readdir(root()).catch(() => [] as string[]);
    const extensions = await Promise.all(
      installed
        .filter((f) => f.endsWith('.json'))
        .map((f) => readJson<ColorTheme[]>(join(root(), f))),
    );
    const custom = await customFiles();
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
  async search(_sender, query, offset) {
    return marketplace.search(query, offset);
  },
  async inspect(_sender, namespace, name, version, displayName) {
    const ref = checkRef(namespace, name, version);
    return marketplace.inspect(
      ref.namespace,
      ref.name,
      ref.version,
      displayName,
    );
  },
  async install(_sender, namespace, name, version, displayName) {
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
  async uninstall(_sender, namespace, name) {
    const ref = checkRef(namespace, name);
    await rm(installedFile(ref.namespace, ref.name), { force: true });
  },
  async importFile(sender) {
    const window = BrowserWindow.fromWebContents(sender);
    const options = {
      properties: ['openFile'],
      filters: [{ name: 'VS Code color theme', extensions: ['json', 'jsonc'] }],
    } satisfies Electron.OpenDialogOptions;
    const { canceled, filePaths } = await (window
      ? dialog.showOpenDialog(window, options)
      : dialog.showOpenDialog(options));
    if (canceled || !filePaths[0]) return null;
    const dir = dirname(filePaths[0]);
    // Includes resolve next to the picked file and may not leave its folder (`resolvePath`).
    const theme = await loadTheme(basename(filePaths[0]), async (path) => {
      const file = join(dir, path);
      if ((await stat(file)).size > LIMITS.fileBytes)
        throw new Error(`${path} is larger than ${LIMITS.fileBytes} bytes`);
      return readFile(file, 'utf8');
    });
    const text = JSON.stringify(
      {
        ...theme,
        name: theme.name ?? basename(filePaths[0]).replace(/\.jsonc?$/i, ''),
      },
      null,
      2,
    );
    return saveCustomText(text);
  },
  async saveCustom(_sender, text, file) {
    return saveCustomText(
      text,
      file === undefined ? undefined : checkCustomFile(file),
    );
  },
  async readCustom(_sender, file) {
    return readFile(join(customDir(), checkCustomFile(file)), 'utf8');
  },
  async openCustom(_sender, file) {
    const error = await shell.openPath(
      join(customDir(), checkCustomFile(file)),
    );
    if (error) throw new Error(error);
  },
  async removeCustom(_sender, file) {
    await rm(join(customDir(), checkCustomFile(file)), { force: true });
  },
} satisfies Handlers<ThemesHost>;

async function saveCustomText(text: string, file?: string) {
  const name =
    file ??
    customFileName(
      customTheme('new.json', text).theme.name,
      await customFiles(),
    );
  const theme = customTheme(name, text);
  await mkdir(customDir(), { recursive: true });
  await writeFile(join(customDir(), name), text);
  return theme;
}

async function customFiles() {
  return (await readdir(customDir()).catch(() => [] as string[])).filter((f) =>
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
