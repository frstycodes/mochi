import { parseSkillMd, splitFrontmatter } from './skillMd.ts';

// A plugin unpacked into the parts both agents understand. Mochi stores these and loads them per session; it never asks an
// agent to install the plugin itself.
export interface PluginBundle {
  name: string;
  title: string | null;
  description: string | null;
  version: string | null;
  skills: { name: string; description: string; body: string; files: Record<string, string> }[];
  subagents: { name: string; description: string; body: string; fields: Record<string, string> }[];
  hooks: { event: string; matcher: string | null; handler: HookHandler }[];
  servers: { name: string; command: string; args: string[]; env: Record<string, string> }[];
  remotes: { name: string; url: string }[];
  // Everything else in the plugin folder (scripts its hooks and servers run), written beside it on each machine.
  files: Record<string, string>;
  unsupported: string[];
}

export type HookHandler = { type: string; command?: string; args?: string[]; timeout?: number; [key: string]: unknown };

const MANIFEST_PATHS = ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'plugin.json'];

// Folders and files an agent reads that have no portable equivalent; listed so the UI can say what was left out.
const UNSUPPORTED_PATHS = [
  { path: '.app.json', label: 'Codex apps (connectors hosted by OpenAI)' },
  { path: '.lsp.json', label: 'Language servers' },
  { path: 'output-styles/', label: 'Output styles' },
  { path: 'themes/', label: 'Themes' },
  { path: 'monitors/', label: 'Monitors' },
  { path: 'bin/', label: 'Executables added to PATH' },
];

// `files` is keyed by path relative to the plugin root. Follows Claude Code's layout rules: a manifest path for
// commands or agents replaces the default folder, a skills path adds to it, hooks and MCP files merge.
export function parsePluginBundle(fallbackName: string, files: Map<string, string>): PluginBundle {
  const manifest = readManifest(files);
  const name = slug(stringField(manifest, 'name') ?? fallbackName);
  const ui = (manifest.interface ?? {}) as Record<string, unknown>;

  const skillRoots = ['skills/', ...pathList(manifest.skills)];
  const commandRoots = pathList(manifest.commands, ['commands/']);
  const agentRoots = pathList(manifest.agents, ['agents/']);

  const skills = [...readSkills(files, skillRoots), ...readCommands(files, commandRoots)];
  if (files.has('SKILL.md') && !skills.length) skills.push({ ...parseSkillMd(files.get('SKILL.md')!, name), files: {} });

  const hookSources = [parseJson(files.get('hooks/hooks.json')), ...inlineOrFile(files, manifest.hooks)];
  const mcpSources = [parseJson(files.get('.mcp.json')), parseJson(files.get('mcp.json')), ...inlineOrFile(files, manifest.mcpServers)];
  const { servers, remotes } = readMcpServers(mcpSources);

  return {
    name,
    title: stringField(ui, 'displayName') ?? stringField(manifest, 'displayName') ?? null,
    description: stringField(manifest, 'description') ?? stringField(ui, 'shortDescription') ?? null,
    version: stringField(manifest, 'version') ?? null,
    skills: dedupeByName(skills),
    subagents: dedupeByName(readSubagents(files, agentRoots)),
    hooks: hookSources.flatMap(readHooks),
    servers,
    remotes,
    files: Object.fromEntries([...files].filter(([path]) => !isComponentFile(path, skillRoots, commandRoots, agentRoots))),
    unsupported: UNSUPPORTED_PATHS.filter(({ path }) => [...files.keys()].some((file) => file === path || file.startsWith(path))).map(({ label }) => label),
  };
}

function readManifest(files: Map<string, string>) {
  for (const path of MANIFEST_PATHS) {
    const parsed = parseJson(files.get(path));
    if (isRecord(parsed)) return parsed;
  }
  return {} as Record<string, unknown>;
}

function readSkills(files: Map<string, string>, roots: string[]) {
  const skillDirs = [...files.keys()]
    .filter((path) => path.endsWith('/SKILL.md') && roots.some((root) => path.startsWith(root)))
    .map((path) => path.slice(0, -'/SKILL.md'.length));
  return skillDirs.map((dir) => ({
    ...parseSkillMd(files.get(`${dir}/SKILL.md`)!, dir.split('/').pop()!),
    files: Object.fromEntries(
      [...files].filter(([path]) => path.startsWith(`${dir}/`) && path !== `${dir}/SKILL.md`).map(([path, content]) => [path.slice(dir.length + 1), content]),
    ),
  }));
}

