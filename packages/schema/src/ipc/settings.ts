import { Schema, SchemaTransformation } from 'effect';
import { ArrayOf, Int, invoke, SpaceId, Str } from '../checks.ts';
import { AgentCommand, McpServerDef, Provider } from '../model.ts';
import { UtilityTask } from '../agent.ts';
import {
  Account,
  AccountsState,
  AgentSettings,
  AppIcon,
  ImageGenHarness,
} from '../settings.ts';

// IPC structured clone keeps keys whose value is undefined, so optional arguments accept undefined as well as absence.
const opt = Schema.optional;
const key = Schema.optionalKey;
const S = Schema.String;
const B = Schema.Boolean;
const T = Schema.Tuple;

const MAX_MODEL_CHARS = 128;
// Large enough for the default account's `.claude.json`, which also holds Claude Code's per-project history.
const MAX_CONFIG_CHARS = 8 * 1024 * 1024;
const MAX_INSTRUCTIONS_CHARS = 256 * 1024;

const trimmed = (max = 4096) =>
  Str(max).pipe(Schema.decodeTo(S, SchemaTransformation.trim()));
const notBlank = (message: string) =>
  Schema.makeFilter((s: string) => !!s || message);

const isAbsolute = (path: string) =>
  path.startsWith('/') ||
  /^[a-zA-Z]:[\\/]/.test(path) ||
  path.startsWith('\\\\');
const isHomeOrAbsolute = (path: string) =>
  !path || isAbsolute(path) || path === '~' || path.startsWith('~/');

/** `absolutePath`: trimmed; empty (the default), absolute, or under `~/`. */
export const SettingsPath = trimmed().check(
  Schema.makeFilter(
    (p: string) =>
      isHomeOrAbsolute(p) || 'The path must be absolute or start with ~/',
  ),
);

/** An object whose keys must all be in `allowed` (`validProvider`, the background tasks), decoded through `struct`. */
const onlyKeys = <St extends Schema.Top>(
  allowed: readonly string[],
  message: string,
  struct: St,
) =>
  Schema.Record(S, Schema.Unknown)
    .check(
      Schema.makeFilter(
        (o) => Object.keys(o).every((k) => allowed.includes(k)) || message,
      ),
    )
    .pipe(Schema.decodeTo(struct));

/** Patch fields left undefined are skipped, as `validPatch` does, never merged in as undefined. */
const definedOnly = <St extends Schema.Top>(struct: St) =>
  Schema.Record(S, Schema.Unknown)
    .pipe(
      Schema.decodeTo(
        Schema.Record(S, Schema.Unknown),
        SchemaTransformation.transform({
          decode: (o) =>
            Object.fromEntries(
              Object.entries(o).filter(([, v]) => v !== undefined),
            ),
          encode: (o) => o,
        }),
      ),
    )
    .pipe(Schema.decodeTo(struct));

const PROVIDERS = ['claude', 'codex'];
const TASKS: readonly string[] = UtilityTask.literals;

const PatchModelChoice = Schema.Struct({
  provider: Provider,
  model: trimmed(MAX_MODEL_CHARS).check(notBlank('Pick a model')),
});

const HarnessPatch = definedOnly(
  Schema.Struct({
    path: key(
      trimmed().check(
        Schema.makeFilter(
          (p: string) => !p || isAbsolute(p) || 'The path must be absolute',
        ),
      ),
    ),
    model: key(trimmed(MAX_MODEL_CHARS)),
    secondOpinionModel: key(trimmed(MAX_MODEL_CHARS)),
  }),
);

/** Trimmed paths and commands; a blank command drops its folder (`validPatch`). */
const SetupCommands = Schema.Record(S, Str(4096))
  .pipe(
    Schema.decodeTo(
      Schema.Record(S, S),
      SchemaTransformation.transform({
        decode: (r) =>
          Object.fromEntries(
            Object.entries(r).flatMap(([folder, command]) =>
              command.trim() ? [[folder.trim(), command.trim()]] : [],
            ),
          ),
        encode: (r) => r,
      }),
    ),
  )
  .check(
    Schema.makeFilter(
      (r) =>
        Object.keys(r).every(
          (folder) => folder.length <= 4096 && isHomeOrAbsolute(folder),
        ) || 'The path must be absolute or start with ~/',
    ),
  );

