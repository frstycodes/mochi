import type { Provider, Space } from '../model';

/**
 * Fixture data for the profile library variants (design page only): three profiles, Mochi's library and the native
 * Claude Code and Codex items of PROFILES-UX.md, with several accounts per connector. Nothing here reads real config.
 */

export type Source = 'mochi' | Provider;
export type Kind = 'skill' | 'plugin' | 'connector';

export type LibItem = {
  id: string;
  name: string;
  description: string;
  kind: Kind;
  /** What it is inside its kind, when that's not the kind itself: subagent, hook, MCP server. */
  part?: 'subagent' | 'hook' | 'server';
  source: Source;
  /** Native items: the harness account whose config loads it; only profiles on that account load it. */
  accountId?: string;
  where: string;
  icon?: string;
  /** Connector accounts: the service they sign in to, and which login this one is. */
  service?: string;
  account?: string;
  lockedReason?: string;
  isNew?: boolean;
  error?: string;
};

export const PROFILES: Space[] = [
  {
    id: 'personal',
    name: 'Personal',
    icon: 'home',
    plans: { claude: 'Max', codex: 'Plus' },
    github: '',
  },
  {
    id: 'work',
    name: 'Work',
    icon: 'work',
    plans: { claude: 'Team', codex: 'Business' },
    github: '',
  },
  {
    id: 'clientx',
    name: 'Client X',
    icon: 'rocket',
    plans: { claude: 'Max', codex: 'Plus' },
    github: '',
  },
];

export const ACCOUNTS = [
  { id: 'claude-default', provider: 'claude', name: 'Default' },
  { id: 'claude-work', provider: 'claude', name: 'Work' },
  { id: 'codex-default', provider: 'codex', name: 'Default' },
] as const satisfies readonly {
  id: string;
  provider: Provider;
  name: string;
}[];

/** Work runs on the Work Claude account; Personal and Client X share the default one. One Codex account for all. */
export const PROFILE_ACCOUNTS = {
  personal: ['claude-default', 'codex-default'],
  work: ['claude-work', 'codex-default'],
  clientx: ['claude-default', 'codex-default'],
} satisfies Record<string, string[]>;

const GH = (org: string) => `https://github.com/${org}.png?size=80`;
const FAVICON = (host: string) =>
  `https://www.google.com/s2/favicons?domain=${host}&sz=64`;

const CLAUDE_AI_LOCK =
  'Comes with your Claude.ai login. Mochi can turn off all Claude.ai connectors for a profile, not one yet.';
const CLAUDE_HOOK_LOCK =
  'Claude Code runs every hook in its settings. Mochi can turn off all hooks for a profile, or the plugin a hook came from, but not one hook.';
const CODEX_ROLE_LOCK =
  'Codex has no switch for one subagent. Mochi can turn off all Codex subagents for a profile.';

const mochiSkill = (
  id: string,
  name: string,
  description: string,
  repo = 'anthropics',
): LibItem => ({
  id,
  name,
  description,
  kind: 'skill',
  source: 'mochi',
  where: `${repo}/skills · /mochi:${name}`,
  icon: GH(repo),
});

const account = (
  id: string,
  service: string,
  host: string,
  alias: string,
  description: string,
): LibItem => ({
  id,
  name: `${service} · ${alias}`,
  description,
  kind: 'connector',
  source: 'mochi',
  where: host,
  icon: FAVICON(host),
  service,
  account: alias,
});

