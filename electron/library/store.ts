import { app } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { EMPTY_LIBRARY, FEATURED_MARKETPLACES, itemName, parseLibrary, profileLayout, STANDALONE_PLUGIN, type LibraryIndex, type LibraryItem, type Marketplace } from '../../src/library/library.ts';
import type { Provider } from '../../src/model.ts';
import { skillMeta, stripSecrets, type McpServerDef } from '../../src/settings/agentConfig.ts';
import { expand, expandAll, readProfileConfig } from '../agents/profileConfig.ts';
import { CatalogError, discoverSkills, fetchMarketplace, fetchPluginBundle, normalizeMarketplaceSource } from './catalog.ts';

/**
 * The library index in userData/library.json, and each profile's plugin folders under userData/library/<profile>/, one
 * folder per content hash so a running session never sees one change under it.
 */
const indexFile = () => join(app.getPath('userData'), 'library.json');
const foldersRoot = () => join(app.getPath('userData'), 'library');

let index: Promise<LibraryIndex> | undefined;
let writes = Promise.resolve();

export function readLibrary(): Promise<LibraryIndex> {
  index ??= readFile(indexFile(), 'utf8').then(parseLibrary, () => EMPTY_LIBRARY);
  return index;
}

/** Changes apply one at a time, so two quick edits can't drop each other. */
export function updateLibrary(change: (current: LibraryIndex) => LibraryIndex): Promise<LibraryIndex> {
  const next = writes.then(async () => {
    const updated = change(await readLibrary());
    const tmp = `${indexFile()}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(updated), { mode: 0o600 });
    await rename(tmp, indexFile());
    index = Promise.resolve(updated);
    return updated;
  });
  writes = next.then(() => {}, () => {});
  return next;
}

/** What a new session of the profile loads: plugin folders (Claude) and servers with their `${VAR}`s filled in. */
export async function sessionLibrary(spaceId: string, provider: Provider): Promise<{ pluginDirs: string[]; servers: McpServerDef[] }> {
  const { plugins, servers } = profileLayout(await readLibrary(), spaceId, provider);
  const pluginDirs = await Promise.all(Object.entries(plugins).map(([name, files]) => pluginFolder(spaceId, name, files)));
  if (!pruned.has(spaceId)) await prune(spaceId, pluginDirs);
  return { pluginDirs, servers: servers.map(expandServer) };
}

/** Copies the account's own skills and servers into the library, turned on for the profile. Secrets become `${VAR}` notes. */
export async function importFromAccount(spaceId: string, provider: Provider, parts: ('skills' | 'mcp')[]): Promise<string[]> {
  const config = (await readProfileConfig(spaceId))[provider];
  if (config.error) throw new Error(config.error);
  const notes: string[] = [];
  const added: LibraryItem[] = [];
  if (parts.includes('skills'))
    for (const skill of config.skills) {
      const { files, skipped } = await readSkillFolder(skill.dir);
      if (skipped.length) notes.push(`${skill.name}: left out ${skipped.join(', ')} (not text, or over ${MAX_FILE_BYTES / 1024} KB).`);
      const { name, description } = skillMeta(files['SKILL.md'] ?? '', skill.name);
      added.push({ kind: 'skill', id: randomUUID(), name, description, files, targets: [provider], addedAt: Date.now(), source: null, icon: null });
    }
  if (parts.includes('mcp'))
    for (const server of config.mcpServers) {
      if (server.scope !== 'user') continue;
      const { def, stripped } = stripSecrets(server.def);
      if (stripped.length) notes.push(`${def.name}: ${stripped.join(', ')} not copied. Set ${stripped.length === 1 ? 'it' : 'them'} in your environment.`);
      added.push({ kind: 'server', id: randomUUID(), def, targets: [provider], addedAt: Date.now() });
    }
  await updateLibrary((current) => {
    const taken = new Set(current.items.map((item) => `${item.kind}:${itemName(item)}`));
    const fresh = added.filter((item) => {
      const isTaken = taken.has(`${item.kind}:${itemName(item)}`);
      if (isTaken) notes.push(`${itemName(item)}: skipped, the library already has one with that name.`);
      return !isTaken;
    });
    return { ...current, items: [...current.items, ...fresh], profiles: { ...current.profiles, [spaceId]: [...(current.profiles[spaceId] ?? []), ...fresh.map((item) => item.id)] } };
  });
  return notes;
}

/** Installs (or reinstalls, keeping its id and profiles) one skill found in a GitHub repo, and turns it on for the profile. */
export async function installSkill(spaceId: string, source: string, name: string) {
  const found = (await discoverSkills(source)).find((skill) => skill.name === name);
  if (!found) throw new CatalogError(`${name} isn't in ${source}`);
  await install(spaceId, { kind: 'skill', id: randomUUID(), name: found.name, description: found.description, files: found.files, source: found.source, icon: found.icon, targets: ['claude', 'codex'], addedAt: Date.now() });
}

export async function installPlugin(spaceId: string, marketplaceName: string, name: string) {
  const marketplace = (await marketplaces()).find((m) => m.name === marketplaceName);
  if (!marketplace) throw new CatalogError(`No marketplace named ${marketplaceName}`);
  const { icon, ...bundle } = await fetchPluginBundle(marketplace.source, name);
  if (bundle.name === STANDALONE_PLUGIN) throw new CatalogError(`${STANDALONE_PLUGIN} is the name Mochi gives its own skills; this plugin can't take it`);
  await install(spaceId, { kind: 'plugin', id: randomUUID(), bundle, marketplace: marketplace.name, icon, targets: ['claude', 'codex'], addedAt: Date.now() });
}

/** The featured marketplaces, then the ones the user added. */
export async function marketplaces(): Promise<Marketplace[]> {
  const added = (await readLibrary()).marketplaces;
  return [...FEATURED_MARKETPLACES.filter((f) => !added.some((m) => m.name === f.name)), ...added];
}

/** Reads the marketplace first, so only one that parses is added, under the name its file gives. */
export async function addMarketplace(source: string) {
  const normalized = normalizeMarketplaceSource(source);
  const { name } = await fetchMarketplace(normalized);
  if ((await marketplaces()).some((m) => m.name === name)) throw new CatalogError(`A marketplace named ${name} is already added`);
  await updateLibrary((index) => ({ ...index, marketplaces: [...index.marketplaces, { name, source: normalized }] }));
}

/** Its installed plugins stay; they just stop being updatable from it. */
export function removeMarketplace(name: string) {
  return updateLibrary((index) => ({ ...index, marketplaces: index.marketplaces.filter((m) => m.name !== name) }));
}

async function install(spaceId: string, item: LibraryItem) {
  await updateLibrary((index) => {
    const old = index.items.find((other) => other.kind === item.kind && itemName(other) === itemName(item));
    const next = old ? { ...item, id: old.id, targets: old.targets, addedAt: old.addedAt } : item;
    const members = index.profiles[spaceId] ?? [];
    return {
      ...index,
      items: old ? index.items.map((other) => (other === old ? next : other)) : [...index.items, next],
      profiles: { ...index.profiles, [spaceId]: members.includes(next.id) ? members : [...members, next.id] },
    };
  });
}

// Profiles whose old folders went this run. Sessions die with the app, so before a profile's first session of a run
// nothing can be reading its earlier folders.
const pruned = new Set<string>();

async function prune(spaceId: string, keep: string[]) {
  pruned.add(spaceId);
  const dir = join(foldersRoot(), spaceId);
  const names = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(names.filter((name) => !keep.includes(join(dir, name))).map((name) => rm(join(dir, name), { recursive: true, force: true })));
}

const MAX_FILE_BYTES = 512 * 1024;
const SKIPPED_FOLDERS = new Set(['.git', 'node_modules']);

async function readSkillFolder(dir: string) {
  const files: Record<string, string> = {};
  const skipped: string[] = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = relative(dir, join(entry.parentPath, entry.name));
    if (path.split('/').some((part) => SKIPPED_FOLDERS.has(part))) continue;
    const full = join(dir, path);
    if ((await stat(full)).size > MAX_FILE_BYTES) {
      skipped.push(path);
      continue;
    }
    try {
      files[path] = decoder.decode(await readFile(full));
    } catch {
      skipped.push(path);
    }
  }
  return { files, skipped };
}

async function pluginFolder(spaceId: string, name: string, files: Record<string, string>) {
  const hash = createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 16);
  const dir = join(foldersRoot(), spaceId, `${name}-${hash}`);
  if (await exists(dir)) return dir;
  const tmp = `${dir}.${randomUUID()}.tmp`;
  for (const [path, text] of Object.entries(files)) {
    const target = resolve(tmp, path);
    if (relative(tmp, target).startsWith('..')) throw new Error(`${name}: ${path} points outside its plugin folder`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text);
    // Stored text drops file modes; a shebang is the sign a skill means to run the file directly.
    if (text.startsWith('#!')) await chmod(target, 0o755);
  }
  // Another session of the profile may have written the same folder meanwhile; theirs is identical.
  await rename(tmp, dir).catch(async (error) => {
    await rm(tmp, { recursive: true, force: true });
    if (!(await exists(dir))) throw error;
  });
  return dir;
}

function expandServer(def: McpServerDef): McpServerDef {
  return { ...def, ...(def.command && { command: expand(def.command) }), args: def.args?.map(expand), env: expandAll(def.env), url: def.url && expand(def.url), headers: expandAll(def.headers) };
}

async function exists(path: string) {
  return stat(path).then(() => true, () => false);
}