/** `AgentSettingsPatch` as `validPatch` (`electron/ipc/settings.ts`) checks it. */
export const AgentSettingsPatch = definedOnly(
  Schema.Struct({
    concurrency: key(Int.check(Schema.isBetween({ minimum: 1, maximum: 16 }))),
    worktreeRoot: key(SettingsPath),
    shell: key(SettingsPath),
    prDrafts: key(B),
    prepareWorktrees: key(B),
    appIcon: key(AppIcon),
    worktreeInclude: key(Str(4096)),
    setupCommands: key(SetupCommands),
    imageGen: key(ImageGenHarness),
    sideChatModel: key(
      Schema.Struct({
        provider: Provider,
        model: trimmed(MAX_MODEL_CHARS).check(
          notBlank('Pick a side chat model'),
        ),
      }),
    ),
    utilityModels: key(
      onlyKeys(
        TASKS,
        'utilityModels takes background tasks only',
        Schema.Struct(
          Object.fromEntries(TASKS.map((t) => [t, key(PatchModelChoice)])) as {
            [K in typeof UtilityTask.Type]: Schema.optionalKey<
              typeof PatchModelChoice
            >;
          },
        ),
      ),
    ),
    harnesses: key(
      onlyKeys(
        PROVIDERS,
        'harnesses takes claude and codex only',
        Schema.Struct({ claude: key(HarnessPatch), codex: key(HarnessPatch) }),
      ),
    ),
  }),
);
export type AgentSettingsPatch = typeof AgentSettingsPatch.Type;

export const AgentLogin = Schema.Union([
  Schema.Struct({
    state: Schema.Literal('logged-in'),
    method: S,
    plan: key(S),
  }),
  Schema.Struct({ state: Schema.Literal('logged-out') }),
  Schema.Struct({ state: Schema.Literal('unknown'), reason: S }),
]);

export const AgentInstall = Schema.Struct({
  provider: Provider,
  accountId: S,
  path: Schema.NullOr(S),
  version: Schema.NullOr(S),
  login: AgentLogin,
});
export type AgentInstall = typeof AgentInstall.Type;

export const ApiKeyState = Schema.Struct({
  isSet: B,
  last4: key(S),
  canStore: B,
});

/** Only Claude has an API key entry in the harness registry (`HARNESSES[id].apiKey`). */
const KeyedProvider = Provider.check(
  Schema.makeFilter(
    (p: string) => p === 'claude' || 'This harness takes no API key',
  ),
);

// The message names the field, never the value: a rejected key must not be echoed into logs or the renderer.
const ApiKey = trimmed(512).check(
  Schema.makeFilter(
    (k: string) =>
      /^[\w-]{20,}$/.test(k) || 'That does not look like an API key',
  ),
);

const AccountName = trimmed(64).check(notBlank('Give the account a name'));

export const InstructionsFile = Schema.Struct({
  name: S,
  provider: Schema.NullOr(Provider),
  lines: Schema.Number,
});

export const ProfileFolder = Schema.Struct({
  dir: S,
  files: Schema.Array(InstructionsFile),
  usesAccountFile: Schema.Record(Provider, B),
});

export const McpEntry = Schema.Struct({
  def: McpServerDef,
  enabled: B,
  scope: Schema.Literals(['user', 'project']),
  needs: Schema.Array(S),
});

export const SkillEntry = Schema.Struct({
  name: S,
  description: S,
  argumentHint: key(S),
  dir: S,
  enabled: B,
});

export const ProviderConfig = Schema.Struct({
  provider: Provider,
  account: Account,
  instructions: Schema.Struct({ path: S, text: S }),
  mcpServers: Schema.Array(McpEntry),
  skills: Schema.Array(SkillEntry),
  commands: Schema.Array(Schema.Struct({ ...AgentCommand.fields, isSkill: B })),
  plugins: Schema.Array(S),
  claudeAiConnectors: key(Schema.Array(S)),
  projectInstructions: Schema.NullOr(S),
  error: key(S),
});

export const ProfileConfig = Schema.Struct({
  claude: ProviderConfig,
  codex: ProviderConfig,
});

