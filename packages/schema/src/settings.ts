import { Schema } from 'effect';
import { UtilityTask } from './agent.ts';
import { Provider } from './model.ts';
import { upgrade } from './version.ts';

const key = Schema.optionalKey;
const S = Schema.String;
const B = Schema.Boolean;
const N = Schema.Number;

const TASKS = UtilityTask.literals;

export const ModelChoice = Schema.Struct({ provider: Provider, model: S });
export type ModelChoice = typeof ModelChoice.Type;

export const HarnessSettings = Schema.Struct({ path: S, model: S, secondOpinionModel: S });

export const ImageGenHarness = Schema.Literals(['codex', 'off']);

/** `APP_ICONS` (`src/settings/settingOptions.ts`). */
export const AppIcon = Schema.Literals(['graphite', 'paper', 'sleepy', 'pixel', 'blueprint', 'dango', 'peek', 'sticker', 'riso']);

const perTask = <F extends Schema.Top>(field: F) => Schema.Struct(Object.fromEntries(TASKS.map((t) => [t, field])) as { [K in typeof UtilityTask.Type]: F });
const perProvider = <F extends Schema.Top>(field: F) => Schema.Struct({ claude: field, codex: field });

/** What main reads (`AgentSettings`, `src/host/types/settings.ts`). */
export const AgentSettings = Schema.Struct({
  concurrency: N,
  harnesses: perProvider(HarnessSettings),
  worktreeRoot: S,
  shell: S,
  prDrafts: B,
  prepareWorktrees: B,
  worktreeInclude: S,
  setupCommands: Schema.Record(S, S),
  sideChatModel: ModelChoice,
  utilityModels: perTask(ModelChoice),
  imageGen: ImageGenHarness,
  appIcon: AppIcon,
});
export type AgentSettings = typeof AgentSettings.Type;

export const Account = Schema.Struct({ id: S, provider: Provider, name: S, configDir: Schema.NullOr(S) });

/** Per profile, at most one account per provider; a missing entry is that provider's default account. */
export const AccountLinks = perProvider(key(S));

export const AccountsState = Schema.Struct({ accounts: Schema.Array(Account), links: Schema.Record(S, AccountLinks) });
export type AccountsState = typeof AccountsState.Type;

/**
 * `agent-settings.json` in main's userData (`Stored` in `electron/agents/config.ts`). Every field is optional: main merges
 * the file over `DEFAULT_SETTINGS`, so a file from before a field existed still reads. `apiKeys` are `safeStorage`
 * ciphertext, base64.
 */
const settingsFileFields = {
  concurrency: key(N),
  harnesses: key(perProvider(key(Schema.Struct({ path: key(S), model: key(S), secondOpinionModel: key(S) })))),
  worktreeRoot: key(S),
  shell: key(S),
  prDrafts: key(B),
  prepareWorktrees: key(B),
  worktreeInclude: key(S),
  setupCommands: key(Schema.Record(S, S)),
  sideChatModel: key(ModelChoice),
  utilityModels: key(perTask(key(ModelChoice))),
  imageGen: key(ImageGenHarness),
  appIcon: key(AppIcon),
  accounts: key(Schema.Array(Account)),
  links: key(Schema.Record(S, AccountLinks)),
  apiKeys: key(perProvider(key(S))),
  pastWorktreeRoots: key(Schema.Array(S)),
};

/** v1: `agent-settings.json` with `v`. */
export const SettingsFileV1 = Schema.Struct({ v: Schema.Literal(1), ...settingsFileFields });

/** Before `v`. Side chat ran only on Claude then, and `sideChatModel` could be a bare Claude model id (`migrateSettings`). */
const UnversionedSettingsFile = Schema.Struct({ ...settingsFileFields, v: key(Schema.Never), sideChatModel: key(Schema.Union([ModelChoice, S])) });

export const SettingsFile = Schema.Union([
  SettingsFileV1,
  upgrade(
    UnversionedSettingsFile,
    SettingsFileV1,
    ({ v: _, sideChatModel, ...old }) => ({ ...old, v: 1 as const, ...(sideChatModel !== undefined && { sideChatModel: typeof sideChatModel === 'string' ? { provider: 'claude' as const, model: sideChatModel } : sideChatModel }) }),
    ({ v: _, ...current }) => current,
  ),
]);
export type SettingsFile = typeof SettingsFile.Type;
