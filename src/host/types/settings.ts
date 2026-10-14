import type { Provider } from '../../model.ts';
import { HARNESS_IDS, HARNESSES } from '../../settings/harnesses.ts';
import type { ConfigChange, McpEntry, SkillEntry } from '../../settings/agentConfig.ts';
import { CHEAP_MODELS, UTILITY_TASKS, type UtilityTask } from '../../utility/prompts.ts';
import type { Manifest } from './manifest.ts';

/** What the user's own install reports. Never carries credentials, emails or key material: only method and plan names. */
export interface AgentInstall {
  provider: Provider;
  accountId: AccountId;
  /** null when no executable was found. */
  path: string | null;
  version: string | null;
  login: AgentLogin;
}

export type AgentLogin =
  | { state: 'logged-in'; method: string; plan?: string }
  | { state: 'logged-out' }
  /** The tool ran but its status couldn't be read (timeout, unexpected output). */
  | { state: 'unknown'; reason: string };

/** Per harness. Empty strings mean "not set": find the executable on the user's PATH, let the harness pick its model. */
export interface HarnessSettings {
  path: string;
  model: string;
  /** What this harness reviews on when it gives another thread a second opinion; empty follows `model`. */
  secondOpinionModel: string;
}

/** Everything the main process reads. Empty strings mean "not set": the built-in worktrees folder, the user's `$SHELL`. */
export interface AgentSettings {
  concurrency: number;
  harnesses: Record<Provider, HarnessSettings>;
  worktreeRoot: string;
  shell: string;
  prDrafts: boolean;
  /** A new worktree gets its ignored files, dependencies and the project's setup command before the agent's first turn (`electron/git/setup.ts`). */
  prepareWorktrees: boolean;
  /** Ignored files copied from the project into a new worktree, gitignore patterns split by commas or lines; the project's own `.worktreeinclude` adds to them. */
  worktreeInclude: string;
  /** Per project folder (absolute path), a shell command run in a new worktree after the install. */
  setupCommands: Record<string, string>;
  /** The model new side chats start on, as the model chip names it; each side chat can switch, provider included. */
  sideChatModel: ModelChoice;
  /** Per background task (titles, commit and PR drafts…), the model tried first; `utilityCandidates` adds the fallbacks. */
  utilityModels: Record<UtilityTask, ModelChoice>;
}

export interface ModelChoice {
  provider: Provider;
  /** A model catalog id, or the harness's own id for one the catalog doesn't list. */
  model: string;
}

/** What `set` takes: any top-level field, per harness any of its fields, and any task's model. */
export type AgentSettingsPatch = Partial<Omit<AgentSettings, 'harnesses' | 'utilityModels'>> & { harnesses?: Partial<Record<Provider, Partial<HarnessSettings>>>; utilityModels?: Partial<Record<UtilityTask, ModelChoice>> };

/** The renderer only ever learns whether a key is stored and its last four characters. */
export interface ApiKeyState {
  isSet: boolean;
  last4?: string;
  /** False when the OS keychain isn't available, so a key can't be stored safely. */
  canStore: boolean;
}

export type AccountId = string;

/** One Claude Code or Codex login, kept in its own config folder; the user signs in from the tool itself. */
export interface Account {
  id: AccountId;
  provider: Provider;
  name: string;
  /** null: the tool's own default folder (`~/.claude`, `~/.codex`). */
  configDir: string | null;
}

/** Per profile (space): at most one account per provider. A missing entry means that provider's default account. */
export type AccountLinks = Partial<Record<Provider, AccountId>>;

export interface AccountsState {
  accounts: Account[];
  links: Record<string, AccountLinks>;
}

