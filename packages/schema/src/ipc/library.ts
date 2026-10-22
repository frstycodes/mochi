import { Schema } from 'effect';
import { event, invoke, SpaceId, Str } from '../checks.ts';
import { Provider } from '../model.ts';
import { AbsolutePath, ViewId } from './browser.ts';

const opt = Schema.optional;
const T = Schema.Tuple;
const o = Schema.optional;
const S = Schema.String;
const N = Schema.Number;
const B = Schema.Boolean;
const NullS = Schema.NullOr(S);
const Providers = Schema.Array(Provider).check(Schema.isMinLength(1));

export const SkillPlacement = Schema.Struct({ provider: Provider, scope: Schema.Literals(['user', 'project']), dir: S });

/** Main still checks a `project` destination is an existing folder. */
export const SkillDestination = Schema.Union([
  Schema.Struct({ scope: Schema.Literal('library') }),
  Schema.Struct({ scope: Schema.Literal('user'), providers: Providers }),
  Schema.Struct({ scope: Schema.Literal('project'), providers: Providers, project: AbsolutePath.check(Schema.isMaxLength(1024)) }),
]);
export type SkillDestination = typeof SkillDestination.Type;

export const Marketplace = Schema.Struct({ name: S, source: S });

export const LibraryEntry = Schema.Struct({
  id: S,
  kind: Schema.Literals(['skill', 'server', 'plugin', 'connector']),
  name: S,
  title: S,
  description: S,
  targets: Schema.Array(Provider),
  isEnabled: B,
  profileIds: Schema.Array(S),
  source: NullS,
  icon: NullS,
  contents: NullS,
  remotes: Schema.Array(Schema.Struct({ name: S, url: S })),
  unsupported: Schema.Array(S),
  isLinked: Schema.NullOr(B),
  alias: NullS,
  autoUpdate: Schema.NullOr(B),
  updatedAt: Schema.NullOr(N),
  commit: NullS,
  placements: Schema.Array(SkillPlacement),
});
export type LibraryEntry = typeof LibraryEntry.Type;

export const CatalogPlugin = Schema.Struct({ name: S, title: NullS, description: NullS, category: NullS, author: NullS, version: NullS, homepage: NullS, icon: NullS });

export const MarketplaceCatalog = Schema.Struct({ name: S, displayName: S, description: NullS, owner: NullS, format: Schema.Literals(['claude', 'codex']), plugins: Schema.Array(CatalogPlugin) });
export type MarketplaceCatalog = typeof MarketplaceCatalog.Type;

const Named = Schema.Struct({ name: S, description: S });

export const PluginReview = Schema.Struct({
  file: S,
  sha256: S,
  name: S,
  title: S,
  version: NullS,
  author: NullS,
  description: NullS,
  skills: Schema.Array(Named),
  agents: Schema.Array(Named),
  hooks: Schema.Array(Schema.Struct({ event: S, matcher: NullS, condition: NullS, type: S, run: S })),
  servers: Schema.Array(Schema.Struct({ name: S, run: S, env: Schema.Array(S) })),
  remotes: Schema.Array(Schema.Struct({ name: S, url: S })),
  unsupported: Schema.Array(S),
  skipped: Schema.Array(S),
  loads: Schema.Struct({ claude: NullS, codex: NullS }),
  existing: Schema.NullOr(Schema.Struct({ id: S, title: S, isUpload: B })),
});
export type PluginReview = typeof PluginReview.Type;

export const CatalogSkill = Schema.Struct({ name: S, description: S, source: S, fileCount: N, icon: NullS, commit: NullS });

export const SkillsShSkill = Schema.Struct({ id: S, name: S, source: S, installs: N, installSource: S, url: S, icon: S });

export const ToolPermission = Schema.Literals(['off', 'ask', 'allow']);

export const ConnectorTool = Schema.Struct({ name: S, title: NullS, description: S, isReadOnly: B, isDestructive: B });

export const ConnectorToolList = Schema.Struct({ tools: Schema.Array(ConnectorTool), listedAt: N, error: NullS });

export const ConnectorSettings = Schema.Struct({ isOff: opt(B), tools: opt(Schema.Record(S, ToolPermission)), toolList: opt(ConnectorToolList) });
export type ConnectorSettings = typeof ConnectorSettings.Type;

/** What `setConnectorSettings` takes: main keeps the last tool listing itself. */
const ConnectorChoices = Schema.Struct({
  isOff: opt(B),
  tools: opt(Schema.Record(Str(128), ToolPermission).check(Schema.isMaxProperties(1000))),
});

export const AppProviderId = Schema.Literals(['github', 'slack', 'google']);

export const DeviceCode = Schema.Struct({ url: S, userCode: S, verificationUri: S });

export interface SetupTarget {
  readonly role: string;
  readonly name?: string;
  readonly exact?: boolean;
  readonly within?: SetupTarget;
}
// GAP: main's `updateSetupStep` handler passes the target through unchecked; this caps each name.
export const SetupTarget: Schema.Codec<SetupTarget> = Schema.Struct({
  role: Str(64),
  name: opt(Str(1024)),
  exact: opt(B),
  within: opt(Schema.suspend((): Schema.Codec<SetupTarget> => SetupTarget)),
});

export const CaptureKind = Schema.Literals(['slackConfigToken', 'slackClientId', 'slackClientSecret', 'googleClientId', 'googleClientSecret']);

const StepKind = Schema.Literals(['goto', 'click', 'fill', 'choose', 'ask', 'wait', 'jumpIfPresent', 'read', 'capture', 'end', 'stopIf']);
const Params = Schema.Record(S, S);

