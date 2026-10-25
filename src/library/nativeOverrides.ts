import type { ProviderConfig } from '../host/types/settings.ts';
import type { McpServerDef } from '../settings/agentConfig.ts';
import { nativeItemsOf, type NativeItem } from './nativeItems.ts';

/**
 * Per-session overrides that leave a profile's turned-off native items out of one thread, without writing the account's
 * files and keeping its login (PROFILES-UX.md › Feasibility, each mechanism run against Claude Code 2.1.303 and codex-cli
 * 0.163.0 in throwaway homes).
 */

/** The account's items the profile turned off. An id from another account, or for an item that's gone, matches nothing. */
export function offItems(
  config: ProviderConfig,
  off: readonly string[],
): NativeItem[] {
  return nativeItemsOf(config).filter(
    (item) => off.includes(item.id) && !item.isOffNatively,
  );
}

/**
 * Claude's flag-layer settings: `skillOverrides` drops a skill from context, `enabledPlugins` a whole plugin,
 * `deniedMcpServers` a server or claude.ai connector. A connector is matched by name: they all share Anthropic's proxy
 * URL, and the `claude.ai ` prefix keeps the name from matching anything else.
 */
export function claudeNativeSettings(items: readonly NativeItem[]) {
  const skills = items.filter((i) => i.kind === 'skill');
  const plugins = items.filter((i) => i.kind === 'plugin');
  const servers = items.flatMap((i): ServerMatcher[] =>
    i.kind === 'server' && i.def
      ? [serverMatcher(i.def)]
      : i.kind === 'connector'
        ? [{ serverName: i.name }]
        : [],
  );
  return {
    ...(skills.length && {
      skillOverrides: Object.fromEntries(
        skills.map((s) => [s.name, 'off' as const]),
      ),
    }),
    ...(plugins.length && {
      enabledPlugins: Object.fromEntries(plugins.map((p) => [p.name, false])),
    }),
    ...(servers.length && { deniedMcpServers: servers }),
  };
}

type ServerMatcher =
  | { serverUrl: string }
  | { serverCommand: [string, ...string[]] }
  | { serverName: string };

/**
 * By command or URL, never by name: a name match would also block Mochi's own connector of that name (a native `linear`
 * turned off for Mochi's Linear). `serverCommand` was run; `serverUrl` is read from sdk.d.ts. A URL is a pattern there, so
 * its `*` would widen the match; no MCP URL seen carries one.
 */
function serverMatcher(def: McpServerDef): ServerMatcher {
  if (def.url) return { serverUrl: def.url };
  return { serverCommand: [def.command ?? '', ...(def.args ?? [])] };
}

/**
 * Codex's thread config: a server and a plugin each have an `enabled` key; skills go in `skills.config` by name, which
 * must be nested (the run used `{ skills: { config } }`). GAP: a server or plugin whose name holds a dot would split the dotted key.
 */
export function codexNativeConfig(
  items: readonly NativeItem[],
): Record<string, unknown> {
  const skills = items.filter((i) => i.kind === 'skill');
  return {
    ...Object.fromEntries(
      items
        .filter((i) => i.kind === 'server')
        .map((s) => [`mcp_servers.${s.name}.enabled`, false]),
    ),
    ...Object.fromEntries(
      items
        .filter((i) => i.kind === 'plugin')
        .map((p) => [`plugins.${p.name}.enabled`, false]),
    ),
    ...(skills.length && {
      skills: { config: skills.map((s) => ({ name: s.name, enabled: false })) },
    }),
  };
}
