import type { Provider } from '../model.ts';
import { parseToml, removeTomlTables, setTomlKey, tomlKey, tomlValue, type TomlDoc } from './toml.ts';

/**
 * What a profile's accounts carry in their own config folders (CLAUDE.md / AGENTS.md, MCP servers, skills), read and
 * written in each tool's native files so Claude Code and Codex pick changes up themselves. Formats, verified against
 * Claude Code 2.1.296 and codex-cli 0.155.1 in a scratch config folder:
 * - Claude: user MCP servers in `<dir>/.claude.json` `mcpServers` (`~/.claude.json` for the default account), turned off
 *   with `deniedMcpServers: [{ serverName }]` in `<dir>/settings.json`; `${VAR}` in env values expands from the
 *   environment; skills in `<dir>/skills/<name>/SKILL.md`, turned off with `skillOverrides: { <name>: "off" }`.
 * - Codex: `[mcp_servers.<name>]` in `<dir>/config.toml` with `enabled = false`; skills in `<dir>/skills/<name>/SKILL.md`,
 *   turned off with a `[[skills.config]]` entry `{ path, enabled = false }`.
 */

/** One MCP server in Claude's shape. `${VAR}` in env, headers, args or url means "read VAR from the environment". */
export interface McpServerDef {
  name: string;
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
}

export interface McpEntry {
  def: McpServerDef;
  enabled: boolean;
  /** `project`: from the project's `.mcp.json`, shown but not edited here. */
  scope: 'user' | 'project';
  /** Environment variables the server reads that aren't set, so it can't start as configured. */
  needs: string[];
}

export interface SkillEntry {
  name: string;
  description: string;
  /** `<file> [--fix]` from the front matter's `argument-hint`. */
  argumentHint?: string;
  /** The skill's folder. */
  dir: string;
  enabled: boolean;
}

/** Every write the settings page can ask for; the main process turns a list of these into file edits. */
export type ConfigChange =
  | { kind: 'mcp-set'; provider: Provider; server: McpServerDef }
  | { kind: 'mcp-remove'; provider: Provider; name: string }
  | { kind: 'mcp-enabled'; provider: Provider; name: string; enabled: boolean }
  | { kind: 'skill-enabled'; provider: Provider; name: string; enabled: boolean }
  | { kind: 'skill-import'; provider: Provider; folder: string };

export const INSTRUCTIONS_FILE = { claude: 'CLAUDE.md', codex: 'AGENTS.md' } satisfies Record<Provider, string>;

// {CLAUDE}

export function claudeServers(claudeJson: string): McpServerDef[] {
  const servers = parseJsonObject(claudeJson, '.claude.json').mcpServers;
  if (!isObject(servers)) return [];
  return Object.entries(servers).flatMap(([name, raw]) => (isObject(raw) ? [fromClaude(name, raw)] : []));
}

export function fromClaude(name: string, raw: Record<string, unknown>): McpServerDef {
  const type = raw.type === 'http' || raw.type === 'sse' ? raw.type : raw.url && !raw.command ? 'http' : 'stdio';
  return clean({ name, type, command: str(raw.command), args: strings(raw.args), env: stringMap(raw.env), cwd: str(raw.cwd), url: str(raw.url), headers: stringMap(raw.headers) });
}

export function toClaude({ name: _, ...def }: McpServerDef): Record<string, unknown> {
  return def;
}

export function setClaudeServer(claudeJson: string, server: McpServerDef): string {
  const doc = parseJsonObject(claudeJson, '.claude.json');
  return json({ ...doc, mcpServers: { ...(isObject(doc.mcpServers) ? doc.mcpServers : {}), [server.name]: toClaude(server) } });
}

export function removeClaudeServer(claudeJson: string, name: string): string {
  const doc = parseJsonObject(claudeJson, '.claude.json');
  const { [name]: _, ...rest } = isObject(doc.mcpServers) ? doc.mcpServers : {};
  return json({ ...doc, mcpServers: rest });
}

export function claudeDeniedServers(settingsJson: string): Set<string> {
  const denied = parseJsonObject(settingsJson, 'settings.json').deniedMcpServers;
  return new Set(Array.isArray(denied) ? denied.flatMap((d) => (isObject(d) && typeof d.serverName === 'string' ? [d.serverName] : [])) : []);
}

