import type { Provider } from '../model.ts';

export const ACCESS = ['Manual', 'Auto', 'Full access', 'Plan'] as const;
export type Access = (typeof ACCESS)[number];

/** The modes every harness has; Settings' default picks among these. */
export const SHARED_ACCESS = [
  'Manual',
  'Auto',
  'Full access',
] as const satisfies readonly Access[];
export type SharedAccess = (typeof SHARED_ACCESS)[number];

/**
 * What each harness does in each mode: the `permissionMode` its adapter takes (Claude: `electron/agents/claude/sessions.ts`,
 * Codex: `POLICIES` in `packages/core/src/agents/codex/adapter.ts`) and the line the composer's menu shows. A harness without a mode leaves it out.
 */
export const PERMISSIONS = {
  claude: {
    Manual: {
      mode: 'default',
      hint: 'Reads and searches the web; asks before edits and commands',
    },
    Auto: {
      mode: 'auto',
      hint: 'Edits files and runs safe commands without asking; asks before risky ones',
    },
    'Full access': {
      mode: 'bypassPermissions',
      hint: 'Never asks, except before dangerous rm commands',
    },
    Plan: {
      mode: 'plan',
      hint: 'Reads and plans only; changes nothing until you approve the plan',
    },
  },
  codex: {
    Manual: {
      mode: 'default',
      hint: 'Reads, searches and runs read-only commands; asks before edits, writes and network',
    },
    Auto: {
      mode: 'auto',
      hint: "Edits and runs commands in the workspace; Codex's reviewer vets anything beyond it",
    },
    'Full access': {
      mode: 'bypassPermissions',
      hint: 'Never asks; no sandbox, full disk and network access',
    },
  },
} satisfies Record<
  Provider,
  Partial<Record<Access, { mode: string; hint: string }>>
>;

const LEGACY_ACCESS: Record<string, Access> = {
  'Ask first': 'Manual',
  'Auto edit': 'Auto',
};

/** A stored mode in today's names: threads and prefs saved before the rename still read 'Ask first' / 'Auto edit'. */
export const accessOf = (value: unknown): Access =>
  LEGACY_ACCESS[String(value)] ?? (ACCESS.find((a) => a === value) || 'Auto');

/** The mode a harness runs: one it lacks (Plan carried to Codex) runs as Manual, never as something looser. */
export const accessFor = (provider: Provider, access: Access): Access =>
  access in PERMISSIONS[provider] ? access : 'Manual';

export const permissionModeOf = (
  provider: Provider,
  access: Access,
): string => {
  const modes: Partial<Record<Access, { mode: string }>> =
    PERMISSIONS[provider];
  return modes[accessFor(provider, access)]!.mode;
};
