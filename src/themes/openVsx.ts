import { parseJsonc } from './jsonc.ts';
import { kindOf, marketplaceThemeId, type ColorTheme, type ThemeKind } from './model.ts';
import { extractThemes, LIMITS } from './vsix.ts';
import type { Inflate } from './zip.ts';

/** One Open VSX extension that contributes color themes, as the theme browser lists it. */
export interface MarketplaceExtension {
  namespace: string;
  name: string;
  version: string;
  displayName: string;
  description: string;
  downloadCount: number;
  iconUrl?: string;
  themes: { label: string; kind: ThemeKind }[];
}

export interface SearchResult {
  /** Extensions Open VSX matched, including ones without color themes (icon themes share the category). */
  total: number;
  extensions: MarketplaceExtension[];
}

const API = 'https://open-vsx.org/api';
// Downloads redirect from the API to this CDN.
const HOSTS = new Set(['open-vsx.org', 'openvsx.eclipsecontent.org']);
export const PAGE_SIZE = 24;
const SEGMENT = /^[\w-][\w.-]{0,127}$/;
const VERSION = /^[\w.+-]{1,64}$/;

/** An extension reference from the renderer, checked before it becomes part of a URL. */
export function checkRef(namespace: unknown, name: unknown, version?: unknown) {
  if (typeof namespace !== 'string' || !SEGMENT.test(namespace)) throw new TypeError('namespace is not an Open VSX namespace');
  if (typeof name !== 'string' || !SEGMENT.test(name)) throw new TypeError('name is not an Open VSX extension name');
  if (version !== undefined && (typeof version !== 'string' || !VERSION.test(version))) throw new TypeError('version is not a version');
  return { namespace, name, version: version as string };
}

/** Open VSX search and package reads, shared by the main process and the web build; only inflating differs. */
export function createMarketplace(inflate: Inflate) {
  const inspected = new Map<string, Promise<ColorTheme[]>>();

  return {
    /** The Themes category, most downloaded first, keeping only extensions whose package.json contributes color themes. */
    async search(query: string, offset: number): Promise<SearchResult> {
      const params = new URLSearchParams({ category: 'Themes', size: String(PAGE_SIZE), offset: String(offset), sortBy: 'downloadCount', sortOrder: 'desc' });
      if (query.trim()) params.set('query', query.trim().slice(0, 128));
      const result = (await fetchJson(`${API}/-/search?${params}`)) as { totalSize?: number; extensions?: Record<string, unknown>[] };
      const hits = (result.extensions ?? []).filter((e) => typeof e.namespace === 'string' && typeof e.name === 'string' && typeof e.version === 'string');
      const extensions = await Promise.all(hits.map((hit) => withThemes(hit).catch(() => null)));
      return { total: result.totalSize ?? 0, extensions: extensions.filter((e) => !!e?.themes.length) as MarketplaceExtension[] };
    },

    /** Every color theme in one version's .vsix, downloaded and read but not stored. Cached for the session. */
    inspect(namespace: string, name: string, version: string, displayName = name): Promise<ColorTheme[]> {
      const key = `${namespace}.${name}@${version}`;
      let pending = inspected.get(key);
      if (!pending) {
        pending = download(namespace, name, version).then(async (bytes) =>
          (await extractThemes(bytes, inflate)).map(({ label, kind, theme }) => ({
            id: marketplaceThemeId(namespace, name, label),
            label,
            kind,
            source: { kind: 'marketplace' as const, namespace, name, version, displayName, publisher: namespace },
            theme,
          })),
        );
        pending.catch(() => inspected.delete(key));
        inspected.set(key, pending);
        // ponytail: drop the oldest past 32 packages; an LRU if browsing ever revisits pages a lot.
        if (inspected.size > 32) inspected.delete(inspected.keys().next().value!);
      }
      return pending;
    },
  };
}

async function withThemes(hit: Record<string, unknown>): Promise<MarketplaceExtension> {
  const { namespace, name, version } = checkRef(hit.namespace, hit.name, hit.version);
  const manifest = parseJsonc(await fetchText(`${API}/${namespace}/${name}/${version}/file/package.json`, LIMITS.fileBytes)) as { contributes?: { themes?: unknown } };
  const contributed = manifest?.contributes?.themes;
  const themes = Array.isArray(contributed)
    ? contributed.filter((t) => t && typeof t.path === 'string').map((t) => ({ label: typeof t.label === 'string' ? t.label : name, kind: kindOf(t.uiTheme) }))
    : [];
  const files = (hit.files ?? {}) as Record<string, unknown>;
  return {
    namespace,
    name,
    version,
    displayName: typeof hit.displayName === 'string' && hit.displayName ? hit.displayName : name,
    description: typeof hit.description === 'string' ? hit.description : '',
    downloadCount: typeof hit.downloadCount === 'number' ? hit.downloadCount : 0,
    iconUrl: typeof files.icon === 'string' && isAllowed(files.icon) ? files.icon : undefined,
    themes,
  };
}

export function download(namespace: string, name: string, version: string) {
  checkRef(namespace, name, version);
  return fetchBytes(`${API}/${namespace}/${name}/${version}/file/${namespace}.${name}-${version}.vsix`, LIMITS.packageBytes);
}

async function fetchJson(url: string) {
  return JSON.parse(await fetchText(url, LIMITS.fileBytes)) as unknown;
}

async function fetchText(url: string, maxBytes: number) {
  return new TextDecoder().decode(await fetchBytes(url, maxBytes));
}

/** GETs `url` (following redirects only to Open VSX's own hosts), refusing bodies past `maxBytes`. */
async function fetchBytes(url: string, maxBytes: number) {
  const response = await fetch(url, { headers: { Accept: 'application/json, application/octet-stream' } });
  if (!isAllowed(response.url || url)) throw new Error(`Open VSX redirected to ${new URL(response.url).host}`);
  if (!response.ok) throw new Error(`Open VSX answered ${response.status} for ${new URL(url).pathname}`);
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error(`The download is larger than ${maxBytes} bytes`);
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  return readCapped(response.body, maxBytes);
}

function isAllowed(url: string) {
  try {
    const { protocol, host } = new URL(url);
    return protocol === 'https:' && HOSTS.has(host);
  } catch {
    return false;
  }
}

/** Reads a byte stream whole, throwing once it passes `maxBytes`. */
export async function readCapped(stream: ReadableStream<Uint8Array>, maxBytes: number) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error(`The data is larger than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) out.set(chunk, (at += chunk.length) - chunk.length);
  return out;
}