export function setClaudeServerEnabled(settingsJson: string, name: string, enabled: boolean): string {
  const doc = parseJsonObject(settingsJson, 'settings.json');
  const others = (Array.isArray(doc.deniedMcpServers) ? doc.deniedMcpServers : []).filter((d) => !(isObject(d) && d.serverName === name));
  const deniedMcpServers = enabled ? others : [...others, { serverName: name }];
  const { deniedMcpServers: _, ...rest } = doc;
  return json(deniedMcpServers.length ? { ...rest, deniedMcpServers } : rest);
}

export function claudeSkillOff(settingsJson: string): Set<string> {
  const overrides = parseJsonObject(settingsJson, 'settings.json').skillOverrides;
  return new Set(isObject(overrides) ? Object.entries(overrides).flatMap(([name, v]) => (v === 'off' ? [name] : [])) : []);
}

export function setClaudeSkillEnabled(settingsJson: string, name: string, enabled: boolean): string {
  const doc = parseJsonObject(settingsJson, 'settings.json');
  const { [name]: _, ...others } = isObject(doc.skillOverrides) ? doc.skillOverrides : {};
  const skillOverrides = enabled ? others : { ...others, [name]: 'off' };
  const { skillOverrides: __, ...rest } = doc;
  return json(Object.keys(skillOverrides).length ? { ...rest, skillOverrides } : rest);
}

// {CODEX}

export function codexServers(configToml: string): { def: McpServerDef; enabled: boolean }[] {
  const servers = parseToml(configToml).doc.mcp_servers;
  if (!isObject(servers)) return [];
  return Object.entries(servers).flatMap(([name, raw]) => (isObject(raw) ? [{ def: fromCodex(name, raw), enabled: raw.enabled !== false }] : []));
}

/** Codex passes variables through by name (`env_vars`, `env_http_headers`, `bearer_token_env_var`); Claude spells them `${VAR}`. */
export function fromCodex(name: string, raw: TomlDoc): McpServerDef {
  const env = { ...stringMap(raw.env), ...Object.fromEntries((strings(raw.env_vars) ?? []).map((v) => [v, `\${${v}}`])) };
  const headers = {
    ...stringMap(raw.http_headers),
    ...Object.fromEntries(Object.entries(stringMap(raw.env_http_headers) ?? {}).map(([h, v]) => [h, `\${${v}}`])),
    ...(typeof raw.bearer_token_env_var === 'string' && { Authorization: `Bearer \${${raw.bearer_token_env_var}}` }),
  };
  return clean({ name, type: raw.url ? 'http' : 'stdio', command: str(raw.command), args: strings(raw.args), env, cwd: str(raw.cwd), url: str(raw.url), headers });
}

// GAP: Codex speaks stdio and streamable HTTP; an SSE server imported from Claude is written as a plain `url` and may not connect.
export function toCodexToml(def: McpServerDef, enabled = true): string {
  const head = `mcp_servers.${tomlKey(def.name)}`;
  const env = Object.entries(def.env ?? {});
  const passed = env.filter(([k, v]) => v === `\${${k}}`).map(([k]) => k);
  const literal = Object.fromEntries(env.filter(([k, v]) => v !== `\${${k}}`));
  const headers = Object.entries(def.headers ?? {});
  const bearer = headers.find(([h, v]) => h.toLowerCase() === 'authorization' && /^Bearer \$\{(\w+)\}$/.test(v));
  const fromEnv = Object.fromEntries(headers.flatMap(([h, v]) => (h !== bearer?.[0] && /^\$\{(\w+)\}$/.test(v) ? [[h, v.slice(2, -1)]] : [])));
  const plain = Object.fromEntries(headers.filter(([h, v]) => h !== bearer?.[0] && !(h in fromEnv) && v));
  const lines = [
    `[${head}]`,
    def.command && `command = ${tomlValue(def.command)}`,
    def.args?.length && `args = ${tomlValue(def.args)}`,
    def.cwd && `cwd = ${tomlValue(def.cwd)}`,
    def.url && `url = ${tomlValue(def.url)}`,
    passed.length && `env_vars = ${tomlValue(passed)}`,
    bearer && `bearer_token_env_var = ${tomlValue(bearer[1].slice(9, -1))}`,
    Object.keys(fromEnv).length && `env_http_headers = ${tomlValue(fromEnv)}`,
    Object.keys(plain).length && `http_headers = ${tomlValue(plain)}`,
    !enabled && 'enabled = false',
  ].filter(Boolean);
  const envTable = Object.keys(literal).length ? ['', `[${head}.env]`, ...Object.entries(literal).map(([k, v]) => `${tomlKey(k)} = ${tomlValue(v)}`)] : [];
  return [...lines, ...envTable].join('\n') + '\n';
}

