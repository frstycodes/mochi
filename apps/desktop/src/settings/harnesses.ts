import type { Provider } from '../model.ts';

/**
 * Every agent harness Mochi can drive, in display order. Settings, accounts, detection and sign-in commands all read
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
    package: '@anthropic-ai/claude-code',
    docs: 'https://code.claude.com/docs/en/setup',
    defaultModel: '',
    /** The SDK's flag-layer `claudeMdExcludes` skips the account's CLAUDE.md (key present in the 0.3.296 SDK types and the installed claude binary). */
    canSkipAccountInstructions: true,
    /** Billing override the harness reads from its environment, stored in the keychain when the user sets one. */
    apiKey: {
      env: 'ANTHROPIC_API_KEY',
      label: 'Anthropic API key',
      placeholder: 'sk-ant-…',
    },
  },
  codex: {
    name: 'Codex',
    executable: 'codex',
    loginCommand: 'codex login',
    /** Verified with codex-cli 0.155.1: an empty CODEX_HOME reports "Not logged in" while the default is signed in. */
    configDirEnv: 'CODEX_HOME',
    defaultFolder: '~/.codex',
    install: 'npm install -g @openai/codex',
    package: '@openai/codex',
    docs: 'https://learn.chatgpt.com/docs/codex/cli',
    defaultModel: '',
    /** codex-cli 0.164: `thread/start` has no parameter for it, `project_doc_max_bytes=0` drops only project docs, and `--ignore-user-config` (exec only) also drops config.toml. */
    canSkipAccountInstructions: false,
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
  package: string;
  docs: string;
  /** '' runs the account's default model, from the provider's own list. */
  defaultModel: string;
  /** Whether Mochi can start a thread without the account's own instructions file (CLAUDE.md, AGENTS.md). */
  canSkipAccountInstructions: boolean;
  apiKey: { env: string; label: string; placeholder: string } | undefined;
}

export const HARNESS_IDS = Object.keys(HARNESSES) as Provider[];
