import { Schema, SchemaTransformation } from 'effect';
import { Int } from './checks.ts';
import { MergeMethod } from './ipc/git.ts';
import { ProjectIconMode } from './ipc/projects.ts';
import { ColorTheme } from './ipc/themes.ts';
import { PaneTabKind, Provider, Space } from './model.ts';
import { upgrade, versioned } from './version.ts';

// The renderer's persisted slices (`persistedSlice`, src/lib/uiStorage.ts) and main's project registry. Each row carries
// `v`; zustand's own envelope version is separate and stays at 1.

const key = Schema.optionalKey;
const S = Schema.String;
const B = Schema.Boolean;
const Strings = Schema.Array(S);

// {PINS}

/** A pinned message, or a passage inside one (`src/chat/pins.ts`); empty `text` pins the whole message. */
export const Pin = versioned(
  1,
  Schema.Struct({
    id: S,
    index: Int.check(Schema.isGreaterThanOrEqualTo(0)),
    text: S,
  }),
);

/** `harness.pins.v1`: each thread's pins, by thread id. */
export const Pins = Schema.Record(S, Schema.Array(Pin));
export type Pins = typeof Pins.Type;

// {PROFILES}

/** A profile as `isProfile` accepts it: its id names folders and the browser session, so lowercase letters, digits and dashes. */
export const Profile = versioned(
  1,
  Space.mapFields((fields) => ({
    ...fields,
    id: S.check(Schema.isPattern(/^[a-z0-9-]+$/)),
  })),
);

/**
 * `mochi.profiles.v1`. GAP: `parseProfiles` keeps the valid entries and the first `MAX_PROFILES` (9) of them; this refuses
 * the list over a bad one. A caller that wants today's leniency decodes each row with `Profile`.
 */
export const Profiles = Schema.Array(Profile);
export type Profiles = typeof Profiles.Type;

// {THEMES}

/** `mochi.themes.v1`, the web build's installed and custom themes (`src/host/web/themes.ts`); custom is file name → JSON text. */
export const StoredThemes = versioned(
  1,
  Schema.Struct({
    installed: Schema.Array(ColorTheme),
    custom: Schema.Record(S, S),
  }),
);
export type StoredThemes = typeof StoredThemes.Type;

// {PROJECTS}

/** A project row in main's `projects.json` (`StoredProject`, electron/projects/registry.ts); unset `iconMode` predates icons and reads as `auto`; unset `favoriteOrder` is not a favorite. */
export const StoredProject = versioned(
  1,
  Schema.Struct({
    id: S,
    name: S,
    path: S,
    origin: Schema.NullOr(S),
    addedAt: Schema.Number,
    iconMode: key(ProjectIconMode),
    favoriteOrder: key(Schema.Number),
  }),
);
export type StoredProject = typeof StoredProject.Type;

/** `projects.json`: every profile's projects. The file already carries its own `version: 1`. */
export const ProjectRegistryFile = Schema.Struct({
  version: Schema.Literal(1),
  spaces: Schema.Record(
    S,
    Schema.Struct({ projects: Schema.Array(StoredProject), isMigrated: B }),
  ),
});
export type ProjectRegistryFile = typeof ProjectRegistryFile.Type;

/**
 * `mochi.projects.v1`: each profile's recent project refs from before the registry (`legacyRecents`, src/projects.ts). Read
 * once to seed the registry and never written, so it gets no `v`.
 */
export const LegacyProjectRecents = Schema.Record(S, Strings);

// {PREFS}

export const ToolPolicy = Schema.Literals(['allow', 'ask', 'off']);
export const SharedAccess = Schema.Literals(['Manual', 'Auto', 'Full access']);
export const AgentControl = Schema.Literals(['read', 'changes', 'everything']);