export function setCodexServer(configToml: string, def: McpServerDef): string {
  const previous = codexServers(configToml).find((s) => s.def.name === def.name);
  const { text, at } = removeCodexTables(configToml, def.name);
  const block = toCodexToml(def, previous?.enabled ?? true);
  if (at >= text.length) return `${text}${text && !text.endsWith('\n') ? '\n' : ''}${text.trim() ? '\n' : ''}${block}`;
  return `${text.slice(0, at)}${block}\n${text.slice(at)}`;
}

export function removeCodexServer(configToml: string, name: string): string {
  return removeCodexTables(configToml, name).text;
}

export function setCodexServerEnabled(configToml: string, name: string, enabled: boolean): string {
  const table = parseToml(configToml).tables.find((t) => !t.isArray && t.path.length === 2 && t.path[0] === 'mcp_servers' && t.path[1] === name);
  if (!table) throw new Error(`config.toml has no [mcp_servers.${name}] table`);
  return setTomlKey(configToml, table, 'enabled', enabled);
}

function removeCodexTables(configToml: string, name: string) {
  return removeTomlTables(configToml, parseToml(configToml).tables.filter((t) => t.path[0] === 'mcp_servers' && t.path[1] === name));
}

/** `[[skills.config]]` entries by SKILL.md path. */
export function codexSkillOverrides(configToml: string): Map<string, boolean> {
  const entries = (parseToml(configToml).doc.skills as TomlDoc | undefined)?.config;
  return new Map(Array.isArray(entries) ? entries.flatMap((e) => (isObject(e) && typeof e.path === 'string' ? [[e.path, e.enabled !== false] as const] : [])) : []);
}

/** Enabling drops the override entry (skills are on by default); disabling adds or updates one. */
export function setCodexSkillEnabled(configToml: string, skillPath: string, enabled: boolean): string {
  const { doc, tables } = parseToml(configToml);
  const entries = ((doc.skills as TomlDoc | undefined)?.config ?? []) as unknown[];
  const arrayTables = tables.filter((t) => t.isArray && t.path.join('.') === 'skills.config');
  const index = entries.findIndex((e) => isObject(e) && e.path === skillPath);
  const table = index >= 0 ? arrayTables[index] : undefined;
  if (table && enabled) return removeTomlTables(configToml, [table]).text;
  if (table) return setTomlKey(configToml, table, 'enabled', false);
  if (enabled) return configToml;
  const sep = configToml && !configToml.endsWith('\n') ? '\n' : '';
  return `${configToml}${sep}${configToml.trim() ? '\n' : ''}[[skills.config]]\npath = ${tomlValue(skillPath)}\nenabled = false\n`;
}

// {SECRETS}

const SECRET_KEY = /(api[_-]?key|token|secret|passw(or)?d|\bpwd\b|credential|cookie|session|private[_-]?key|auth|bearer|(^|[_-])pat($|[_-])|(^|[_-])key$)/i;
const SECRET_VALUE = /^(Bearer\s+\S+|sk-[\w-]{8,}|sk_[\w-]{8,}|gh[pousr]_\w{16,}|github_pat_\w{16,}|xox[abprs]-[\w-]{8,}|glpat-[\w-]{8,}|AKIA[0-9A-Z]{12,}|AIza[\w-]{20,}|ya29\.[\w-]+|eyJ[\w-]+\.[\w-]+\.[\w-]*)$/;
const PLACEHOLDER = /^\$\{\w+\}$/;

/** A value that reads like a credential: by its name (`API_TOKEN`), by a known token prefix, or by looking random. */
export function isSecret(key: string, value: string): boolean {
  if (!value || PLACEHOLDER.test(value) || /^(true|false|\d{1,6})$/i.test(value)) return false;
  if (/^(\/|~\/|\.\.?\/|https?:\/\/)/.test(value) && !SECRET_VALUE.test(value)) return false;
  if (SECRET_KEY.test(key) || SECRET_VALUE.test(value)) return true;
  return value.length >= 32 && !/\s/.test(value) && /\d/.test(value) && /[a-z]/i.test(value) && !/[/\\]/.test(value);
}

const ASSIGNMENT = /([\w.-]+)(["']?\s*[:=]\s*)(["']?)([^\s"',;]+)/g;
const BEARER = /\bBearer\s+[\w.~+/-]+=*/gi;
export const REDACTED = '[redacted]';

