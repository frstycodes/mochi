import type { ThemesHost } from '../types/themes.ts';
import { checkCustomFile, customFileName, customTheme } from '../../themes/custom.ts';
import type { ColorTheme } from '../../themes/model.ts';
import { checkRef, createMarketplace, readCapped } from '../../themes/openVsx.ts';
import { LIMITS } from '../../themes/vsix.ts';

// The web build talks to Open VSX straight from the page (its API and CDN send `Access-Control-Allow-Origin: *`) and keeps
// installed and custom themes in localStorage.
const KEY = 'mochi.themes.v1';

interface Stored {
  installed: ColorTheme[];
  custom: Record<string, string>;
}

const marketplace = createMarketplace((data, maxBytes) => readCapped(new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')), maxBytes));

export const themes: ThemesHost = {
  async list() {
    const { installed, custom } = load();
    return [...installed, ...Object.entries(custom).flatMap(([file, text]) => parsed(file, text))];
  },
  search: (query, offset) => marketplace.search(query, offset),
  inspect: (namespace, name, version, displayName) => marketplace.inspect(namespace, name, version, displayName),
  async install(namespace, name, version, displayName) {
    checkRef(namespace, name, version);
    const found = await marketplace.inspect(namespace, name, version, displayName);
    if (!found.length) throw new Error(`${displayName} has no color themes`);
    const stored = load();
    save({ ...stored, installed: [...stored.installed.filter((t) => !isFrom(t, namespace, name)), ...found] });
    return found;
  },
  async uninstall(namespace, name) {
    const stored = load();
    save({ ...stored, installed: stored.installed.filter((t) => !isFrom(t, namespace, name)) });
  },
  async importFile() {
    const file = await pickFile();
    if (!file) return null;
    if (file.size > LIMITS.fileBytes) throw new Error(`${file.name} is larger than ${LIMITS.fileBytes} bytes`);
    return themes.saveCustom(await file.text());
  },
  async saveCustom(text, file) {
    const stored = load();
    const name = file ? checkCustomFile(file) : customFileName(customTheme('new.json', text).theme.name, Object.keys(stored.custom));
    const theme = customTheme(name, text);
    save({ ...stored, custom: { ...stored.custom, [name]: text } });
    return theme;
  },
  async readCustom(file) {
    const text = load().custom[file];
    if (text === undefined) throw new Error(`No custom theme ${file}`);
    return text;
  },
  async openCustom() {
    throw new Error('Opening theme files needs the desktop app');
  },
  async removeCustom(file) {
    const { [file]: _, ...custom } = load().custom;
    save({ ...load(), custom });
  },
};

const isFrom = (theme: ColorTheme, namespace: string, name: string) => theme.source.kind === 'marketplace' && theme.source.namespace === namespace && theme.source.name === name;

function parsed(file: string, text: string) {
  try {
    return [customTheme(file, text)];
  } catch {
    return [];
  }
}

function load(): Stored {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Stored>;
    return { installed: Array.isArray(parsed.installed) ? parsed.installed : [], custom: parsed.custom && typeof parsed.custom === 'object' ? parsed.custom : {} };
  } catch {
    return { installed: [], custom: {} };
  }
}

function save(stored: Stored) {
  try {
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    throw new Error('The browser refused to store the theme (storage full or blocked)');
  }
}

function pickFile() {
  return new Promise<File | null>((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,.jsonc,application/json' });
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
