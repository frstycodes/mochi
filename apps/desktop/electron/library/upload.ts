import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import {
  STANDALONE_PLUGIN,
  usesPluginRoot,
  type LibraryItem,
  type PluginReview,
} from '../../src/library/library.ts';
import {
  MANIFEST_PATHS,
  parsePluginBundle,
  type PluginBundle,
} from '@mochi/domain/library/pluginBundle';
import { readTar } from '../../src/library/tar.ts';
import type { Provider } from '../../src/model.ts';

/**
 * A plugin file the user uploads (LIBRARY.md): a zip (Claude's `.plugin` from Cowork is one) or a tar, read in memory and
 * never run. Anything that could write outside the plugin (`../`, absolute paths, links leaving it) rejects the whole file.
 */
export class UploadError extends Error {}

export const UPLOAD_LIMITS = {
  archiveBytes: 20_000_000,
  files: 2000,
  unpackedBytes: 50_000_000,
};
// Same caps as a marketplace plugin: the bundle is stored whole in library.json.
const MAX_TEXT_FILE_BYTES = 256 * 1024;
const MAX_PLUGIN_BYTES = 1_500_000;
const MARKETPLACE_PATH = '.claude-plugin/marketplace.json';
// Archivers’ own clutter, not part of the plugin; macOS tar adds a ._ AppleDouble file beside every entry.
const JUNK = /(^|\/)(__MACOSX\/|\._|\.DS_Store$|Thumbs\.db$)/;

export interface Unpacked {
  files: Map<string, string>;
  /** Files left out: not text, or over the per-file cap. */
  skipped: string[];
}

export async function unpackUpload(bytes: Uint8Array): Promise<Unpacked> {
  if (bytes.length > UPLOAD_LIMITS.archiveBytes)
    throw new UploadError(
      `The file is over ${UPLOAD_LIMITS.archiveBytes / 1_000_000} MB`,
    );
  const entries = await readEntries(bytes);
  const files = new Map<string, Uint8Array>();
  const links: { path: string; target: string }[] = [];
  for (const entry of entries) {
    const path = safePath(entry.path);
    if (path === null || JUNK.test(path)) continue;
    if (entry.link === undefined) files.set(path, entry.body);
    else
      links.push({
        path,
        target: linkTarget(path, entry.link, entry.isHardLink),
      });
  }
  // A link inside the plugin becomes a copy of what it points at; one to nothing in the archive is dropped.
  for (const { path, target } of links) {
    const body = files.get(target);
    if (body) files.set(path, body);
  }
  return decodeText(stripTopFolder(files));
}

type Entry = {
  path: string;
  body: Uint8Array;
  link?: string;
  isHardLink?: boolean;
};

async function readEntries(bytes: Uint8Array): Promise<Entry[]> {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const isTar = new TextDecoder().decode(bytes.subarray(257, 262)) === 'ustar';
  if (isZip) return readZip(bytes);
  if (isGzip || isTar) return readTarball(bytes, isGzip);
  throw new UploadError(
    'Not a plugin archive: upload a .plugin, .zip, .tar.gz or .tgz file',
  );
}

const budget = () => {
  let count = 0;
  let total = 0;
  return (size: number) => {
    if (++count > UPLOAD_LIMITS.files)
      throw new UploadError(`It holds over ${UPLOAD_LIMITS.files} files`);
    if ((total += size) > UPLOAD_LIMITS.unpackedBytes)
      throw new UploadError(
        `It unpacks to over ${UPLOAD_LIMITS.unpackedBytes / 1_000_000} MB`,
      );
  };
};

async function readTarball(
  bytes: Uint8Array,
  isGzip: boolean,
): Promise<Entry[]> {
  const spend = budget();
  const entries: Entry[] = [];
  const raw = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream();
  const stream = isGzip
    ? raw.pipeThrough(new DecompressionStream('gzip'))
    : raw;
  const onLink = (path: string, target: string, isHardLink: boolean) => {
    spend(0);
    entries.push({ path, body: new Uint8Array(), link: target, isHardLink });
  };
  try {
    const accept = (_path: string, size: number) => (spend(size), true);
    for await (const { path, body } of readTar(stream, accept, {
      onLink: (path, target, type) => onLink(path, target, type === 'hardlink'),
    }))
      entries.push({ path, body });
  } catch (error) {
    if (error instanceof UploadError) throw error;
    throw new UploadError(
      `The archive is damaged: ${(error as Error).message}`,
    );
  }
  return entries;
}

