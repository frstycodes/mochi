import { constants } from 'node:fs';
import { copyFile, cp, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import type { Account, ConfigPreview, FileEdit, ProfileConfig, ProviderConfig } from '../../../../src/host/types/settings.ts';
import type { Provider } from '../../../../src/model.ts';
import {
  claudeDeniedServers,
  claudeServers,
  claudePluginRoots,
  claudeSkillOff,
  codexServers,
  commandMeta,
  codexSkillOverrides,
  INSTRUCTIONS_FILE,
  placeholders,
  removeClaudeServer,
  removeCodexServer,
  setClaudeServer,
  setClaudeServerEnabled,
  setClaudeSkillEnabled,
  setCodexServer,
  setCodexServerEnabled,
  setCodexSkillEnabled,
  skillMeta,
  type ConfigChange,
  type McpEntry,
  type McpServerDef,
  type SkillEntry,
} from '../../../../src/settings/agentConfig.ts';
import { parseToml } from '../../../../src/settings/toml.ts';
import { HARNESS_IDS, HARNESSES } from '../../../../src/settings/harnesses.ts';
import { claudeAiConnectorsOf } from './claude/claudeAiConnectors.ts';
import { accountFor, userPath } from './config.ts';

/**
 * Reads and writes the files each profile's accounts already use (RUNTIME.md, Auth: Mochi drives the user's own tools,
 * so their own config is the only config). Formats live in `src/settings/agentConfig.ts`; this module only knows paths.
 */

export async function readProfileConfig(spaceId: string, projectRoot?: string): Promise<ProfileConfig> {
  const entries = await Promise.all(HARNESS_IDS.map(async (provider) => [provider, await readProvider(spaceId, provider, projectRoot)] as const));
  return Object.fromEntries(entries) as ProfileConfig;
}

export async function previewConfig(spaceId: string, changes: ConfigChange[]): Promise<ConfigPreview> {
  const files = new Map<string, FileEdit>();
  const preview: ConfigPreview = { edits: [], copies: [], notes: [] };
  const current = async (path: string) => {
    if (!files.has(path)) {
      const before = await readText(path);
      files.set(path, { path, before, after: before });
    }
    return files.get(path)!.after;
  };
  const edit = async (path: string, change: (text: string) => string) => {
    const next = change(await current(path));
    files.get(path)!.after = next;
  };
  for (const change of changes) await plan(spaceId, change, { edit, preview });
  preview.edits = [...files.values()].filter((f) => f.before !== f.after);
  return preview;
}

export async function applyConfig(spaceId: string, changes: ConfigChange[], befores: Record<string, string>): Promise<{ backupDir: string | null }> {
  const { edits, copies } = await previewConfig(spaceId, changes);
  const isStale = edits.length !== Object.keys(befores).length || edits.some((e) => befores[e.path] !== e.before);
  if (isStale) throw new Error('A file changed since you reviewed it (the tool may have written to it). Review the changes again.');
  const backed = edits.filter((e) => e.before);
  const backupDir = backed.length ? join(homedir(), '.harness', 'backups', new Date().toISOString().replace(/[:.]/g, '-')) : null;
  for (const e of backed) {
    const copy = join(backupDir!, relative(homedir(), e.path).replace(/^(\.\.[/\\])+/, ''));
    await mkdir(dirname(copy), { recursive: true, mode: 0o700 });
    await copyFile(e.path, copy, constants.COPYFILE_EXCL);
  }
  for (const e of edits) await writeAtomic(e.path, e.after);
  for (const c of copies) await cp(c.from, c.to, { recursive: true, dereference: true, errorOnExist: true, force: false });
  return { backupDir };
}

/** Starts the server the way its tool would (same command, env with `${VAR}` expanded, the user's PATH) and lists its tools. */
export async function testMcpServer(spaceId: string, provider: Provider, name: string): Promise<{ tools: string[] }> {
  const server = (await readProvider(spaceId, provider)).mcpServers.find((s) => s.def.name === name && s.scope === 'user');
  if (!server) throw new Error(`No server named ${name}`);
  if (server.needs.length) throw new Error(`Set ${server.needs.join(', ')} first: the server reads ${server.needs.length === 1 ? 'it' : 'them'} from the environment`);
  const { def } = server;
  const [{ Client }, { StdioClientTransport }, { StreamableHTTPClientTransport }, { SSEClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/stdio.js'),
    import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
    import('@modelcontextprotocol/sdk/client/sse.js'),
  ]);
  const headers = expandAll(def.headers);
  const transport =
    def.type === 'stdio'
      ? new StdioClientTransport({ command: expand(def.command!), args: def.args?.map(expand), env: { ...stringEnv(), PATH: await userPath(), ...expandAll(def.env) }, cwd: def.cwd, stderr: 'pipe' })
      : def.type === 'sse'
        ? new SSEClientTransport(new URL(expand(def.url!)), { requestInit: { headers } })
        : new StreamableHTTPClientTransport(new URL(expand(def.url!)), { requestInit: { headers } });
  let stderr = '';
  if (transport instanceof StdioClientTransport) transport.stderr?.on('data', (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-400)));
  const client = new Client({ name: 'mochi', version: '1' });
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('No answer within 20 seconds')), TEST_TIMEOUT_MS)));
    const { tools } = await Promise.race([client.connect(transport).then(() => client.listTools()), timeout]);
    return { tools: tools.map((t) => t.name) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(stderr.trim() ? `${message}\n${stderr.trim()}` : message);
  } finally {
    clearTimeout(timer);
    void client.close().catch(() => {});
  }
}

