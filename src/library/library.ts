import type { Provider } from '../model.ts';
import { serverSummary, type McpServerDef } from '../settings/agentConfig.ts';
import { connectorIcon } from './connectors.ts';
import type { PluginBundle } from './pluginBundle.ts';

/**
 * The profile library (LIBRARY.md): each item is held once, and a profile is the set of item ids it turned on. Sessions
 * load it per thread, never through the account's own config files.
 */
export interface LibraryIndex {
  items: LibraryItem[];
  profiles: Record<string, string[]>;
  marketplaces: Marketplace[];
}

export type LibraryItem = LibrarySkill | LibraryServer | LibraryPlugin | LibraryConnector;

export interface LibrarySkill extends ItemBase {
  kind: 'skill';
  name: string;
  description: string;
  /** The skill folder's text files by path relative to it, SKILL.md included. */
  files: Record<string, string>;
  /** GitHub `owner/repo/path` it was installed from; null when imported from an account. */
  source: string | null;
  icon: string | null;
}

export interface LibraryServer extends ItemBase {
  kind: 'server';
  def: McpServerDef;
}

/** Unpacked when installed (LIBRARY.md decision 3); its remote servers wait for connectors (Phase 1b). */
export interface LibraryPlugin extends ItemBase {
  kind: 'plugin';
  bundle: PluginBundle;
  marketplace: string;
  icon: string | null;
}

/**
 * One account on a remote MCP server. Its tokens are sealed in main and never in the index. Every account a profile has
 * on one server reaches sessions as that server's one proxied MCP server (LIBRARY.md decision 5).
 */
export interface LibraryConnector extends ItemBase {
  kind: 'connector';
  /** The session's server name for every account on this server (`connectorKey`). */
  key: string;
  title: string;
  url: string;
  /** Tells accounts on one server apart, and is the `__mochi_account` value. */
  alias: string;
  isLinked: boolean;
}

/** A plugin marketplace: GitHub `owner/repo`, a git URL, or a URL to its marketplace.json. */
export interface Marketplace {
  name: string;
  source: string;
}

interface ItemBase {
  id: string;
  targets: Provider[];
  addedAt: number;
  /** When its source last changed it (skills and plugins from GitHub). */
  updatedAt?: number;
  /** Off pins it at what is installed; unset means on. */
  autoUpdate?: boolean;
}

/** What the renderer lists: no file contents, plus whether the profile turned it on. */
export interface LibraryEntry {
  id: string;
  kind: LibraryItem['kind'];
  /** The key installs match on; `title` is what to show. */
  name: string;
  title: string;
  description: string;
  targets: Provider[];
  /** On for the profile `libraryEntries` was asked about. */
  isEnabled: boolean;
  /** Every profile that has it on: an item is installed once and handed to profiles. */
  profileIds: string[];
  source: string | null;
  icon: string | null;
  /** What a plugin unpacked into (`2 skills · 1 server`); null for a skill, a server, or a plugin with nothing Mochi loads. */
  contents: string | null;
  /** A plugin's remote servers, each a connector to sign in to. */
  remotes: { name: string; url: string }[];
  /** Parts of a plugin neither harness can load from Mochi. */
  unsupported: string[];
  /** A connector account's sign-in and name; null for everything else. */
  isLinked: boolean | null;
  alias: string | null;
  /** Null when it has no source to update from. */
  autoUpdate: boolean | null;
  updatedAt: number | null;
}

/** One plugin as a marketplace lists it, before it is installed. */
export interface CatalogPlugin {
  name: string;
  title: string | null;
  description: string | null;
  category: string | null;
  author: string | null;
  version: string | null;
  homepage: string | null;
  icon: string | null;
}

export interface MarketplaceCatalog {
  name: string;
  displayName: string;
  description: string | null;
  owner: string | null;
  format: 'claude' | 'codex';
  plugins: CatalogPlugin[];
}