/** Free text (a tool's output, a command) with credentials masked: `KEY=value` / `"key": "value"` pairs judged by `isSecret`, bare tokens by their known prefixes. */
export function redactSecrets(text: string): string {
  return text
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(ASSIGNMENT, (all, key: string, sep: string, quote: string, value: string) => (value !== REDACTED && isSecret(key, value) ? `${key}${sep}${quote}${REDACTED}` : all))
    .replace(/[^\s"'`,;:=()[\]{}<>]+/g, (token) => (SECRET_VALUE.test(token) ? REDACTED : token));
}

/**
 * The server with every secret-looking value replaced by `${VAR}`, so importing never copies a credential: the user sets
 * VAR (or re-enters the value in the tool) and the row shows "needs VAR" until then.
 */
export function stripSecrets(def: McpServerDef): { def: McpServerDef; stripped: string[] } {
  const stripped: string[] = [];
  const variable = (label: string) => {
    const name = `${def.name}_${label}`.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
    stripped.push(name);
    return `\${${name}}`;
  };
  const env = mapValues(def.env, (k, v) => {
    if (!isSecret(k, v)) return v;
    stripped.push(k);
    return `\${${k}}`;
  });
  const headers = mapValues(def.headers, (h, v) => {
    if (!isSecret(h, v)) return v;
    const bearer = /^Bearer\s+/i.exec(v);
    return bearer ? `Bearer ${variable('token')}` : variable(h);
  });
  const args = def.args?.map((arg, n, all) => {
    const flag = /^(--?[\w-]+)=(.+)$/.exec(arg);
    if (flag && isSecret(flag[1], flag[2])) return `${flag[1]}=${variable(flag[1].replace(/^-+/, ''))}`;
    const previous = all[n - 1];
    if (previous?.startsWith('-') && !previous.includes('=') && isSecret(previous, arg)) return variable(previous.replace(/^-+/, ''));
    return isSecret('', arg) ? variable(`arg_${n + 1}`) : arg;
  });
  let url = def.url;
  if (url) {
    try {
      const parsed = new URL(url);
      for (const [k, v] of [...parsed.searchParams]) if (isSecret(k, v)) parsed.searchParams.set(k, variable(k));
      if (parsed.password) parsed.password = variable('password');
      url = parsed.toString().replace(/%24%7B(\w+)%7D/gi, (_, v: string) => `\${${v}}`);
    } catch {}
  }
  return { def: clean({ ...def, env, headers, args, url }), stripped };
}

/** Every `${VAR}` a server reads, in env, headers, args and url. */
export function placeholders(def: McpServerDef): string[] {
  const values = [...Object.values(def.env ?? {}), ...Object.values(def.headers ?? {}), ...(def.args ?? []), def.url ?? '', def.command ?? ''];
  return [...new Set(values.flatMap((v) => [...v.matchAll(/\$\{(\w+)(:-[^}]*)?\}/g)].filter((m) => !m[2]).map((m) => m[1])))];
}

// {ADDING}

/**
 * Servers pasted as JSON: Claude's `{ "mcpServers": { name: {...} } }`, the bare map `{ name: {...} }`, or one server
 * `{ "name": ..., "command": ... }`. Throws a message the settings page can show.
 */
export function parseServerJson(text: string): McpServerDef[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`That isn't valid JSON: ${(error as Error).message}`);
  }
  if (!isObject(value)) throw new Error('Paste a JSON object');
  const map = isObject(value.mcpServers) ? value.mcpServers : value;
  if (typeof map.name === 'string' && (map.command || map.url)) return [validServer(fromClaude(map.name, map))];
  const servers = Object.entries(map).flatMap(([name, raw]) => (isObject(raw) ? [validServer(fromClaude(name, raw))] : []));
  if (!servers.length) throw new Error('No servers found. Each needs a "command" or a "url"');
  return servers;
}