const TEST_TIMEOUT_MS = 20_000;

// {READ}

async function readProvider(spaceId: string, provider: Provider, projectRoot?: string): Promise<ProviderConfig> {
  const { account } = await accountFor(spaceId, provider);
  const files = paths(provider, account);
  const config: ProviderConfig = { provider, account, instructions: { path: files.instructions, text: '' }, mcpServers: [], skills: [], commands: [], plugins: [], projectInstructions: null };
  try {
    config.instructions.text = await readText(files.instructions);
    const [servers, settings] = await Promise.all([readText(files.servers), readText(files.settings)]);
    config.mcpServers = provider === 'claude' ? claudeEntries(servers, settings) : codexServers(servers).map(({ def, enabled }) => entry(def, enabled, 'user'));
    config.skills = await readSkills(provider, files.skills, settings);
    config.plugins = provider === 'claude' ? await claudePlugins(files.dir) : codexPlugins(settings);
    if (provider === 'claude') config.claudeAiConnectors = await claudeAiConnectorsOf(account.id);
    if (provider === 'claude') config.commands = await claudeCommands(files.dir, settings, projectRoot);
    if (projectRoot) {
      const local = join(projectRoot, INSTRUCTIONS_FILE[provider]);
      config.projectInstructions = (await exists(local)) ? local : null;
      if (provider === 'claude') config.mcpServers.push(...claudeServers(await readText(join(projectRoot, '.mcp.json'))).map((def) => entry(def, true, 'project')));
    }
  } catch (error) {
    config.error = error instanceof Error ? error.message : String(error);
  }
  return config;
}

/**
 * Each tool's files for an account. Claude keeps user MCP servers in `.claude.json`, which sits in the config folder for
 * an account Mochi made but in the home folder (not `~/.claude`) for the default one.
 */
