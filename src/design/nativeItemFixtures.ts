import { DEFAULT_SPACES, type Provider, type Space } from '../model';

/** Where an item comes from: Mochi's own library, or the native config of the profile's Claude Code or Codex account. */
export type ItemSource = 'mochi' | Provider;
export type ItemKind =
  | 'skill'
  | 'plugin'
  | 'subagent'
  | 'hook'
  | 'server'
  | 'connector';
export type ItemPage = 'skills' | 'plugins' | 'connectors';

/** A Claude Code or Codex login with its own config folder (RUNTIME.md, accounts per profile). */
export type HarnessAccount = {
  id: string;
  provider: Provider;
  name: string;
  dir: string;
};

export type ProfileItem = {
  id: string;
  name: string;
  description: string;
  kind: ItemKind;
  source: ItemSource;
  /** Native items: the account whose config loads it, so only profiles on that account can turn it off. */
  accountId?: string;
  /** Muted meta under the name: where it lives. */
  where: string;
  /** Mochi items: the profiles that get it. Native items: the profiles that turned it off. */
  profileIds: string[];
  /** Why Mochi can't leave it out of a session (feasibility matrix in PROFILES-UX.md). */
  lockedReason?: string;
  /** Appeared in the native config since you last opened this page. */
  isNew?: boolean;
  /** Claude Code or Codex couldn't read it. */
  error?: string;
  icon?: string;
};

export const PROFILES: Space[] = DEFAULT_SPACES;

export const ACCOUNTS: HarnessAccount[] = [
  {
    id: 'claude-work',
    provider: 'claude',
    name: 'Work',
    dir: '~/.claude-work',
  },
  {
    id: 'claude-default',
    provider: 'claude',
    name: 'Default',
    dir: '~/.claude',
  },
  { id: 'codex-default', provider: 'codex', name: 'Default', dir: '~/.codex' },
];

/** Which account each profile runs on, per harness. Latitude is on the Work Claude account, the others share the default. */
export const PROFILE_ACCOUNTS: Record<string, Record<Provider, string>> = {
  latitude: { claude: 'claude-work', codex: 'codex-default' },
  personal: { claude: 'claude-default', codex: 'codex-default' },
  liane: { claude: 'claude-default', codex: 'codex-default' },
};

export const KIND_PAGE = {
  skill: 'skills',
  plugin: 'plugins',
  subagent: 'plugins',
  hook: 'plugins',
  server: 'connectors',
  connector: 'connectors',
} satisfies Record<ItemKind, ItemPage>;

export const KIND_LABELS = {
  skill: 'Skill',
  plugin: 'Plugin',
  subagent: 'Subagent',
  hook: 'Hook',
  server: 'MCP server',
  connector: 'Connector',
} satisfies Record<ItemKind, string>;

const CLAUDE_AI_LOCK =
  'Comes with your Claude.ai login. Mochi can turn off all Claude.ai connectors for a profile, not one yet.';
const CLAUDE_HOOK_LOCK =
  'Claude Code runs every hook in its settings. Mochi can turn off all hooks for a profile, or the plugin a hook came from, but not one hook.';
const CODEX_ROLE_LOCK =
  'Codex has no switch for one subagent. Mochi can turn off all Codex subagents for a profile.';