export const ITEMS: LibItem[] = [
  mochiSkill(
    'm-frontend',
    'frontend-design',
    'Distinctive, production-grade interfaces',
  ),
  mochiSkill('m-pdf', 'pdf', 'Read, fill and merge PDFs'),
  mochiSkill('m-docx', 'docx', 'Write and edit Word documents'),
  mochiSkill('m-xlsx', 'xlsx', 'Spreadsheets with formulas and charts'),
  mochiSkill(
    'm-webtest',
    'webapp-testing',
    'Drive a local web app with Playwright',
  ),
  mochiSkill(
    'm-brand',
    'brand-guidelines',
    'Acme’s colours, type and voice',
    'acme',
  ),
  mochiSkill(
    'm-sql',
    'sql-review',
    'Review migrations before they ship',
    'acme',
  ),
  mochiSkill(
    'm-invoice',
    'invoice-export',
    'Client X’s invoice format',
    'clientx',
  ),
  {
    id: 'm-commit',
    name: 'commit-commands',
    description: 'Commit, push and open a PR in one step',
    kind: 'plugin',
    source: 'mochi',
    where: 'claude-plugins-official · 3 commands',
    icon: GH('anthropics'),
  },
  {
    id: 'm-prreview',
    name: 'pr-review-toolkit',
    description: 'Six reviewers for a pull request',
    kind: 'plugin',
    source: 'mochi',
    where: 'claude-plugins-official · 6 subagents',
    icon: GH('anthropics'),
  },
  {
    id: 'm-security',
    name: 'security-guidance',
    description: 'Warns before risky edits',
    kind: 'plugin',
    source: 'mochi',
    where: 'claude-plugins-official · 1 hook',
    icon: GH('anthropics'),
  },
  {
    id: 'm-featuredev',
    name: 'feature-dev',
    description: 'Explore, plan and build a feature',
    kind: 'plugin',
    source: 'mochi',
    where: 'claude-plugins-official · 3 subagents, 1 command',
    icon: GH('anthropics'),
  },
  account(
    'c-gmail-me',
    'Gmail',
    'gmail.com',
    'sandesh@gmail.com',
    'Read and draft email',
  ),
  account(
    'c-gmail-acme',
    'Gmail',
    'gmail.com',
    'sandesh@acme.com',
    'Read and draft email',
  ),
  account(
    'c-gmail-cx',
    'Gmail',
    'gmail.com',
    'ops@clientx.io',
    'Read and draft email',
  ),
  account(
    'c-linear-acme',
    'Linear',
    'linear.app',
    'Acme',
    'Issues, projects and cycles',
  ),
  account(
    'c-linear-cx',
    'Linear',
    'linear.app',
    'Client X',
    'Issues, projects and cycles',
  ),
  account(
    'c-gh-me',
    'GitHub',
    'github.com',
    'frsty',
    'Repos, issues and pull requests',
  ),
  account(
    'c-gh-acme',
    'GitHub',
    'github.com',
    'acme-bot',
    'Repos, issues and pull requests',
  ),
  account(
    'c-notion-me',
    'Notion',
    'notion.so',
    'Personal',
    'Pages and databases',
  ),
  account(
    'c-slack-acme',
    'Slack',
    'slack.com',
    'Acme',
    'Channels and messages',
  ),
  account(
    'c-slack-cx',
    'Slack',
    'slack.com',
    'Client X',
    'Channels and messages',
  ),

  // Claude Code, Default account (Personal and Client X).
  {
    id: 'cd-ui',
    name: 'ui',
    description: 'Learned taste plus craft defaults for UI work',
    kind: 'skill',
    source: 'claude',
    accountId: 'claude-default',
    where: '~/.claude/skills/ui',
  },
  {
    id: 'cd-unslop',
    name: 'unslop',
    description: 'Cut AI tells from any writing',
    kind: 'skill',
    source: 'claude',
    accountId: 'claude-default',
    where: '~/.claude/skills/unslop',
    isNew: true,
  },
  {
    id: 'cd-ponytail',
    name: 'ponytail',
    description: 'Forces the laziest solution that works',
    kind: 'plugin',
    source: 'claude',
    accountId: 'claude-default',
    where: 'ponytail@ponytail · 6 skills, 2 hooks',
  },
  {
    id: 'cd-runner',
    name: 'runner',
    description: 'Runs typecheck, lint and tests and reports verbatim',
    kind: 'plugin',
    part: 'subagent',
    source: 'claude',
    accountId: 'claude-default',
    where: '~/.claude/agents/runner.md',
  },
  {
    id: 'cd-hook',
    name: 'SessionStart: statusline check',
    description: 'bash ~/.claude/hooks/statusline-check.sh',
    kind: 'plugin',
    part: 'hook',
    source: 'claude',
    accountId: 'claude-default',
    where: '~/.claude/settings.json · hooks.SessionStart',
    lockedReason: CLAUDE_HOOK_LOCK,
  },
  {
    id: 'cd-figma',
    name: 'figma',
    description: 'Design context from Figma files',
    kind: 'connector',
    part: 'server',
    source: 'claude',
    accountId: 'claude-default',
    where: '~/.claude.json · http · mcp.figma.com',
  },
  {
    id: 'cd-gcal',
    name: 'Google Calendar',
    description: 'Events and free time, from your Claude.ai login',
    kind: 'connector',
    source: 'claude',
    accountId: 'claude-default',
    where: 'claude.ai · your Claude.ai account',
    lockedReason: CLAUDE_AI_LOCK,
  },

  // Claude Code, Work account (only Work runs on it).
  {
    id: 'cw-review',
    name: 'code-review',
    description: 'Review a diff against the team checklist',
    kind: 'skill',
    source: 'claude',
    accountId: 'claude-work',
    where: '~/.claude-work/skills/code-review',
  },
  {
    id: 'cw-sentry',
    name: 'sentry',
    description: 'Errors and releases from Sentry',
    kind: 'connector',
    part: 'server',
    source: 'claude',
    accountId: 'claude-work',
    where: '~/.claude-work.json · stdio · npx @sentry/mcp-server',
  },

  // Codex, one account for everyone.
  {
    id: 'cx-writing',
    name: 'writing',
    description: 'House style for docs and PRs',
    kind: 'skill',
    source: 'codex',
    accountId: 'codex-default',
    where: '~/.agents/skills/writing',
  },
  {
    id: 'cx-explorer',
    name: 'explorer',
    description: 'Read-only codebase search',
    kind: 'plugin',
    part: 'subagent',
    source: 'codex',
    accountId: 'codex-default',
    where: '~/.codex/config.toml · agents.explorer',
    lockedReason: CODEX_ROLE_LOCK,
  },
  {
    id: 'cx-playwright',
    name: 'playwright',
    description: 'Drive a browser',
    kind: 'connector',
    part: 'server',
    source: 'codex',
    accountId: 'codex-default',
    where: '~/.codex/config.toml · stdio · npx @playwright/mcp',
    error: 'Exited at start: npx: command not found',
  },
];

