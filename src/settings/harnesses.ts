import type { Provider } from '../model.ts';

/**
 * Every agent harness Harness can drive, in display order. Settings, accounts, detection and sign-in commands all read
 * this registry, so supporting another harness is one entry here plus its login check in `electron/settings/detect.ts`.
 */
export const HARNESSES = {
  claude: {
    name: 'Claude Code',
    executable: 'claude',
    loginCommand: 'claude auth login',
    /** Docs (iam, "multiple accounts"): each folder holds its own login, and the macOS Keychain entry is keyed to it. */
    configDirEnv: 'CLAUDE_CONFIG_DIR',
    defaultFolder: '~/.claude',
    install: 'curl -fsSL https://claude.ai/install.sh | bash',
    docs: 'https://code.claude.com/docs/en/setup',
    defaultModel: 'claude-opus-5-5',
    modelHint: 'claude-opus-5-5',
    /** Billing override the harness reads from its environment, stored in the keychain when the user sets one. */
    apiKey: { env: 'ANTHROPIC_API_KEY', label: 'Anthropic API key', placeholder: 'sk-ant-…' },
  },
  codex: {
    name: 'Codex',
    executable: 'codex',
    loginCommand: 'codex login',
    /** Verified with codex-cli 0.155.1: an empty CODEX_HOME reports "Not logged in" while the default is signed in. */
    configDirEnv: 'CODEX_HOME',
    defaultFolder: '~/.codex',
    install: 'npm install -g @openai/codex',
    docs: 'https://learn.chatgpt.com/docs/codex/cli',
    defaultModel: '',
    modelHint: "Codex's own default",
    apiKey: undefined,
  },
} satisfies Record<Provider, Harness>;

export interface Harness {
  name: string;
  executable: string;
  loginCommand: string;
  configDirEnv: string;
  defaultFolder: string;
  install: string;
  docs: string;
  /** '' lets the harness pick its own configured default. */
  defaultModel: string;
  modelHint: string;
  apiKey: { env: string; label: string; placeholder: string } | undefined;
}

export const HARNESS_IDS = Object.keys(HARNESSES) as Provider[];