const SERVER_NAME = /^[\w.-]{1,64}$/;
const ServerName = Str(64).check(Schema.isPattern(SERVER_NAME));

/**
 * `mcp-set` takes `McpServerDef`. GAP: main reads it through `fromClaude`, which also takes a raw Claude `.mcp.json` entry
 * (type inferred, stray fields dropped); this takes only the def the renderer builds.
 */
const ServerDef = McpServerDef.mapFields((fields) => ({
  ...fields,
  name: ServerName,
})).check(
  Schema.makeFilter(
    (s) =>
      (s.type === 'stdio' ? !!s.command : !!s.url) ||
      `${s.name} needs a ${s.type === 'stdio' ? 'command' : 'url'}`,
  ),
);

export const ConfigChange = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('mcp-set'),
    provider: Provider,
    server: ServerDef,
  }),
  Schema.Struct({
    kind: Schema.Literal('mcp-remove'),
    provider: Provider,
    name: ServerName,
  }),
  Schema.Struct({
    kind: Schema.Literal('mcp-enabled'),
    provider: Provider,
    name: ServerName,
    enabled: B,
  }),
  Schema.Struct({
    kind: Schema.Literal('skill-enabled'),
    provider: Provider,
    name: Str(128),
    enabled: B,
  }),
  Schema.Struct({
    kind: Schema.Literal('skill-import'),
    provider: Provider,
    folder: SettingsPath,
  }),
  Schema.Struct({
    kind: Schema.Literal('instructions-set'),
    provider: Provider,
    text: Str(MAX_INSTRUCTIONS_CHARS),
  }),
]);
export type ConfigChange = typeof ConfigChange.Type;

const Changes = ArrayOf(ConfigChange, 20);

export const FileEdit = Schema.Struct({ path: S, before: S, after: S });

export const ConfigPreview = Schema.Struct({
  edits: Schema.Array(FileEdit),
  copies: Schema.Array(Schema.Struct({ from: S, to: S })),
  notes: Schema.Array(S),
});

const AccountId = Str(128);
const Void = Schema.Void;

/** `SettingsHost` (`src/host/types/settings.ts`), with `electron/ipc/settings.ts`'s checks. */
export const SystemFont = Schema.Struct({ family: S, isMono: Schema.Boolean });

export const settingsRpc = {
  get: invoke(T([]), AgentSettings),
  set: invoke(T([AgentSettingsPatch]), AgentSettings),
  systemFonts: invoke(T([]), Schema.NullOr(ArrayOf(SystemFont, 10_000))),
  detect: invoke(T([AccountId]), AgentInstall),
  latestVersion: invoke(T([Provider]), Schema.NullOr(S)),
  updateHarness: invoke(T([Provider]), AgentInstall),
  accounts: invoke(T([]), AccountsState),
  addAccount: invoke(T([Provider, AccountName]), AccountsState),
  renameAccount: invoke(T([AccountId, AccountName]), AccountsState),
  removeAccount: invoke(T([AccountId]), AccountsState),
  linkAccount: invoke(T([AccountId, Provider, AccountId]), AccountsState),
  apiKey: invoke(T([KeyedProvider]), ApiKeyState),
  setApiKey: invoke(T([KeyedProvider, Schema.NullOr(ApiKey)]), ApiKeyState),
  profileFolder: invoke(T([SpaceId]), ProfileFolder),
  readInstructions: invoke(T([SpaceId, S]), Schema.String),
  writeInstructions: invoke(T([SpaceId, S, Str(MAX_INSTRUCTIONS_CHARS)]), Void),
  setAccountInstructions: invoke(T([SpaceId, Provider, B]), Void),
  copyProfileFolder: invoke(T([SpaceId, SpaceId]), Void),
  agentConfig: invoke(T([AccountId, opt(SettingsPath)]), ProfileConfig),
  previewConfig: invoke(T([AccountId, Changes]), ConfigPreview),
  applyConfig: invoke(
    T([AccountId, Changes, Schema.Record(S, Str(MAX_CONFIG_CHARS))]),
    Schema.Struct({ backupDir: Schema.NullOr(S) }),
  ),
  testMcp: invoke(
    T([AccountId, Provider, Str(64)]),
    Schema.Struct({ tools: Schema.Array(S) }),
  ),
};