export interface SettingsHost {
  get(): Promise<AgentSettings>;
  set(patch: AgentSettingsPatch): Promise<AgentSettings>;
  /** The install plus the login it reports for this account's config folder. */
  detect(accountId: AccountId): Promise<AgentInstall>;
  accounts(): Promise<AccountsState>;
  /** Creates the account's config folder; the user then signs in with `signInCommand`. */
  addAccount(provider: Provider, name: string): Promise<AccountsState>;
  renameAccount(id: AccountId, name: string): Promise<AccountsState>;
  /** Refused for a default account and for one any profile links. The folder (and the login in it) stays on disk. */
  removeAccount(id: AccountId): Promise<AccountsState>;
  linkAccount(spaceId: string, provider: Provider, id: AccountId): Promise<AccountsState>;
  /** Only for harnesses with an `apiKey` entry in the registry. */
  apiKey(provider: Provider): Promise<ApiKeyState>;
  /** Pass null to remove the stored key. */
  setApiKey(provider: Provider, key: string | null): Promise<ApiKeyState>;
  /** What each of the profile's accounts carries in its own config folder; `projectRoot` adds that project's `.mcp.json`. */
  agentConfig(spaceId: string, projectRoot?: string): Promise<ProfileConfig>;
  /** The file edits `changes` would make, for the user to review; nothing is written. */
  previewConfig(spaceId: string, changes: ConfigChange[]): Promise<ConfigPreview>;
  /** Writes what `previewConfig` showed, after backing the files up; refused when a file changed since (`befores` by path). */
  applyConfig(spaceId: string, changes: ConfigChange[], befores: Record<string, string>): Promise<{ backupDir: string | null }>;
  /** Starts one of the account's servers the way the tool would and lists its tools. */
  testMcp(spaceId: string, provider: Provider, name: string): Promise<{ tools: string[] }>;
}

/** One account's instructions, servers and skills, as its tool will load them. */
export interface ProviderConfig {
  provider: Provider;
  account: Account;
  instructions: { path: string; text: string };
  mcpServers: McpEntry[];
  skills: SkillEntry[];
  plugins: string[];
  /** The project's own instructions file, when the project has one; the tool reads it next to the account's. */
  projectInstructions: string | null;
  /** A config file that couldn't be read; the lists then show what could be. */
  error?: string;
}

export type ProfileConfig = Record<Provider, ProviderConfig>;

export interface FileEdit {
  path: string;
  /** '' for a file that doesn't exist yet. */
  before: string;
  after: string;
}

export interface ConfigPreview {
  edits: FileEdit[];
  /** Skill folders copied whole. */
  copies: { from: string; to: string }[];
  /** What the user should know: secrets left out, servers skipped because the name is taken. */
  notes: string[];
}

export const settingsMethods = {
  get: 'invoke',
  set: 'invoke',
  detect: 'invoke',
  accounts: 'invoke',
  addAccount: 'invoke',
  renameAccount: 'invoke',
  removeAccount: 'invoke',
  linkAccount: 'invoke',
  apiKey: 'invoke',
  setApiKey: 'invoke',
  agentConfig: 'invoke',
  previewConfig: 'invoke',
  applyConfig: 'invoke',
  testMcp: 'invoke',
} satisfies Manifest<SettingsHost>;

export const DEFAULT_SETTINGS: AgentSettings = {
  concurrency: 6,
  harnesses: Object.fromEntries(HARNESS_IDS.map((id) => [id, { path: '', model: HARNESSES[id].defaultModel, secondOpinionModel: '' }])) as AgentSettings['harnesses'],
  worktreeRoot: '',
  shell: '',
  prDrafts: false,
  prepareWorktrees: true,
  worktreeInclude: '.env*',
  setupCommands: {},
  sideChatModel: { provider: 'claude', model: 'claude-sonnet-5-5' },
  utilityModels: {
    ...(Object.fromEntries(UTILITY_TASKS.map((task) => [task, { provider: 'claude', model: CHEAP_MODELS.claude }])) as AgentSettings['utilityModels']),
    // Measured on 20 finished turns: Haiku flagged things the agent never said it skipped (54 gaps, 10+ false); Sonnet 38, none false.
    audit: { provider: 'claude', model: 'claude-sonnet-5-5' },
  },
};

/** Saved settings from before side chat could run on Codex held a bare Claude model id. */
export function migrateSettings(saved: Record<string, unknown>): Partial<AgentSettings> {
  const { sideChatModel } = saved;
  return typeof sideChatModel === 'string' ? { ...saved, sideChatModel: { provider: 'claude', model: sideChatModel } } : saved;
}

/** Deep enough for this shape: harness entries merge field by field and tasks one by one, so a patch never drops a sibling. */
export function mergeSettings(base: AgentSettings, patch: AgentSettingsPatch): AgentSettings {
  const harnesses = { ...base.harnesses };
  for (const id of HARNESS_IDS) if (patch.harnesses?.[id]) harnesses[id] = { ...harnesses[id], ...patch.harnesses[id] };
  const { harnesses: _, utilityModels, ...rest } = patch;
  return { ...base, ...rest, harnesses, utilityModels: { ...base.utilityModels, ...utilityModels } };
}

export const CONCURRENCY_RANGE = { min: 1, max: 16 } as const;
