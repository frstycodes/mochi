import { app } from 'electron';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { CatalogPlugin, MarketplaceCatalog } from '../../src/library/library.ts';
import { parsePluginBundle } from '../../src/library/pluginBundle.ts';
import { parseSkillMd } from '../../src/library/skillMd.ts';
import { readTar } from '../../src/library/tar.ts';

/** Skills and plugins from public GitHub repos and marketplace.json files (Claude's and Codex's formats). */
export class CatalogError extends Error {}

const GITHUB_HEADERS = { 'User-Agent': 'mochi' };
const MAX_FILE_BYTES = 256 * 1024;
const CATALOG_TTL_MS = 3600_000;
// Plugins are stored whole in library.json, which main holds in memory.
const MAX_PLUGIN_BYTES = 1_500_000;
// Claude Code and Codex each look for their own file; a repo can carry both.
const MARKETPLACE_FILES = [
  { path: '.claude-plugin/marketplace.json', format: 'claude' },
  { path: '.agents/plugins/marketplace.json', format: 'codex' },
] as const;

interface GitHubTarget {
  owner: string;
  repo: string;
  ref: string;
  path: string;
}

// Accepts owner/repo, owner/repo/sub/dir, and github.com URLs including /tree/<ref>/<dir>.
export function parseGitHubSource(source: string): GitHubTarget | null {
  const match = source
    .trim()
    .replace(/\/+$/, '')
    .match(/^(?:https:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^/]+))?(?:\/(.+))?$/);
  if (!match) return null;
  const [, owner, repo, ref = 'HEAD', path = ''] = match;
  return { owner, repo, ref, path };
}

// Stores the short form agents' own marketplace config expects when there is no sub-path.
export function normalizeMarketplaceSource(source: string) {
  const target = parseGitHubSource(source);
  return target && !target.path && target.ref === 'HEAD' ? `${target.owner}/${target.repo}` : source.trim();
}

export function fetchMarketplace(source: string) {
  return cached(`marketplace:${source}`, () => loadMarketplace(source));
}

async function loadMarketplace(source: string): Promise<MarketplaceCatalog> {
  const { file, format, target } = await loadMarketplaceFile(source);
  const manifests = format === 'codex' && target ? await fetchCodexManifests(target, file.plugins) : new Map();
  return toCatalog(file, format, target, manifests);
}

async function loadMarketplaceFile(source: string) {
  const target = /^https?:\/\/.+\.json$/i.test(source) ? null : parseGitHubSource(source);
  for (const { url, format } of marketplaceUrls(source, target)) {
    const response = await fetch(url, { headers: GITHUB_HEADERS });
    if (!response.ok) continue;
    const parsed = marketplaceSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new CatalogError(`${source} has a marketplace.json Mochi can't read`);
    return { file: parsed.data, format, target };
  }
  throw new CatalogError(`No marketplace.json found in ${source}`);
}

// Downloads one plugin and unpacks it into skills, subagents, hooks and servers, whichever agent it was built for.
export async function fetchPluginBundle(marketplaceSource: string, pluginName: string) {
  const { file, target } = await loadMarketplaceFile(marketplaceSource);
  const entry = file.plugins.find((plugin) => plugin.name === pluginName);
  if (!entry) throw new CatalogError(`${pluginName} isn't listed in ${marketplaceSource}`);
  const pluginTarget = resolvePluginTarget(entry, file, target);
  const scope = pluginTarget.path ? `${pluginTarget.path}/` : '';
  const repoFiles = await fetchRepoTextFiles(pluginTarget, (path) => path.startsWith(scope));
  const files = new Map([...repoFiles].map(([path, content]) => [path.slice(scope.length), content]));
  if (!files.size) throw new CatalogError(`${pluginName} has no files Mochi can read`);
  const size = [...files.values()].reduce((total, content) => total + content.length, 0);
  if (size > MAX_PLUGIN_BYTES) throw new CatalogError(`${pluginName} is larger than the ${MAX_PLUGIN_BYTES / 1_000_000} MB Mochi stores per plugin`);
  const listing = (await fetchMarketplace(marketplaceSource)).plugins.find((plugin) => plugin.name === pluginName);
  const bundle = parsePluginBundle(entry.name, files);
  return {
    ...bundle,
    name: entry.name,
    title: bundle.title ?? listing?.title ?? entry.displayName ?? null,
    description: bundle.description ?? entry.description ?? null,
    version: bundle.version ?? entry.version ?? null,
    icon: listing?.icon ?? null,
  };
}

