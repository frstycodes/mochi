import { DEFAULT_SETTINGS, mergeSettings, type AgentSettings, type ProfileConfig, type SettingsHost } from '../types/settings.ts';
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
    const provider = DEFAULT_ACCOUNTS.find((a) => a.id === accountId)?.provider ?? 'claude';
    return { provider, accountId, path: null, version: null, login: { state: 'unknown', reason: 'Needs the desktop app' } };
  },
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
    instructions: { path: '~/.claude/CLAUDE.md', text: '# House rules\n\n- Lead with the result.\n- Run the tests covering touched code.\n' },
    mcpServers: [
      { def: { name: 'github', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_PERSONAL_ACCESS_TOKEN}' } }, enabled: true, scope: 'user', needs: ['GITHUB_PERSONAL_ACCESS_TOKEN'] },
      { def: { name: 'linear', type: 'http', url: 'https://mcp.linear.app/mcp' }, enabled: true, scope: 'user', needs: [] },
      { def: { name: 'figma', type: 'http', url: 'http://127.0.0.1:3845/mcp' }, enabled: false, scope: 'user', needs: [] },
    ],
    skills: [
      { name: 'run', description: 'Launch and drive the app to see a change working', dir: '~/.claude/skills/run', enabled: true },
      { name: 'ui', description: 'Learned taste plus craft defaults for any UI work', dir: '~/.claude/skills/ui', enabled: true },
      { name: 'deploy-preview', description: 'Ship the branch to a preview URL', dir: '~/.claude/skills/deploy-preview', enabled: false },
    ],
    plugins: ['figma', 'ponytail'],
    projectInstructions: null,
  },
  codex: {
    provider: 'codex',
    account: DEFAULT_ACCOUNTS[1],
    instructions: { path: '~/.codex/AGENTS.md', text: '' },
    mcpServers: [{ def: { name: 'linear', type: 'http', url: 'https://mcp.linear.app/mcp' }, enabled: true, scope: 'user', needs: [] }],
    skills: [],
    plugins: [],
    projectInstructions: null,
  },
};