/** One skill found in a GitHub repo, before it is installed. */
export interface CatalogSkill {
  name: string;
  description: string;
  source: string;
  fileCount: number;
  icon: string | null;
}

/** One plugin folder's files by path relative to it, keyed by the plugin's name. */
export type PluginFolders = Record<string, Record<string, string>>;

export const EMPTY_LIBRARY: LibraryIndex = { items: [], profiles: {}, marketplaces: [] };

/** Claude names a plugin's skills `<plugin>:<skill>` (verified with the SDK), so standalone skills read `mochi:<skill>`; no installed plugin may take the name. */
export const STANDALONE_PLUGIN = 'mochi';

export const FEATURED_SKILL_SOURCES = ['anthropics/skills', 'openai/skills/skills/.curated'];
export const FEATURED_MARKETPLACES: Marketplace[] = [{ name: 'claude-plugins-official', source: 'anthropics/claude-plugins-official' }];

export function libraryEntries(index: LibraryIndex, spaceId: string): LibraryEntry[] {
  const enabled = new Set(index.profiles[spaceId] ?? []);
  return index.items.map((item) => ({
    id: item.id,
    kind: item.kind,
    name: itemName(item),
    title: itemTitle(item),
    description: itemDescription(item),
    targets: item.targets,
    isEnabled: enabled.has(item.id),
    profileIds: Object.keys(index.profiles).filter((space) => index.profiles[space].includes(item.id)),
    source: item.kind === 'skill' ? item.source : item.kind === 'plugin' ? item.marketplace : item.kind === 'connector' ? item.url : null,
    icon: item.kind === 'skill' || item.kind === 'plugin' ? item.icon : item.kind === 'connector' ? connectorIcon(item.url) : null,
    contents: item.kind === 'plugin' ? pluginContents(item.bundle) : null,
    remotes: item.kind === 'plugin' ? item.bundle.remotes : [],
    unsupported: item.kind === 'plugin' ? item.bundle.unsupported : [],
    isLinked: item.kind === 'connector' ? item.isLinked : null,
    alias: item.kind === 'connector' ? item.alias : null,
    autoUpdate: isUpdatable(item) ? item.autoUpdate !== false : null,
    updatedAt: item.updatedAt ?? null,
  }));
}

/** Skills installed from GitHub and plugins from a marketplace can follow their source. */
export function isUpdatable(item: LibraryItem) {
  return (item.kind === 'skill' && !!item.source) || item.kind === 'plugin';
}

function itemTitle(item: LibraryItem) {
  if (item.kind === 'plugin') return item.bundle.title ?? item.bundle.name;
  if (item.kind === 'connector') return `${item.title} · ${item.alias}`;
  return itemName(item);
}

/** The key installs match on; a connector account's is `<server>:<alias>`. */
export function itemName(item: LibraryItem) {
  if (item.kind === 'skill') return item.name;
  if (item.kind === 'server') return item.def.name;
  return item.kind === 'plugin' ? item.bundle.name : `${item.key}:${item.alias}`;
}

function itemDescription(item: LibraryItem) {
  if (item.kind === 'skill') return item.description;
  if (item.kind === 'server') return serverSummary(item.def);
  return item.kind === 'plugin' ? (item.bundle.description ?? '') : '';
}

function pluginContents(bundle: PluginBundle) {
  const counts = [
    [bundle.skills.length, 'skill'],
    [bundle.subagents.length, 'agent'],
    [bundle.hooks.length, 'hook'],
    [bundle.servers.length, 'server'],
  ] as const;
  return counts.filter(([n]) => n).map(([n, label]) => `${n} ${label}${n === 1 ? '' : 's'}`).join(' · ') || null;
}

export function setItemEnabled(index: LibraryIndex, spaceId: string, id: string, isEnabled: boolean): LibraryIndex {
  if (!index.items.some((item) => item.id === id)) throw new Error('No such library item');
  const others = (index.profiles[spaceId] ?? []).filter((member) => member !== id);
  return { ...index, profiles: { ...index.profiles, [spaceId]: isEnabled ? [...others, id] : others } };
}