// Zip's central directory: the end record, then one header per entry pointing at its local header and data.
function readZip(bytes: Uint8Array): Entry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (
    let at = bytes.length - 22;
    at >= Math.max(0, bytes.length - 65_557);
    at--
  )
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  if (end < 0)
    throw new UploadError(
      'The archive is damaged: no zip directory at its end',
    );
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  if (count === 0xffff || at === 0xffffffff)
    throw new UploadError('Zip64 archives aren’t supported');
  const spend = budget();
  const entries: Entry[] = [];
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50)
      throw new UploadError('The archive is damaged: a zip entry is cut off');
    const madeBy = view.getUint16(at + 4, true) >> 8;
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const next =
      at +
      46 +
      nameLength +
      view.getUint16(at + 30, true) +
      view.getUint16(at + 32, true);
    const mode = view.getUint32(at + 38, true) >>> 16;
    const local = view.getUint32(at + 42, true);
    const path = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at = next;
    if (path.endsWith('/')) continue;
    if (flags & 1) throw new UploadError(`${path} is encrypted`);
    spend(size);
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50)
      throw new UploadError(`The archive is damaged at ${path}`);
    const start =
      local +
      30 +
      view.getUint16(local + 26, true) +
      view.getUint16(local + 28, true);
    const body = inflate(
      bytes.subarray(start, start + compressed),
      method,
      size,
      path,
    );
    // Unix zips (made-by 3) keep the file type in the high bits of the external attributes; 0o120000 is a symlink.
    const isLink = madeBy === 3 && (mode & 0o170000) === 0o120000;
    entries.push(
      isLink
        ? { path, body: new Uint8Array(), link: decoder.decode(body) }
        : { path, body },
    );
  }
  return entries;
}

function inflate(data: Uint8Array, method: number, size: number, path: string) {
  if (method === 0) return data;
  if (method !== 8)
    throw new UploadError(`${path} uses a zip compression Mochi can’t read`);
  try {
    // Capped at the declared size, so an entry lying about it can't inflate past the budget.
    return new Uint8Array(
      inflateRawSync(data, { maxOutputLength: Math.max(size, 1) }),
    );
  } catch {
    throw new UploadError(`The archive is damaged at ${path}`);
  }
}

/** The entry's path inside the plugin, or null for a folder entry; throws for one that would land outside it. */
function safePath(raw: string) {
  if (raw.includes('\\') || raw.includes('\0'))
    throw new UploadError(`${raw} has a path Mochi won’t unpack`);
  if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw))
    throw new UploadError(`${raw} is an absolute path`);
  if (raw.split('/').includes('..'))
    throw new UploadError(`${raw} points outside the plugin`);
  const path = raw.replace(/^(\.\/)+/, '');
  return path && !path.endsWith('/') ? path : null;
}