export const ITEMS: ProfileItem[] = [
  // Mochi's own library: handed to profiles, as today.
  {
    id: 'm-frontend',
    name: 'frontend-design',
    description: 'Distinctive, production-grade interfaces',
    kind: 'skill',
    source: 'mochi',
    where: 'anthropics/skills · /mochi:frontend-design',
    profileIds: ['latitude', 'personal'],
    icon: 'https://github.com/anthropics.png?size=80',
  },
  {
    id: 'm-pdf',
    name: 'pdf',
    description: 'Read, fill and merge PDFs',
    kind: 'skill',
    source: 'mochi',
    where: 'anthropics/skills · /mochi:pdf',
    profileIds: ['personal'],
    icon: 'https://github.com/anthropics.png?size=80',
  },
  {
    id: 'm-commit',
    name: 'commit-commands',
    description: 'Commit, push and open a PR in one step',
    kind: 'plugin',
    source: 'mochi',
    where: 'claude-plugins-official · 3 commands',
    profileIds: ['latitude', 'personal', 'liane'],
    icon: 'https://github.com/anthropics.png?size=80',
  },
  {
    id: 'm-linear',
    name: 'Linear',
    description: 'Issues, projects and cycles',
    kind: 'connector',
    source: 'mochi',
    where: 'mcp.linear.app · work, personal',
    profileIds: ['latitude'],
    icon: 'https://linear.app/favicon.ico',
  },

  // Claude Code, Work account (only Latitude runs on it).
  {
    id: 'cw-review',
    name: 'code-review',
    description: 'Review a diff against the team checklist',
    kind: 'skill',
    source: 'claude',
    accountId: 'claude-work',
    where: '~/.claude-work/skills/code-review',
    profileIds: [],
  },
  {
    id: 'cw-deploy',
    name: 'deploy-latitude',
    description: 'Ship the API to staging and production',
    kind: 'skill',
    source: 'claude',
    accountId: 'claude-work',
    where: 'Project · latitude-api · .claude/skills/deploy-latitude',
    profileIds: [],
    isNew: true,
  },
  {
    id: 'cw-sentry',
    name: 'sentry',
    description: 'Errors and releases from Sentry',
    kind: 'server',
    source: 'claude',
    accountId: 'claude-work',
    where: '~/.claude-work.json · stdio · npx @sentry/mcp-server',
    profileIds: [],
  },

  // Claude Code, Default account (Personal and Liane).
  {
    id: 'cd-ui',
    name: 'ui',
    description: 'Learned taste plus craft defaults for UI work',
    kind: 'skill',
    source: 'claude',
    accountId: 'claude-default',
    where: '~/.claude/skills/ui',
    profileIds: [],
  },
  {
    id: 'cd-unslop',
    name: 'unslop',
    description: 'Cut AI tells from any writing',
    kind: 'skill',
    source: 'claude',
    accountId: 'claude-default',
    where: '~/.claude/skills/unslop',
    profileIds: ['personal'],
  },
  {
    id: 'cd-ponytail',
    name: 'ponytail',
    description: 'Forces the laziest solution that works',
    kind: 'plugin',
    source: 'claude',
    accountId: 'claude-default',
    where: 'ponytail@ponytail · 6 skills, 2 hooks',
    profileIds: ['personal', 'liane'],
  },
  {
    id: 'cd-broken',
    name: 'release-notes',
    description: '',
    kind: 'skill',
    source: 'claude',
    accountId: 'claude-default',
    where: '~/.claude/skills/release-notes',
    profileIds: [],
    error: 'SKILL.md has no name in its front matter, so Claude Code skips it',
  },
  {
    id: 'cd-runner',
    name: 'runner',
    description: 'Runs typecheck, lint and tests and reports verbatim',
    kind: 'subagent',
    source: 'claude',
    accountId: 'claude-default',
    where: '~/.claude/agents/runner.md',
    profileIds: [],
  },
  {
    id: 'cd-hook',
    name: 'SessionStart: statusline check',
    description: 'bash ~/.claude/hooks/statusline-check.sh',
    kind: 'hook',
    source: 'claude',
    accountId: 'claude-default',
    where: '~/.claude/settings.json · hooks.SessionStart',
    profileIds: [],
    lockedReason: CLAUDE_HOOK_LOCK,
  },
  {
    id: 'cd-figma',
    name: 'figma',
    description: 'Design context from Figma files',
    kind: 'server',
    source: 'claude',
    accountId: 'claude-default',
    where: '~/.claude.json · http · mcp.figma.com',
    profileIds: ['liane'],
    isNew: true,
  },
  {
    id: 'cd-gmail',
    name: 'Gmail',
    description: 'Read and draft email',
    kind: 'connector',
    source: 'claude',
    accountId: 'claude-default',
    where: 'claude.ai · your Claude.ai account',
    profileIds: [],
    lockedReason: CLAUDE_AI_LOCK,
  },
  {
    id: 'cd-gcal',
    name: 'Google Calendar',
    description: 'Events and free time',
    kind: 'connector',
    source: 'claude',
    accountId: 'claude-default',
    where: 'claude.ai · your Claude.ai account',
    profileIds: [],
    lockedReason: CLAUDE_AI_LOCK,
  },

  // Codex, one account for everyone.
  {
    id: 'cx-openai-docs',
    name: 'openai-docs',
    description: 'Look things up in the OpenAI docs',
    kind: 'skill',
    source: 'codex',
    accountId: 'codex-default',
    where: '~/.codex/skills/.system/openai-docs',
    profileIds: [],
  },
  {
    id: 'cx-writing',
    name: 'writing',
    description: 'House style for docs and PRs',
    kind: 'skill',
    source: 'codex',
    accountId: 'codex-default',
    where: '~/.agents/skills/writing',
    profileIds: ['latitude'],
  },
  {
    id: 'cx-explorer',
    name: 'explorer',
    description: 'Read-only codebase search',
    kind: 'subagent',
    source: 'codex',
    accountId: 'codex-default',
    where: '~/.codex/config.toml · agents.explorer',
    profileIds: [],
    lockedReason: CODEX_ROLE_LOCK,
  },
  {
    id: 'cx-review-hook',
    name: 'UserPromptSubmit: secret scan',
    description: 'python3 ~/.codex/hooks/scan.py',
    kind: 'hook',
    source: 'codex',
    accountId: 'codex-default',
    where: '~/.codex/hooks.json · UserPromptSubmit',
    profileIds: [],
  },
  {
    id: 'cx-context7',
    name: 'context7',
    description: 'Up-to-date library docs',
    kind: 'server',
    source: 'codex',
    accountId: 'codex-default',
    where: '~/.codex/config.toml · stdio · npx @upstash/context7-mcp',
    profileIds: [],
  },
  {
    id: 'cx-playwright',
    name: 'playwright',
    description: '',
    kind: 'server',
    source: 'codex',
    accountId: 'codex-default',
    where: '~/.codex/config.toml · stdio · npx @playwright/mcp',
    profileIds: [],
    error: 'Exited at start: npx: command not found',
  },
];

export const accountOf = (id: string | undefined) =>
  ACCOUNTS.find((a) => a.id === id);

/** Profiles that run on the item's account: the only ones whose sessions load it, so the only ones that can turn it off. */
export function eligibleProfiles(item: ProfileItem) {
  if (item.source === 'mochi') return PROFILES;
  return PROFILES.filter(
    (p) => PROFILE_ACCOUNTS[p.id]?.[item.source as Provider] === item.accountId,
  );
}

/** Whether a session in this profile loads the item. */
export function isOnIn(item: ProfileItem, profileId: string) {
  if (item.source === 'mochi') return item.profileIds.includes(profileId);
  if (!eligibleProfiles(item).some((p) => p.id === profileId)) return false;
  return !!item.lockedReason || !item.profileIds.includes(profileId);
}