export function removeItem(index: LibraryIndex, id: string): LibraryIndex {
  const profiles = Object.fromEntries(Object.entries(index.profiles).map(([space, ids]) => [space, ids.filter((member) => member !== id)]));
  return { ...index, items: index.items.filter((item) => item.id !== id), profiles };
}

/** The profile's items for one harness: plugin folders for Claude to load, and servers to pass each session as they are. */
export function profileLayout(index: LibraryIndex, spaceId: string, provider: Provider): { plugins: PluginFolders; servers: McpServerDef[] } {
  const enabled = new Set(index.profiles[spaceId] ?? []);
  const items = index.items.filter((item) => enabled.has(item.id) && item.targets.includes(provider));
  const skills = items.filter((item) => item.kind === 'skill');
  const plugins = items.filter((item) => item.kind === 'plugin');
  const servers = items.flatMap((item) => (item.kind === 'server' ? [item.def] : []));
  // GAP: Codex has no per-thread skill folder (0.155.1's `skills.config` only toggles skills it found), so its threads get
  // servers only, and only plugin servers that don't run the plugin's own files, which Codex has no folder for.
  if (provider === 'codex') return { plugins: {}, servers: [...servers, ...plugins.flatMap((p) => p.bundle.servers.filter((s) => !usesPluginRoot(s)).map(stdioDef))] };
  const folders: PluginFolders = Object.fromEntries(plugins.map((p) => [p.bundle.name, pluginFolder(p.bundle)]));
  if (skills.length) folders[STANDALONE_PLUGIN] = standalonePlugin(skills);
  return { plugins: folders, servers };
}

/** The profile's signed-in connector accounts, grouped by the server they're on, in the order they were added. */
export function profileConnectors(index: LibraryIndex, spaceId: string): Map<string, LibraryConnector[]> {
  const enabled = new Set(index.profiles[spaceId] ?? []);
  const groups = new Map<string, LibraryConnector[]>();
  for (const item of index.items) {
    if (item.kind !== 'connector' || !item.isLinked || !enabled.has(item.id)) continue;
    groups.set(item.key, [...(groups.get(item.key) ?? []), item]);
  }
  return groups;
}

/** The plugin rebuilt in Claude's layout from its parts, so Claude names, roots and loads it as the plugin it was. */
function pluginFolder(bundle: PluginBundle) {
  const manifest = { name: bundle.name, ...(bundle.description && { description: bundle.description }), ...(bundle.version && { version: bundle.version }) };
  const kept = Object.entries(bundle.files).filter(([path]) => !isAutoLoaded(path));
  const files: Record<string, string> = { ...Object.fromEntries(kept), '.claude-plugin/plugin.json': `${JSON.stringify(manifest, null, 2)}\n` };
  for (const skill of bundle.skills) {
    files[`skills/${skill.name}/SKILL.md`] = renderMarkdown({ name: skill.name, description: skill.description }, skill.body);
    for (const [path, text] of Object.entries(skill.files)) files[`skills/${skill.name}/${path}`] = text;
  }
  for (const agent of bundle.subagents) files[`agents/${agent.name}.md`] = renderMarkdown({ name: agent.name, description: agent.description, ...agent.fields }, agent.body);
  if (bundle.hooks.length) files['hooks/hooks.json'] = `${JSON.stringify({ hooks: hookEvents(bundle.hooks) }, null, 2)}\n`;
  if (bundle.servers.length) files['.mcp.json'] = `${JSON.stringify({ mcpServers: Object.fromEntries(bundle.servers.map(({ name, ...server }) => [name, server])) }, null, 2)}\n`;
  return files;
}