// A symlink's target is relative to its own folder; a hard link's names another entry from the archive root.
function linkTarget(path: string, target: string, isHardLink = false) {
  if (target.startsWith('/') || /^[a-zA-Z]:/.test(target))
    throw new UploadError(`${path} links to ${target}, outside the plugin`);
  const resolved = posix.normalize(
    isHardLink ? target : posix.join(posix.dirname(path), target),
  );
  if (resolved === '..' || resolved.startsWith('../'))
    throw new UploadError(`${path} links to ${target}, outside the plugin`);
  return resolved.replace(/^\.\//, '');
}

// Zipping the folder rather than its contents puts everything under one top folder (my-plugin/.claude-plugin/plugin.json).
function stripTopFolder(files: Map<string, Uint8Array>) {
  const paths = [...files.keys()];
  const top = paths[0]?.split('/')[0];
  const isWrapped =
    !!top &&
    paths.every((path) => path.startsWith(`${top}/`)) &&
    [...MANIFEST_PATHS, MARKETPLACE_PATH].some((path) =>
      files.has(`${top}/${path}`),
    );
  if (!isWrapped || paths.some((path) => MANIFEST_PATHS.includes(path)))
    return files;
  return new Map(
    [...files].map(([path, body]) => [path.slice(top.length + 1), body]),
  );
}

function decodeText(files: Map<string, Uint8Array>): Unpacked {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const text = new Map<string, string>();
  const skipped: string[] = [];
  for (const [path, body] of files) {
    if (body.length > MAX_TEXT_FILE_BYTES || body.includes(0)) {
      skipped.push(path);
      continue;
    }
    try {
      text.set(path, decoder.decode(body));
    } catch {
      skipped.push(path);
    }
  }
  return { files: text, skipped: skipped.sort() };
}

/** What the upload installs, for the review step; throws when it isn't a plugin Mochi can load. */
export function reviewUpload(
  fileName: string,
  bytes: Uint8Array,
  { files, skipped }: Unpacked,
  items: LibraryItem[],
): { review: PluginReview; bundle: PluginBundle } {
  const manifestPath = MANIFEST_PATHS.find((path) => files.has(path));
  if (!manifestPath) {
    if (files.has(MARKETPLACE_PATH))
      throw new UploadError(
        'This is a marketplace, not a plugin: add its repository with Add marketplace',
      );
    throw new UploadError(
      'No plugin manifest: a plugin has .claude-plugin/plugin.json (Claude Code) or plugin.json (Codex) at its root',
    );
  }
  const manifest = parseManifest(files.get(manifestPath)!, manifestPath);
  if (typeof manifest.name !== 'string' || !manifest.name.trim())
    throw new UploadError(
      `${manifestPath} has no name, which every plugin needs`,
    );
  const bundle = parsePluginBundle(manifest.name, files);
  if (bundle.name === STANDALONE_PLUGIN)
    throw new UploadError(
      `${STANDALONE_PLUGIN} is the name Mochi gives its own skills; this plugin can't take it`,
    );
  const size = [...files.values()].reduce(
    (total, text) => total + text.length,
    0,
  );
  if (size > MAX_PLUGIN_BYTES)
    throw new UploadError(
      `Its text files come to over ${MAX_PLUGIN_BYTES / 1_000_000} MB, more than Mochi stores per plugin`,
    );
  const loads = harnessLoads(bundle);
  if (!loads.claude && !loads.codex && !bundle.remotes.length)
    throw new UploadError(
      bundle.unsupported.length
        ? `Nothing in it loads from Mochi (it has ${bundle.unsupported.join(', ').toLowerCase()})`
        : 'It has no skills, commands, agents, hooks or MCP servers',
    );
  const existing = items.flatMap((item) =>
    item.kind === 'plugin' && item.bundle.name === bundle.name ? [item] : [],
  )[0];
  const review: PluginReview = {
    file: fileName,
    sha256: sha256(bytes),
    name: bundle.name,
    title: bundle.title ?? bundle.name,
    version: bundle.version,
    author: personName(manifest.author),
    description: bundle.description,
    skills: bundle.skills.map(({ name, description }) => ({
      name,
      description,
    })),
    agents: bundle.subagents.map(({ name, description }) => ({
      name,
      description,
    })),
    hooks: bundle.hooks.map(({ event, matcher, handler }) => ({
      event,
      matcher,
      condition: typeof handler.if === 'string' ? handler.if : null,
      type: handler.type,
      run: hookRun(handler),
    })),
    servers: bundle.servers.map(({ name, command, args, env }) => ({
      name,
      run: [command, ...args].join(' '),
      env: Object.keys(env),
    })),
    remotes: bundle.remotes,
    unsupported: bundle.unsupported,
    skipped,
    loads,
    existing: existing
      ? {
          id: existing.id,
          title: existing.bundle.title ?? existing.bundle.name,
          isUpload: !!existing.upload,
        }
      : null,
  };
  return { review, bundle };
}

export function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** What each harness gets from it through Mochi, or null when nothing (LIBRARY.md: Codex threads get servers only). */
function harnessLoads(bundle: PluginBundle): Record<Provider, string | null> {
  const claude = [
    [bundle.skills.length, 'skill'],
    [bundle.subagents.length, 'agent'],
    [bundle.hooks.length, 'hook'],
    [bundle.servers.length, 'server'],
  ] as const;
  const codexServers = bundle.servers.filter(
    (server) => !usesPluginRoot(server),
  ).length;
  return {
    claude: countList(claude),
    codex: countList([[codexServers, 'server']]),
  };
}

const PLURAL = new Intl.PluralRules('en');

function countList(counts: readonly (readonly [number, string])[]) {
  return (
    counts
      .filter(([n]) => n)
      .map(
        ([n, noun]) => `${n} ${PLURAL.select(n) === 'one' ? noun : `${noun}s`}`,
      )
      .join(', ') || null
  );
}

/** A hook's command exactly as the plugin wrote it; another kind (prompt, http) shows its whole config. */
function hookRun({ type, ...rest }: PluginBundle['hooks'][number]['handler']) {
  if (type === 'command' && typeof rest.command === 'string')
    return [
      rest.command,
      ...(Array.isArray(rest.args) ? rest.args.map(String) : []),
    ].join(' ');
  return JSON.stringify(rest);
}

function parseManifest(text: string, path: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed))
      return parsed as Record<string, unknown>;
  } catch {}
  throw new UploadError(`${path} isn't valid JSON`);
}

function personName(value: unknown) {
  if (typeof value === 'string' && value) return value;
  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string'
  )
    return (value as { name: string }).name;
  return null;
}