// Commands are the older form of skills in Claude Code and deprecated prompts in Codex, so they install as skills.
function readCommands(files: Map<string, string>, roots: string[]) {
  return markdownUnder(files, roots).map(([path, markdown]) => {
    const { name, description, body } = parseSkillMd(markdown, commandName(path, roots));
    return { name, description, body, files: {} };
  });
}

function readSubagents(files: Map<string, string>, roots: string[]) {
  return markdownUnder(files, roots).map(([path, markdown]) => {
    const { frontmatter, body } = splitFrontmatter(markdown);
    const { name = commandName(path, roots), description = '', ...fields } = frontmatter;
    return { name: slug(name), description, body, fields };
  });
}

function readHooks(source: unknown): PluginBundle['hooks'] {
  const events = isRecord(source) && isRecord(source.hooks) ? source.hooks : source;
  if (!isRecord(events)) return [];
  return Object.entries(events).flatMap(([event, groups]) =>
    (Array.isArray(groups) ? groups : [])
      .filter(isRecord)
      .flatMap((group) =>
        (Array.isArray(group.hooks) ? group.hooks : [])
          .filter((handler): handler is HookHandler => isRecord(handler) && typeof handler.type === 'string')
          .map((handler) => ({ event, matcher: typeof group.matcher === 'string' && group.matcher ? group.matcher : null, handler })),
      ),
  );
}

function readMcpServers(sources: unknown[]) {
  const servers = new Map<string, PluginBundle['servers'][number]>();
  const remotes = new Map<string, PluginBundle['remotes'][number]>();
  for (const source of sources) {
    const entries = isRecord(source) && isRecord(source.mcpServers) ? source.mcpServers : source;
    if (!isRecord(entries)) continue;
    for (const [rawName, entry] of Object.entries(entries)) {
      if (!isRecord(entry)) continue;
      const name = slug(rawName);
      if (typeof entry.url === 'string') remotes.set(name, { name, url: entry.url });
      else if (typeof entry.command === 'string')
        servers.set(name, {
          name,
          command: entry.command,
          args: Array.isArray(entry.args) ? entry.args.map(String) : [],
          env: isRecord(entry.env) ? Object.fromEntries(Object.entries(entry.env).map(([key, value]) => [key, String(value)])) : {},
        });
    }
  }
  return { servers: [...servers.values()], remotes: [...remotes.values()] };
}

function markdownUnder(files: Map<string, string>, roots: string[]) {
  return [...files].filter(([path]) => path.endsWith('.md') && roots.some((root) => path === root || path.startsWith(root)));
}

// commands/git/commit.md becomes git-commit, matching how Claude Code namespaces nested commands.
function commandName(path: string, roots: string[]) {
  const root = roots.find((candidate) => path.startsWith(candidate)) ?? '';
  return slug(path.slice(root.length).replace(/\.md$/, '').replaceAll('/', '-'));
}

function isComponentFile(path: string, ...rootGroups: string[][]) {
  if (MANIFEST_PATHS.includes(path) || ['hooks/hooks.json', '.mcp.json', 'mcp.json'].includes(path)) return false;
  return rootGroups.flat().some((root) => path.startsWith(root) && root.endsWith('/') && path.endsWith('.md'));
}

// Manifest component fields are "./path", ["./a", "./b"] or, for hooks and MCP, an inline object.
function pathList(value: unknown, fallback: string[] = []) {
  const paths = (Array.isArray(value) ? value : [value]).filter((path): path is string => typeof path === 'string').map(normalizePath);
  return paths.length ? paths : fallback;
}

function inlineOrFile(files: Map<string, string>, value: unknown) {
  if (isRecord(value)) return [value];
  return pathList(value).map((path) => parseJson(files.get(path.replace(/\/$/, ''))));
}

function normalizePath(path: string) {
  const trimmed = path.replace(/^\.\//, '');
  return trimmed.endsWith('.md') || trimmed.endsWith('.json') ? trimmed : `${trimmed.replace(/\/$/, '')}/`;
}

function dedupeByName<T extends { name: string }>(items: T[]) {
  return [...new Map(items.map((item) => [item.name, item])).values()];
}

function slug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'plugin'
  );
}

function stringField(record: Record<string, unknown>, key: string) {
  return typeof record[key] === 'string' && record[key] ? (record[key] as string) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