function paths(provider: Provider, account: Account) {
  const dir = account.configDir ?? join(homedir(), HARNESSES[provider].defaultFolder.replace(/^~\//, ''));
  const instructions = join(dir, INSTRUCTIONS_FILE[provider]);
  const skills = join(dir, 'skills');
  if (provider === 'claude') return { dir, instructions, skills, servers: join(account.configDir ?? homedir(), '.claude.json'), settings: join(dir, 'settings.json') };
  return { dir, instructions, skills, servers: join(dir, 'config.toml'), settings: join(dir, 'config.toml') };
}

function claudeEntries(claudeJson: string, settingsJson: string): McpEntry[] {
  const denied = claudeDeniedServers(settingsJson);
  return claudeServers(claudeJson).map((def) => entry(def, !denied.has(def.name), 'user'));
}

function entry(def: McpServerDef, enabled: boolean, scope: McpEntry['scope']): McpEntry {
  return { def, enabled, scope, needs: placeholders(def).filter((v) => !process.env[v]) };
}

async function readSkills(provider: Provider, skillsDir: string, settings: string): Promise<SkillEntry[]> {
  const off = provider === 'claude' ? claudeSkillOff(settings) : new Set<string>();
  const overrides = provider === 'codex' ? codexSkillOverrides(settings) : new Map<string, boolean>();
  let names: string[];
  try {
    names = (await readdir(skillsDir)).filter((n) => !n.startsWith('.')).sort();
  } catch {
    return [];
  }
  const skills = await Promise.all(
    names.map(async (folder): Promise<SkillEntry | null> => {
      const dir = join(skillsDir, folder);
      const md = await readText(join(dir, 'SKILL.md'));
      if (!md) return null;
      const meta = skillMeta(md, folder);
      return { ...meta, dir, enabled: provider === 'claude' ? !off.has(meta.name) : overrides.get(join(dir, 'SKILL.md')) !== false };
    }),
  );
  return skills.filter((s) => s !== null);
}

// GAP: Codex's project skills and prompts, plugins a project's own settings turn on, and commands in subfolders aren't read;
// each shows once the agent reports its own list.
async function claudeCommands(dir: string, settings: string, projectRoot?: string): Promise<ProviderConfig['commands']> {
  const off = claudeSkillOff(settings);
  const project = projectRoot && join(projectRoot, '.claude');
  const plugins = await enabledPlugins(dir, settings);
  const lists = await Promise.all([
    ...(project ? [skillsIn(join(project, 'skills')), commandsIn(join(project, 'commands'))] : []),
    commandsIn(join(dir, 'commands')),
    ...plugins.flatMap(({ name, root }) => [skillsIn(join(root, 'skills'), `${name}:`), commandsIn(join(root, 'commands'), `${name}:`)]),
  ]);
  return lists.flat().filter((c) => !off.has(c.name));
}

async function skillsIn(skillsDir: string, prefix = ''): Promise<ProviderConfig['commands']> {
  const folders = await readdir(skillsDir).catch(() => []);
  const skills = await Promise.all(
    folders.filter((n) => !n.startsWith('.')).map(async (folder) => {
      const md = await readText(join(skillsDir, folder, 'SKILL.md'));
      if (!md) return [];
      const meta = skillMeta(md, folder);
      return [{ ...meta, name: `${prefix}${meta.name}`, isSkill: true }];
    }),
  );
  return skills.flat();
}

async function commandsIn(commandsDir: string, prefix = ''): Promise<ProviderConfig['commands']> {
  const files = await readdir(commandsDir).catch(() => []);
  return Promise.all(
    files
      .filter((f) => f.endsWith('.md'))
      .map(async (file) => {
        const meta = commandMeta(await readText(join(commandsDir, file)), basename(file, '.md'));
        return { ...meta, name: `${prefix}${meta.name}`, isSkill: false };
      }),
  );
}

// A broken plugins file leaves their commands out rather than failing the whole config read.
async function enabledPlugins(dir: string, settings: string) {
  try {
    return claudePluginRoots(await readText(join(dir, 'plugins', 'installed_plugins.json')), settings);
  } catch {
    return [];
  }
}

async function claudePlugins(dir: string): Promise<string[]> {
  try {
    const { plugins } = JSON.parse(await readText(join(dir, 'plugins', 'installed_plugins.json'))) as { plugins?: Record<string, unknown> };
    return Object.keys(plugins ?? {});
  } catch {
    return [];
  }
}

function codexPlugins(configToml: string): string[] {
  const plugins = parseToml(configToml).doc.plugins;
  if (typeof plugins !== 'object' || plugins === null) return [];
  return Object.entries(plugins).flatMap(([id, p]) => ((p as { enabled?: unknown })?.enabled === false ? [] : [id]));
}

// {PLAN}

type Planner = { edit: (path: string, change: (text: string) => string) => Promise<void>; preview: ConfigPreview };

async function plan(spaceId: string, change: ConfigChange, planner: Planner): Promise<void> {
  const { edit, preview } = planner;
  const { account } = await accountFor(spaceId, change.provider);
  const files = paths(change.provider, account);
  const isClaude = change.provider === 'claude';
  switch (change.kind) {
    case 'mcp-set':
      return edit(files.servers, (t) => (isClaude ? setClaudeServer(t, change.server) : setCodexServer(t, change.server)));
    case 'mcp-remove':
      if (isClaude) await edit(files.settings, (t) => setClaudeServerEnabled(t, change.name, true));
      return edit(files.servers, (t) => (isClaude ? removeClaudeServer(t, change.name) : removeCodexServer(t, change.name)));
    case 'mcp-enabled':
      return edit(isClaude ? files.settings : files.servers, (t) => (isClaude ? setClaudeServerEnabled(t, change.name, change.enabled) : setCodexServerEnabled(t, change.name, change.enabled)));
    case 'skill-enabled': {
      const skill = (await readSkills(change.provider, files.skills, await readText(files.settings))).find((s) => s.name === change.name);
      if (!skill) throw new Error(`No skill named ${change.name}`);
      return edit(files.settings, (t) => (isClaude ? setClaudeSkillEnabled(t, skill.name, change.enabled) : setCodexSkillEnabled(t, join(skill.dir, 'SKILL.md'), change.enabled)));
    }
    case 'skill-import': {
      if (!(await readText(join(change.folder, 'SKILL.md')))) throw new Error(`${basename(change.folder)} has no SKILL.md, so it isn't a skill folder`);
      return copySkill(change.folder, files.skills, preview);
    }
  }
}

async function copySkill(folder: string, skillsDir: string, preview: ConfigPreview) {
  const to = join(skillsDir, basename(folder));
  if (preview.copies.some((c) => c.to === to)) return;
  if (await exists(to)) return void preview.notes.push(`${basename(folder)}: skipped, a skill folder with that name exists.`);
  preview.copies.push({ from: folder, to });
}

// {FILES}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Temp file then rename, so the tool never reads half a file; keeps the file's mode, owner-only for new config files. */
async function writeAtomic(path: string, text: string) {
  const mode = await stat(path).then(
    (s) => s.mode & 0o777,
    () => (path.endsWith('.md') ? 0o644 : 0o600),
  );
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.mochi-${process.pid}.tmp`;
  await writeFile(tmp, text, { mode });
  await rename(tmp, path);
}

export const expand = (value: string) => value.replace(/\$\{(\w+)(?::-([^}]*))?\}/g, (_, name: string, fallback?: string) => process.env[name] ?? fallback ?? '');
export const expandAll = (map: Record<string, string> | undefined) => map && Object.fromEntries(Object.entries(map).map(([k, v]) => [k, expand(v)]));
const stringEnv = () => Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'));