// GAP: npm, archive and command sources need a package registry or a shell; only GitHub-hosted plugins install.
function resolvePluginTarget(entry: MarketplacePlugin, file: MarketplaceFile, marketplace: GitHubTarget | null): GitHubTarget {
  const source = entry.source ?? entry.name;
  if (typeof source === 'string' || source.source === 'local') {
    const local = typeof source === 'string' ? source : (source.path ?? '');
    if (!marketplace) throw new CatalogError(`${entry.name} lives beside a marketplace.json URL; Mochi can only follow paths inside a GitHub repository`);
    const root = file.metadata?.pluginRoot && !local.startsWith('./') ? joinPath(marketplace.path, file.metadata.pluginRoot) : marketplace.path;
    return { ...marketplace, path: joinPath(root, local) };
  }
  const repo = source.source === 'github' ? source.repo : source.url;
  const target = repo ? parseGitHubSource(repo) : null;
  if (!target || !['github', 'url', 'git-subdir'].includes(source.source))
    throw new CatalogError(`${entry.name} installs from a ${source.source} source; Mochi installs plugins hosted on GitHub`);
  return { ...target, ref: source.sha ?? source.ref ?? target.ref, path: source.path ? joinPath(target.path, source.path) : target.path };
}

function marketplaceUrls(source: string, target: GitHubTarget | null) {
  if (!target) {
    if (/^https?:\/\/.+\.json$/i.test(source)) return [{ url: source, format: 'claude' as const }];
    throw new CatalogError('Only GitHub repositories and marketplace.json URLs can be browsed');
  }
  return MARKETPLACE_FILES.map(({ path, format }) => ({ url: rawUrl(target, path), format }));
}

const personSchema = z.union([z.string(), z.object({ name: z.string() }).transform((person) => person.name)]);

// `source` is a path inside the marketplace repo, or an object naming another repo (github / url / git-subdir / local).
const pluginSourceSchema = z.union([
  z.string(),
  z.object({
    source: z.string(),
    repo: z.string().optional(),
    url: z.string().optional(),
    path: z.string().optional(),
    ref: z.string().optional(),
    sha: z.string().optional(),
  }),
]);

const marketplaceSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  owner: personSchema.optional(),
  metadata: z.object({ description: z.string().optional(), pluginRoot: z.string().optional() }).optional(),
  interface: z.object({ displayName: z.string().optional() }).optional(),
  plugins: z.array(
    z.object({
      name: z.string(),
      source: pluginSourceSchema.optional(),
      displayName: z.string().optional(),
      description: z.string().optional(),
      category: z.string().optional(),
      author: personSchema.optional(),
      version: z.string().optional(),
      homepage: z.string().optional(),
    }),
  ),
});

type MarketplaceFile = z.infer<typeof marketplaceSchema>;
type MarketplacePlugin = MarketplaceFile['plugins'][number];

// Codex keeps a plugin's display name, blurb and logo in its own .codex-plugin/plugin.json.
const codexManifestSchema = z.object({
  interface: z
    .object({
      displayName: z.string().optional(),
      shortDescription: z.string().optional(),
      developerName: z.string().optional(),
      logo: z.string().optional(),
      composerIcon: z.string().optional(),
    })
    .optional(),
});

type CodexManifest = { dir: string; manifest: z.infer<typeof codexManifestSchema> };

function toCatalog(marketplace: MarketplaceFile, format: MarketplaceCatalog['format'], target: GitHubTarget | null, manifests: Map<string, CodexManifest>) {
  return {
    name: marketplace.name,
    displayName: marketplace.interface?.displayName ?? marketplace.name,
    description: marketplace.description ?? marketplace.metadata?.description ?? null,
    owner: marketplace.owner ?? null,
    format,
    plugins: marketplace.plugins.map((plugin): CatalogPlugin => {
      const codex = manifests.get(plugin.name);
      const ui = codex?.manifest.interface;
      const codexIcon = ui?.logo ?? ui?.composerIcon;
      return {
        name: plugin.name,
        title: ui?.displayName ?? plugin.displayName ?? null,
        description: plugin.description ?? ui?.shortDescription ?? null,
        category: plugin.category?.toLowerCase() ?? null,
        author: plugin.author ?? ui?.developerName ?? null,
        version: plugin.version ?? null,
        homepage: plugin.homepage ?? null,
        icon: codex && codexIcon && target ? rawUrl(target, joinPath(codex.dir, codexIcon)) : claudePluginIcon(plugin, marketplace, target),
      };
    }),
  } satisfies MarketplaceCatalog;
}