/** `Prefs` (src/settings/prefs.ts). `toolPolicies` is keyed by tool name, which this package doesn't list. */
const prefsFields = {
  reduceMotion: Schema.Literals(['system', 'on', 'off']),
  animations: Strings,
  lightTheme: S,
  darkTheme: S,
  starredThemes: Strings,
  projectsFolder: S,
  restoreLayout: B,
  alertKinds: Strings,
  watchedToasts: B,
  dockBadge: B,
  starredModels: Strings,
  effort: S,
  speed: Schema.Literals(['', 'fast']),
  agent: Provider,
  permissions: SharedAccess,
  headerPins: Schema.Array(PaneTabKind),
  sidebarItems: Strings,
  goals: B,
  driftGuard: B,
  whileWorking: Schema.Literals(['queue', 'steer']),
  promptSuggestions: B,
  turnSpine: B,
  simplifyLength: Schema.Literals(['short', 'detailed']),
  simplifyNeedsFirst: B,
  simplifyRules: S,
  simplifyAuto: B,
  simplifyAutoWords: Schema.Number,
  branchFrom: Schema.Literals(['current', 'base']),
  idleChecks: Schema.Literals(['edited', 'always', 'off']),
  proposedGoals: Schema.Literals(['ask', 'apply']),
  idleAlerts: Strings,
  branchPrefix: S,
  autofixPrs: B,
  autoArchivePrs: B,
  workspaceMode: Schema.Literals(['worktree', 'folder']),
  diffStyle: Schema.Literals(['unified', 'split']),
  mergeMethod: MergeMethod,
  worktreeCleanup: Schema.Literals(['never', '1', '7', '30']),
  settledCleanup: Schema.Literals(['never', '30', '90', '180']),
  terminalFontSize: Schema.Number,
  terminalScrollback: Schema.Number,
  restoreTerminals: B,
  searchEngine: Schema.Literals(['duckduckgo', 'google', 'bing', 'kagi']),
  simulator: S,
  demoData: B,
  agentControl: AgentControl,
  toolPolicies: Schema.Record(S, ToolPolicy),
  recordReplays: B,
  rewindMode: Schema.Literals(['chat', 'files']),
  keybindings: Schema.Record(S, S),
};

/** The full set of prefs, as the renderer reads them once merged over `DEFAULT_PREFS`. */
export const Prefs = Schema.Struct(prefsFields);
export type Prefs = typeof Prefs.Type;

const optionalPrefs = Schema.Struct(
  Object.fromEntries(
    Object.entries(prefsFields).map(([k, field]) => [k, key(field)]),
  ) as {
    [K in keyof typeof prefsFields]: Schema.optionalKey<
      (typeof prefsFields)[K]
    >;
  },
);

/** v1: `mochi.prefs.v1` with `v`. Any subset: the renderer merges it over `DEFAULT_PREFS`, so a pref added later needs no migration. */
export const StoredPrefsV1 = optionalPrefs.pipe(
  Schema.fieldsAssign({ v: Schema.Literal(1) }),
);

const RENAMED_ACCESS: Record<string, string> = {
  'Ask first': 'Manual',
  'Auto edit': 'Auto',
};

/**
 * Before `v`, as `parsePrefs` read it: a value of the wrong type is dropped, not fatal; `goals` (retired) and the old empty
 * `branchPrefix` default are dropped; `permissions` take today's names, any other or `Plan` reading as `Auto`.
 */
const UnversionedPrefs = Schema.Record(S, Schema.Unknown)
  .check(
    Schema.makeFilter(
      (saved) => !('v' in saved) || 'an unversioned prefs row has no v',
    ),
  )
  .pipe(
    Schema.decodeTo(
      Schema.Record(S, Schema.Unknown),
      SchemaTransformation.transform({
        decode: upgradePrefs,
        encode: (prefs) => prefs,
      }),
    ),
  );

export const StoredPrefs = Schema.Union([
  StoredPrefsV1,
  upgrade(
    UnversionedPrefs,
    StoredPrefsV1,
    (prefs) => ({ ...(prefs as typeof optionalPrefs.Encoded), v: 1 as const }),
    ({ v: _, ...prefs }) => prefs,
  ),
]);
export type StoredPrefs = typeof StoredPrefs.Type;

function upgradePrefs(saved: Record<string, unknown>) {
  const { goals: _, ...rest } = saved;
  if (rest.branchPrefix === '') delete rest.branchPrefix;
  if (typeof rest.permissions === 'string')
    rest.permissions =
      SharedAccess.literals.find(
        (a) =>
          a ===
          (RENAMED_ACCESS[rest.permissions as string] ?? rest.permissions),
      ) ?? 'Auto';
  return Object.fromEntries(
    Object.entries(rest).filter(
      ([k, value]) =>
        k in prefsFields &&
        Schema.is(prefsFields[k as keyof typeof prefsFields])(value),
    ),
  );
}