// Files Claude would load on its own from a plugin folder: the parts are written back from the bundle instead, and remote
// servers and unsupported parts must not slip in past connectors.
const AUTO_LOADED = new Set(['.mcp.json', 'mcp.json', 'hooks/hooks.json', '.lsp.json', '.app.json', 'settings.json']);
const AUTO_LOADED_FOLDERS = ['.claude-plugin/', '.codex-plugin/', 'output-styles/', 'monitors/', 'themes/'];
const isAutoLoaded = (path: string) =>
  AUTO_LOADED.has(path) || AUTO_LOADED_FOLDERS.some((folder) => path.startsWith(folder)) || (/^(agents|commands)\//.test(path) && path.endsWith('.md'));

function hookEvents(hooks: PluginBundle['hooks']) {
  const events: Record<string, { matcher?: string; hooks: unknown[] }[]> = {};
  for (const { event, matcher, handler } of hooks) {
    const groups = (events[event] ??= []);
    let group = groups.find((g) => (g.matcher ?? null) === matcher);
    if (!group) groups.push((group = { ...(matcher !== null && { matcher }), hooks: [] }));
    group.hooks.push(handler);
  }
  return events;
}

// JSON strings are valid YAML double-quoted scalars, which keeps colons and quotes in values safe.
function renderMarkdown(frontmatter: Record<string, string>, body: string) {
  const lines = Object.entries(frontmatter).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  return `---\n${lines.join('\n')}\n---\n\n${body.trim()}\n`;
}

const usesPluginRoot = (server: PluginBundle['servers'][number]) => /\$\{(CLAUDE_)?PLUGIN_(ROOT|DATA)\}/.test(JSON.stringify(server));

const stdioDef = ({ name, command, args, env }: PluginBundle['servers'][number]): McpServerDef => ({ name, type: 'stdio', command, args, env });

function standalonePlugin(skills: LibrarySkill[]) {
  const manifest = { name: STANDALONE_PLUGIN, description: "Skills from this profile's Mochi library" };
  const files: Record<string, string> = { '.claude-plugin/plugin.json': `${JSON.stringify(manifest, null, 2)}\n` };
  for (const skill of skills) for (const [path, text] of Object.entries(skill.files)) files[`skills/${skill.name}/${path}`] = text;
  return files;
}

/**
 * Codex's per-thread `config` overrides for the servers, as dotted keys like the adapter's own (`mcp_servers.mochi.url`).
 * Codex doesn't expand `${VAR}`, so callers pass defs with their variables already filled in.
 */
export function codexServerConfig(servers: McpServerDef[]): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const def of servers) {
    const head = `mcp_servers.${def.name}`;
    if (def.url) config[`${head}.url`] = def.url;
    if (def.command) config[`${head}.command`] = def.command;
    if (def.args?.length) config[`${head}.args`] = def.args;
    if (def.cwd) config[`${head}.cwd`] = def.cwd;
    for (const [key, value] of Object.entries(def.env ?? {})) config[`${head}.env.${key}`] = value;
    for (const [key, value] of Object.entries(def.headers ?? {})) config[`${head}.http_headers.${key}`] = value;
  }
  return config;
}

const ITEM_KINDS: LibraryItem['kind'][] = ['skill', 'server', 'plugin', 'connector'];

/** The saved index when it has the right shape, else an empty library; items of an unknown kind are dropped. */
export function parseLibrary(raw: string | null): LibraryIndex {
  try {
    const saved = JSON.parse(raw ?? 'null') as Partial<LibraryIndex> | null;
    if (!saved || !Array.isArray(saved.items) || typeof saved.profiles !== 'object' || saved.profiles === null) return EMPTY_LIBRARY;
    const items = saved.items.filter((item) => ITEM_KINDS.includes(item?.kind));
    return { items, profiles: saved.profiles, marketplaces: Array.isArray(saved.marketplaces) ? saved.marketplaces : [] };
  } catch {
    return EMPTY_LIBRARY;
  }
}