/** `[KEY=value …] command [args…]` with shell-style quotes, or a URL for a remote server. */
export function parseServerCommand(name: string, line: string): McpServerDef {
  const words = shellWords(line.trim());
  if (/^https?:\/\//.test(words[0] ?? '')) return validServer({ name, type: 'http', url: words[0] });
  const env: Record<string, string> = {};
  while (/^[A-Za-z_]\w*=/.test(words[0] ?? '')) {
    const [k, ...v] = words.shift()!.split('=');
    env[k] = v.join('=');
  }
  const [command, ...args] = words;
  return validServer(clean({ name, type: 'stdio', command, args, env }));
}

export const SERVER_NAME = /^[\w.-]{1,64}$/;

function validServer(def: McpServerDef): McpServerDef {
  if (!SERVER_NAME.test(def.name)) throw new Error(`"${def.name}" can't be a server name: use letters, digits, - _ or .`);
  if (def.type === 'stdio' && !def.command) throw new Error(`${def.name} needs a command`);
  if (def.type !== 'stdio' && !def.url) throw new Error(`${def.name} needs a url`);
  return def;
}

function shellWords(line: string): string[] {
  const words: string[] = [];
  let word: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" || c === '"') {
      const end = line.indexOf(c, i + 1);
      if (end < 0) throw new Error('Unclosed quote in the command');
      word = (word ?? '') + line.slice(i + 1, end);
      i = end;
    } else if (c === '\\' && i + 1 < line.length) word = (word ?? '') + line[++i];
    else if (/\s/.test(c)) {
      if (word !== null) words.push(word);
      word = null;
    } else word = (word ?? '') + c;
  }
  if (word !== null) words.push(word);
  if (!words.length) throw new Error('Type the command that starts the server');
  return words;
}

/** One line under the server's name: the command it runs or the URL it talks to. */
export function serverSummary(def: McpServerDef): string {
  return def.type === 'stdio' ? [def.command, ...(def.args ?? [])].join(' ') : (def.url ?? '');
}

/** `name`, `description` and `argument-hint` from a SKILL.md's front matter; the folder name when there is none. */
export function skillMeta(skillMd: string, folderName: string): { name: string; description: string; argumentHint?: string } {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillMd)?.[1] ?? '';
  const field = (key: string) => new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(front)?.[1].trim().replace(/^(['"])(.*)\1$/, '$2') ?? '';
  const argumentHint = field('argument-hint');
  return { name: field('name') || folderName, description: field('description'), ...(argumentHint && { argumentHint }) };
}

/** A custom command's `<name>.md`: named by its file, described by its front matter or else its first line. */
export function commandMeta(commandMd: string, fileName: string): { name: string; description: string; argumentHint?: string } {
  const { description, argumentHint } = skillMeta(commandMd, fileName);
  const body = commandMd.replace(/^---\r?\n[\s\S]*?\r?\n---/, '');
  const firstLine = body.split('\n').find((l) => l.trim())?.trim().replace(/^#+\s*/, '') ?? '';
  return { name: fileName, description: description || firstLine, ...(argumentHint && { argumentHint }) };
}

/**
 * The install folders of the user-scope plugins `settings.json` turns on (`enabledPlugins: { "<name>@<marketplace>": true }`),
 * from `plugins/installed_plugins.json` (version 2: each id maps to its installs). Claude names their skills and commands `<name>:<skill>`.
 */
export function claudePluginRoots(installedJson: string, settingsJson: string): { name: string; root: string }[] {
  const enabled = parseJsonObject(settingsJson, 'settings.json').enabledPlugins;
  const { plugins } = parseJsonObject(installedJson, 'installed_plugins.json');
  if (!isObject(enabled) || !isObject(plugins)) return [];
  return Object.entries(plugins).flatMap(([id, installs]) => {
    const install = Array.isArray(installs) ? installs.find((i) => isObject(i) && i.scope === 'user' && typeof i.installPath === 'string') : undefined;
    return enabled[id] === true && install ? [{ name: id.split('@')[0], root: install.installPath as string }] : [];
  });
}

// {HELPERS}

function parseJsonObject(text: string, file: string): Record<string, unknown> {
  if (!text.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} isn't valid JSON: ${(error as Error).message}`);
  }
  if (!isObject(value)) throw new Error(`${file} isn't a JSON object`);
  return value;
}

// Two spaces and a trailing newline, as Claude Code writes its own files.
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined);
const stringMap = (v: unknown) => (isObject(v) ? Object.fromEntries(Object.entries(v).flatMap(([k, x]) => (typeof x === 'string' ? [[k, x]] : []))) : undefined);
const mapValues = (map: Record<string, string> | undefined, fn: (k: string, v: string) => string) => map && Object.fromEntries(Object.entries(map).map(([k, v]) => [k, fn(k, v)]));

/** Drops empty fields so a round trip doesn't grow `"args": []` and `"env": {}`. */
function clean(def: McpServerDef): McpServerDef {
  const out = { ...def } as Record<string, unknown>;
  for (const [k, v] of Object.entries(out)) if (v === undefined || (Array.isArray(v) && !v.length) || (isObject(v) && !Object.keys(v).length)) delete out[k];
  return out as unknown as McpServerDef;
}