// Claude marketplaces carry no icons. A plugin hosted in its vendor's own repo gets that GitHub org's avatar;
// one kept inside the marketplace repo only does when its author is the marketplace owner, since third-party
// plugins mirrored there would otherwise wear the host's logo.
function claudePluginIcon(plugin: MarketplacePlugin, marketplace: MarketplaceFile, target: GitHubTarget | null) {
  const source = plugin.source;
  if (typeof source === 'object') {
    const owner = source.repo?.split('/')[0] ?? source.url?.match(/github\.com[/:]([\w.-]+)\//)?.[1];
    if (owner) return githubAvatar(owner);
  }
  const isLocal = typeof source === 'string' || source?.source === 'local';
  if (isLocal && target && plugin.author && plugin.author === marketplace.owner) return githubAvatar(target.owner);
  return null;
}

async function fetchCodexManifests(target: GitHubTarget, plugins: MarketplacePlugin[]) {
  const dirs = new Map<string, string>();
  for (const plugin of plugins) {
    const path = typeof plugin.source === 'string' ? plugin.source : plugin.source?.source === 'local' ? plugin.source.path : undefined;
    if (path) dirs.set(joinPath(target.path, path), plugin.name);
  }
  const wanted = new Set([...dirs.keys()].map((dir) => joinPath(dir, '.codex-plugin/plugin.json')));
  const files = await fetchRepoTextFiles(target, (path) => wanted.has(path));
  const manifests = new Map<string, CodexManifest>();
  for (const [dir, name] of dirs) {
    const parsed = codexManifestSchema.safeParse(parseJson(files.get(joinPath(dir, '.codex-plugin/plugin.json'))));
    if (parsed.success) manifests.set(name, { dir, manifest: parsed.data });
  }
  return manifests;
}

// Every folder holding a SKILL.md under the target path becomes one skill, with its text files alongside.
/** `isFresh` skips the cache (an update check) and refills it. */
export function discoverSkills(source: string, { isFresh = false } = {}) {
  return cached(`skills:${source}`, () => loadSkills(source), isFresh);
}

async function loadSkills(source: string) {
  const target = parseGitHubSource(source);
  if (!target) throw new CatalogError('Use a GitHub owner/repo or a github.com URL');
  const scope = target.path ? `${target.path}/` : '';
  const files = await fetchRepoTextFiles(target, (path) => path.startsWith(scope));
  const skillDirs = [...files.keys()]
    .filter((path) => path === 'SKILL.md' || path.endsWith('/SKILL.md'))
    .map((path) => path.slice(0, -'SKILL.md'.length).replace(/\/$/, ''));
  if (!skillDirs.length) throw new CatalogError(`No SKILL.md found in ${source}`);

  return skillDirs.map((dir) => {
    const prefix = dir ? `${dir}/` : '';
    // SKILL.md is kept as written: its frontmatter carries more than name and description (allowed-tools, argument-hint…).
    const folder = [...files].filter(([path]) => path.startsWith(prefix));
    const iconPath = codexSkillIcon(files.get(`${prefix}agents/openai.yaml`));
    return {
      ...parseSkillMd(files.get(`${prefix}SKILL.md`)!, dir.split('/').pop() || target.repo),
      files: Object.fromEntries(folder.map(([path, content]) => [path.slice(prefix.length), content])),
      source: [`${target.owner}/${target.repo}`, dir].filter(Boolean).join('/'),
      // A skill without its own icon wears its repo owner's avatar, so a catalog reads as who made what.
      icon: iconPath ? rawUrl(target, joinPath(dir, iconPath)) : githubAvatar(target.owner),
    };
  });
}

// Codex skills declare `interface.icon_large` / `icon_small` in agents/openai.yaml; the large one is the app-style tile.
function codexSkillIcon(yaml: string | undefined) {
  const field = (key: string) => yaml?.match(new RegExp(`^\\s+${key}:\\s*["']?([^"'\\n]+?)["']?\\s*$`, 'm'))?.[1];
  return field('icon_large') ?? field('icon_small') ?? null;
}

// One codeload request instead of a tree walk: the GitHub API's 60/hour anonymous limit runs out in a page view.
// The archive is streamed, so only the small text files `keep` accepts are held in memory.
async function fetchRepoTextFiles({ owner, repo, ref }: GitHubTarget, keep: (path: string) => boolean) {
  const response = await fetch(`https://codeload.github.com/${owner}/${repo}/tar.gz/${ref}`, { headers: GITHUB_HEADERS });
  if (!response.ok || !response.body) throw new CatalogError(`Couldn't download ${owner}/${repo} (HTTP ${response.status}). Public repositories only.`);
  const files = new Map<string, string>();
  const decoder = new TextDecoder();
  // GitHub prefixes every path with "<repo>-<ref>/"
  const repoPath = (path: string) => path.slice(path.indexOf('/') + 1);
  const accept = (path: string, size: number) => size <= MAX_FILE_BYTES && keep(repoPath(path));
  for await (const entry of readTar(response.body.pipeThrough(new DecompressionStream('gzip')), accept)) {
    if (!entry.body.includes(0)) files.set(repoPath(entry.path), decoder.decode(entry.body));
  }
  return files;
}

// Repos change rarely and a browse downloads a whole archive, so catalogs are kept on disk for an hour.
async function cached<T>(key: string, load: () => Promise<T>, isFresh = false): Promise<T> {
  const file = join(app.getPath('userData'), 'library-cache', `${createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`);
  const hit = await readFile(file, 'utf8').then((text) => JSON.parse(text) as { at: number; value: T }, () => null);
  if (hit && !isFresh && Date.now() - hit.at < CATALOG_TTL_MS) return hit.value;
  const value = await load();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ at: Date.now(), value }));
  return value;
}

function rawUrl({ owner, repo, ref }: GitHubTarget, path: string) {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
}

function githubAvatar(owner: string) {
  return `https://github.com/${owner}.png?size=96`;
}

// Resolves a relative path ("./assets/logo.png", "../x") against a repo directory.
function joinPath(dir: string, relative: string) {
  return new URL(relative, `https://repo.invalid/${dir ? `${dir}/` : ''}`).pathname.slice(1);
}

function parseJson(text: string | undefined) {
  try {
    return text === undefined ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
}