/**
 * Which items each profile has. Mochi items are listed when added; native items are on unless listed in `off`.
 * Personal and Client X differ on purpose, so Compare has something to show.
 */
export const INITIAL_ADDED = {
  personal: [
    'm-frontend',
    'm-pdf',
    'm-docx',
    'm-commit',
    'c-gmail-me',
    'c-gh-me',
    'c-notion-me',
  ],
  work: [
    'm-frontend',
    'm-webtest',
    'm-brand',
    'm-sql',
    'm-commit',
    'm-prreview',
    'm-security',
    'c-gmail-acme',
    'c-linear-acme',
    'c-gh-acme',
    'c-gh-me',
    'c-slack-acme',
  ],
  clientx: [
    'm-pdf',
    'm-invoice',
    'm-commit',
    'c-gmail-cx',
    'c-linear-cx',
    'c-slack-cx',
  ],
} satisfies Record<string, string[]>;

export const INITIAL_OFF = {
  personal: ['cx-writing'],
  work: [],
  clientx: ['cd-ponytail', 'cd-figma'],
} satisfies Record<string, string[]>;

export const DISCOVER: LibItem[] = [
  mochiSkill('d-mcp-builder', 'mcp-builder', 'Build an MCP server from an API'),
  mochiSkill('d-pptx', 'pptx', 'Make and edit slide decks'),
  {
    id: 'd-hookify',
    name: 'hookify',
    description: 'Write hooks from plain rules',
    kind: 'plugin',
    source: 'mochi',
    where: 'claude-plugins-official · 1 command',
    icon: GH('anthropics'),
  },
];
