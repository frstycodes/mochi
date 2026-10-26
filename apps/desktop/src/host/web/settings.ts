import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type AgentSettings,
  type ProfileConfig,
  type SettingsHost,
} from '../types/settings.ts';
import { DEFAULT_ACCOUNTS } from '../../settings/accounts.ts';

// The web build has no processes to detect, folders to create or keychain to store in; the settings page explains that instead of calling these.
let current: AgentSettings = { ...DEFAULT_SETTINGS };
const desktopOnly = async (): Promise<never> => {
  throw new Error('Needs the desktop app');
};

export const settings: SettingsHost = {
  async get() {
    return current;
  },
  async set(patch) {
    current = mergeSettings(current, patch);
    return current;
  },
  async detect(accountId) {
    const provider =
      DEFAULT_ACCOUNTS.find((a) => a.id === accountId)?.provider ?? 'claude';
    return {
      provider,
      accountId,
      path: null,
      version: null,
      login: { state: 'unknown', reason: 'Needs the desktop app' },
    };
  },
  latestVersion: desktopOnly,
  updateHarness: desktopOnly,
  async accounts() {
    return { accounts: DEFAULT_ACCOUNTS, links: {} };
  },
  addAccount: desktopOnly,
  renameAccount: desktopOnly,
  removeAccount: desktopOnly,
  linkAccount: desktopOnly,
  async apiKey() {
    return { isSet: false, canStore: false };
  },
  setApiKey: desktopOnly,
  async profileFolder() {
    return {
      dir: '~/Library/Application Support/Mochi/profiles/latitude',
      files: [
        { name: 'mochi.md', provider: null, lines: 4 },
        { name: 'claude.md', provider: 'claude', lines: 0 },
        { name: 'codex.md', provider: 'codex', lines: 0 },
      ],
      usesAccountFile: { claude: true, codex: true },
    };
  },
  async readInstructions() {
    return '';
  },
  writeInstructions: desktopOnly,
  setAccountInstructions: desktopOnly,
  copyProfileFolder: desktopOnly,
  async agentConfig() {
    return DEMO_CONFIG;
  },
  previewConfig: desktopOnly,
  applyConfig: desktopOnly,
  testMcp: desktopOnly,
};

// What the settings page shows in the web build: one account per harness with a few servers and skills. Writes need the desktop app.
const DEMO_CONFIG: ProfileConfig = {
  claude: {
    provider: 'claude',
    account: DEFAULT_ACCOUNTS[0],
    instructions: {
      path: '~/.claude/CLAUDE.md',
      text: '# House rules\n\n- Lead with the result.\n- Run the tests covering touched code.\n',
    },
    mcpServers: [
      {
        def: {
          name: 'github',
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: {
            GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_PERSONAL_ACCESS_TOKEN}',
          },
        },
        enabled: true,
        scope: 'user',
        needs: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
      },
      {
        def: {
          name: 'linear',
          type: 'http',
          url: 'https://mcp.linear.app/mcp',
        },
        enabled: true,
        scope: 'user',
        needs: [],
      },
      {
        def: { name: 'figma', type: 'http', url: 'http://127.0.0.1:3845/mcp' },
        enabled: false,
        scope: 'user',
        needs: [],
      },
    ],
    skills: [
      {
        name: 'run',
        description: 'Launch and drive the app to see a change working',
        dir: '~/.claude/skills/run',
        enabled: true,
      },
      {
        name: 'fix-lint',
        description: 'Fix lint errors in a file and explain each change',
        argumentHint: '<file> [--fix]',
        dir: '~/.claude/skills/fix-lint',
        enabled: true,
      },
      {
        name: 'ui',
        description: 'Learned taste plus craft defaults for any UI work',
        dir: '~/.claude/skills/ui',
        enabled: true,
      },
      {
        name: 'code-review',
        description: 'Review the diff for bugs, then the cleanups worth making',
        argumentHint: '[effort]',
        dir: '~/.claude/skills/code-review',
        enabled: true,
      },
      {
        name: 'sizing-the-change',
        description:
          'Size a change before writing it: the smallest version that holds',
        dir: '~/.claude/skills/sizing-the-change',
        enabled: true,
      },
      {
        name: 'deploy-preview',
        description: 'Ship the branch to a preview URL',
        dir: '~/.claude/skills/deploy-preview',
        enabled: false,
      },
    ],
    commands: [
      {
        name: 'release-notes',
        description: 'Draft release notes from the merged PRs',
        argumentHint: '[since]',
        isSkill: false,
      },
      {
        name: 'ponytail:ponytail',
        description: 'Forces the simplest solution that actually works',
        isSkill: true,
      },
      {
        name: 'ponytail:ponytail-review',
        description: 'Review the diff for over-engineering',
        isSkill: true,
      },
    ],
    plugins: ['figma@claude-plugins-official', 'ponytail@ponytail'],
    claudeAiConnectors: [
      'claude.ai Gmail',
      'claude.ai Google Calendar',
      'claude.ai Slack',
    ],
    projectInstructions: null,
  },
  codex: {
    provider: 'codex',
    account: DEFAULT_ACCOUNTS[1],
    instructions: { path: '~/.codex/AGENTS.md', text: '' },
    mcpServers: [
      {
        def: {
          name: 'linear',
          type: 'http',
          url: 'https://mcp.linear.app/mcp',
        },
        enabled: true,
        scope: 'user',
        needs: [],
      },
      {
        def: { name: 'figma', type: 'http', url: 'http://127.0.0.1:3845/mcp' },
        enabled: true,
        scope: 'user',
        needs: [],
      },
    ],
    skills: [
      {
        name: 'ui',
        description: 'Learned taste plus craft defaults for any UI work',
        dir: '~/.codex/skills/ui',
        enabled: true,
      },
      {
        name: 'dataviz',
        description: 'Charts that read as one system in both themes',
        dir: '~/.codex/skills/dataviz',
        enabled: true,
      },
      {
        name: 'run',
        description: 'Launch and drive the app to see a change working',
        dir: '~/.codex/skills/run',
        enabled: true,
      },
    ],
    commands: [],
    plugins: [],
    projectInstructions: null,
  },
};
