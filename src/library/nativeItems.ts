import type { Account, ProviderConfig } from '../host/types/settings.ts';
import type { McpServerDef } from '../settings/agentConfig.ts';
import type { Provider } from '../model.ts';
import type { DiskFile } from '../host/types/fs.ts';

export type NativeKind = 'skill' | 'plugin' | 'server' | 'connector';

/** One of Claude Code's or Codex's own items, as an account's config loads it. Mochi never changes it; a profile can only leave it out (PROFILES-UX.md). */
export interface NativeItem {
  /** Stable across reads: harness, account, kind, scope and name. A profile's `nativeOff` holds these. */
  id: string;
  provider: Provider;
  accountId: string;
  kind: NativeKind;
  name: string;
  description: string;
  /** Muted meta: where it lives. */
  where: string;
  /** The file it's written in, to open or reveal: a skill's SKILL.md, a server's config file; null for a plugin. */
  file: DiskFile | null;
  /** Why the tool can't start it as configured, verbatim enough to act on. */
  problem?: string;
  /** Turned off in the tool's own config, so no session loads it whatever the profile says. */
  isOffNatively: boolean;
  /** A server's own entry, so a session can block exactly it by command or URL, never another server with its name. */
  def?: McpServerDef;
}

export const NATIVE_KIND_LABELS = {
  skill: 'Skill',
  plugin: 'Plugin',
  server: 'MCP server',
  connector: 'Connector',
} satisfies Record<NativeKind, string>;

/** Every item one account's config loads, skills, then plugins, then servers, then claude.ai connectors. */
export function nativeItemsOf(config: ProviderConfig): NativeItem[] {
  const { provider, account } = config;
  const base = { provider, accountId: account.id };
  const id = (kind: NativeKind, scope: string, name: string) =>
    `${provider}:${account.id}:${kind}:${scope}:${name}`;
  const skills = config.skills.map((skill) => ({
    ...base,
    id: id('skill', 'user', skill.name),
    kind: 'skill' as const,
    name: skill.name,
    description: skill.description,
    where: tilde(skill.dir),
    file: { root: skill.dir, path: 'SKILL.md' },
    isOffNatively: !skill.enabled,
  }));
  const plugins = config.plugins.map((name) => ({
    ...base,
    id: id('plugin', 'user', name),
    kind: 'plugin' as const,
    name,
    description: '',
    where: name,
    file: null,
    isOffNatively: false,
  }));
  const servers = config.mcpServers.map(({ def, scope, enabled, needs }) => ({
    ...base,
    id: id('server', scope, def.name),
    kind: 'server' as const,
    name: def.name,
    description: '',
    where: [
      scope === 'project' ? 'Project · .mcp.json' : serverFile(account),
      def.type,
      def.url ?? [def.command, ...(def.args ?? [])].filter(Boolean).join(' '),
    ].join(' · '),
    // A project's .mcp.json is opened from the project, not from here.
    file: scope === 'project' ? null : serverConfigFile(account),
    ...(needs.length && {
      problem: `Needs ${LIST.format(needs)} set to start`,
    }),
    isOffNatively: !enabled,
    def,
  }));
  const connectors = (config.claudeAiConnectors ?? []).map((name) => ({
    ...base,
    id: id('connector', 'claude.ai', name),
    kind: 'connector' as const,
    name,
    description: '',
    where: 'Your claude.ai account',
    file: null,
    isOffNatively: false,
  }));
  return [...skills, ...plugins, ...servers, ...connectors];
}

/** The account's own folder, as the user would type it. */
export function accountDir(account: Account) {
  return account.configDir
    ? tilde(account.configDir)
    : account.provider === 'claude'
      ? '~/.claude'
      : '~/.codex';
}

/** `off` with `ids` added (isOff) or taken out, each once. */
export function withOff(
  off: readonly string[] | undefined,
  ids: readonly string[],
  isOff: boolean,
): string[] {
  const rest = (off ?? []).filter((id) => !ids.includes(id));
  return isOff ? [...rest, ...ids] : rest;
}

/** Where the account's own servers are written: Claude's `.claude.json` beside its config folder (in the home folder by default), Codex's config.toml. */
const serverConfigFile = (account: Account): DiskFile =>
  account.provider === 'codex'
    ? { root: accountDir(account), path: 'config.toml' }
    : { root: account.configDir ?? '~', path: '.claude.json' };

const serverFile = (account: Account) =>
  account.provider === 'codex'
    ? `${accountDir(account)}/config.toml`
    : account.configDir
      ? `${tilde(account.configDir)}/.claude.json`
      : '~/.claude.json';

const tilde = (path: string) => path.replace(/^\/(Users|home)\/[^/]+/, '~');

const LIST = new Intl.ListFormat('en', { type: 'conjunction' });
