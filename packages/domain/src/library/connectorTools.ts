import { connectorFor } from './connectors.ts';

/**
 * Per-tool settings for connectors (LIBRARY.md › Connector names and tools): each tool is Off, Ask or Allow, written into each
 * harness's own per-session config. Off and Deny are one choice: both harnesses take a denied tool out of the model's
 * context (Claude's `disallowedTools`/deny rules, Codex's `disabled_tools`).
 */
export type ToolPermission = 'off' | 'ask' | 'allow';

export const TOOL_PERMISSIONS = [
  'allow',
  'ask',
  'off',
] as const satisfies ToolPermission[];

/** One tool as the server's `tools/list` describes it. */
export interface ConnectorTool {
  name: string;
  title: string | null;
  description: string;
  isReadOnly: boolean;
  isDestructive: boolean;
}

/** The last `tools/list`, kept so the page opens at once and sessions get defaults from annotations. */
export interface ConnectorToolList {
  tools: ConnectorTool[];
  listedAt: number;
  error: string | null;
}

/** A connector's settings, keyed in the index by its `connectorKey`, shared by every account on it. */
export interface ConnectorSettings {
  isOff?: boolean;
  tools?: Record<string, ToolPermission>;
  toolList?: ConnectorToolList;
}

/** Read-only tools run on their own; anything else (destructive, or unannotated) asks first. */
export function defaultPermission(
  tool: Pick<ConnectorTool, 'isReadOnly'>,
): ToolPermission {
  return tool.isReadOnly ? 'allow' : 'ask';
}

export function toolPermission(
  settings: ConnectorSettings | undefined,
  tool: ConnectorTool,
): { permission: ToolPermission; isChosen: boolean } {
  const chosen = settings?.tools?.[tool.name];
  if (chosen) return { permission: chosen, isChosen: true };
  return { permission: defaultPermission(tool), isChosen: false };
}

/** Tools split as Claude's connector settings show them: read-only ones, then everything that writes or deletes. */
export function toolGroups(tools: ConnectorTool[]) {
  return [
    { id: 'read', tools: tools.filter((t) => t.isReadOnly) },
    { id: 'write', tools: tools.filter((t) => !t.isReadOnly) },
  ] as const;
}

/** The one permission every tool in a group has, or null when they differ. */
export function groupPermission(
  settings: ConnectorSettings | undefined,
  tools: ConnectorTool[],
): ToolPermission | null {
  const permissions = new Set(
    tools.map((tool) => toolPermission(settings, tool).permission),
  );
  return permissions.size === 1 ? [...permissions][0] : null;
}

/** Gives every tool in the group the same permission. */
export function setTools(
  settings: ConnectorSettings,
  tools: ConnectorTool[],
  permission: ToolPermission,
): ConnectorSettings {
  return {
    ...settings,
    tools: {
      ...settings.tools,
      ...Object.fromEntries(tools.map((t) => [t.name, permission])),
    },
  };
}

export type ToolRules = Record<ToolPermission, string[]>;

/** Tool names by permission, for every tool listed or chosen before; empty for a connector that is off (it isn't loaded at all). */
export function toolRules(settings: ConnectorSettings | undefined): ToolRules {
  const rules: ToolRules = { allow: [], ask: [], off: [] };
  if (!settings || settings.isOff) return rules;
  const listed = settings.toolList?.tools ?? [];
  const names = new Set([
    ...listed.map((t) => t.name),
    ...Object.keys(settings.tools ?? {}),
  ]);
  for (const name of names) {
    const tool = listed.find((t) => t.name === name) ?? {
      name,
      title: null,
      description: '',
      isReadOnly: false,
      isDestructive: false,
    };
    rules[toolPermission(settings, tool).permission].push(name);
  }
  return rules;
}

/**
 * Claude Code permission rules (`settings.permissions` in the SDK's flag layer, read in sdk.d.ts) as `mcp__<server>__<tool>`.
 * Not verified: Claude's normalization of tool names (believed `[^a-zA-Z0-9_-]` → `_`); MCP tool names rarely carry others.
 */
export function claudePermissions(rulesByKey: Record<string, ToolRules>) {
  const permissions = {
    allow: [] as string[],
    ask: [] as string[],
    deny: [] as string[],
  };
  for (const [key, rules] of Object.entries(rulesByKey)) {
    const rule = (tool: string) =>
      `mcp__${key}__${tool.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    permissions.allow.push(...rules.allow.map(rule));
    permissions.ask.push(...rules.ask.map(rule));
    permissions.deny.push(...rules.off.map(rule));
  }
  return permissions;
}

/**
 * Codex's per-thread overrides for one server: `disabled_tools`, and `tools.<tool>.approval_mode` of `approve` (runs) or
 * `prompt` (asks). Checked against codex-cli 0.163.0 with `-c … mcp get`: it parses both and rejects unknown modes.
 * `tools` goes as one table so a tool name with a dot can't split the dotted path.
 */
export function codexToolConfig(
  key: string,
  rules: ToolRules,
): Record<string, unknown> {
  const tools = Object.fromEntries([
    ...rules.allow.map((t) => [t, { approval_mode: 'approve' }]),
    ...rules.ask.map((t) => [t, { approval_mode: 'prompt' }]),
  ]);
  return {
    ...(rules.off.length && {
      [`mcp_servers.${key}.disabled_tools`]: rules.off,
    }),
    ...(Object.keys(tools).length && { [`mcp_servers.${key}.tools`]: tools }),
  };
}

/** A connector's name: what you typed, else the directory's, else what the server calls itself, else its host. */
export function connectorName(
  url: string,
  given?: string,
  serverInfo?: { name?: string; title?: string },
) {
  return (
    given?.trim() ||
    connectorFor(url)?.name ||
    serverInfo?.title?.trim() ||
    serverInfo?.name?.trim() ||
    new URL(url).hostname
  );
}