export const SetupResult = Schema.Union([
  Schema.Struct({ status: Schema.Literal('done'), captured: Schema.Array(CaptureKind), params: Params }),
  Schema.Struct({ status: Schema.Literal('needs'), stepId: S, param: S, question: S, options: Schema.Array(S) }),
  Schema.Struct({ status: Schema.Literal('stopped'), stepId: S, note: S, kind: StepKind, target: opt(SetupTarget), nextStepId: opt(S), reason: S, params: Params, isExpected: opt(Schema.Literal(true)) }),
]);
export type SetupResult = typeof SetupResult.Type;

// Same cap as `electron/library/upload.ts` `UPLOAD_LIMITS.archiveBytes`.
const MAX_ARCHIVE_BYTES = 20_000_000;

export const PluginFile = Schema.Struct({
  name: Str(255),
  // Structured clone carries the bytes over IPC; a JSON transport needs `Schema.Uint8ArrayFromBase64` here.
  bytes: Schema.Uint8Array.check(Schema.makeFilter((bytes) => bytes.length <= MAX_ARCHIVE_BYTES || `The file is over ${MAX_ARCHIVE_BYTES / 1_000_000} MB`)),
});

export const PageRef = Schema.Struct({ viewId: ViewId, ref: Str(64) });

const httpsOrLocal = (url: string) => {
  const parsed = URL.canParse(url) ? new URL(url) : null;
  return parsed?.protocol === 'https:' || (parsed?.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname));
};

/** Empty optional fields count as unset in main (`connectorInput`). */
const OptionalSecret = opt(Str(4096));

export const ConnectorAccount = Schema.Struct({
  url: Str(2048).check(Schema.makeFilter((url) => httpsOrLocal(url) || 'The server URL must start with https:// (or http://localhost)')),
  alias: Str(32).check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,31}$/)),
  name: OptionalSecret,
  apiKey: OptionalSecret,
  clientId: OptionalSecret,
  clientSecret: OptionalSecret,
});

export const ConnectOptions = Schema.Struct({ inPane: opt(B), secretFrom: opt(PageRef), slackTokenFrom: opt(PageRef), fromSetup: opt(B) });

export const SetupOptions = Schema.Struct({ params: opt(Schema.Record(S, Str(200)).check(Schema.isMaxProperties(8))), fromStep: opt(Str(64)) });

const ItemId = Str(64);
const Source = Str(512);
const Name = Str(128);
const Key = Str(128);
const Entries = Schema.Array(LibraryEntry);

/**
 * `LibraryHost` (`src/host/types/library.ts`). Main still checks a project destination is a folder and dedupes providers.
 */
export const libraryRpc = {
  list: invoke(T([SpaceId]), Entries),
  setEnabled: invoke(T([SpaceId, ItemId, B]), Entries),
  remove: invoke(T([SpaceId, ItemId]), Entries),
  importFromAccount: invoke(T([SpaceId, Provider, Schema.Array(Schema.Literals(['skills', 'mcp'])).check(Schema.isMinLength(1))]), Schema.Struct({ entries: Entries, notes: Schema.Array(S) })),
  discoverSkills: invoke(T([Source]), Schema.Array(CatalogSkill)),
  skillFiles: invoke(T([Source, Name]), Schema.Record(S, S)),
  installSkill: invoke(T([SpaceId, Source, Name, o(SkillDestination)]), Entries),
  searchSkillsSh: invoke(T([Str(200)]), Schema.Array(SkillsShSkill)),
  popularSkillsSh: invoke(T([]), Schema.Array(SkillsShSkill)),
  marketplaces: invoke(T([]), Schema.Array(Marketplace)),
  addMarketplace: invoke(T([Source]), Schema.Array(Marketplace)),
  removeMarketplace: invoke(T([Name]), Schema.Array(Marketplace)),
  marketplaceCatalog: invoke(T([Name]), MarketplaceCatalog),
  installPlugin: invoke(T([SpaceId, Name, Name]), Entries),
  reviewUpload: invoke(T([PluginFile]), PluginReview),
  installUpload: invoke(T([SpaceId, PluginFile, Schema.Struct({ sha256: Str(64), targets: Providers, profileIds: Schema.Array(SpaceId) })]), Entries),
  addConnector: invoke(T([SpaceId, ConnectorAccount, o(ConnectOptions)]), Entries),
  runSetup: invoke(T([Str(64), ViewId, o(SetupOptions)]), SetupResult),
  updateSetupStep: invoke(T([Str(64), Str(64), SetupTarget]), Schema.Struct({ before: SetupTarget, after: SetupTarget })),
  onAuthorize: event(Schema.Struct({ url: S, authorizationUrl: S })),
  oauthApps: invoke(T([]), Schema.Array(AppProviderId)),
  ownAppRedirect: invoke(T([]), S),
  onDeviceCode: event(DeviceCode),
  signIn: invoke(T([SpaceId, ItemId]), Entries),
  update: invoke(T([SpaceId, ItemId, o(B)]), Entries),
  renameConnector: invoke(T([SpaceId, Key, Str(64).check(Schema.makeFilter((name) => !!name.trim() || 'Give the connector a name'))]), Entries),
  connectorSettings: invoke(T([]), Schema.Record(S, ConnectorSettings)),
  listConnectorTools: invoke(T([Key]), ConnectorToolList),
  setConnectorSettings: invoke(T([Key, ConnectorChoices]), Schema.Record(S, ConnectorSettings)),
};
