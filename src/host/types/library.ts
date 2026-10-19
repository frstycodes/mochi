import type { ConnectorSettings, ConnectorToolList } from '../../library/connectorTools.ts';
import type { AppProviderId, DeviceCode } from '../../library/connectors.ts';
import type { CatalogSkill, LibraryEntry, Marketplace, MarketplaceCatalog, PluginReview, SkillDestination, SkillsShSkill } from '../../library/library.ts';
import type { SetupResult, SetupTarget } from '../../library/recipes.ts';
import type { Provider } from '../../model.ts';
import type { Manifest } from './manifest.ts';

/** The profile library (LIBRARY.md), held by main; every change returns the profile's entries as they are after it. */
export interface LibraryHost {
  list(spaceId: string): Promise<LibraryEntry[]>;
  setEnabled(spaceId: string, id: string, isEnabled: boolean): Promise<LibraryEntry[]>;
  /** Out of the library and every profile. */
  remove(spaceId: string, id: string): Promise<LibraryEntry[]>;
  /** Copies the profile's account's own skills and servers in, turned on for the profile; `notes` says what was skipped or stripped. */
  importFromAccount(spaceId: string, provider: Provider, parts: ('skills' | 'mcp')[]): Promise<{ entries: LibraryEntry[]; notes: string[] }>;
  /** Every SKILL.md folder in a public GitHub repo or path (`owner/repo`, `owner/repo/dir`, or a github.com URL). */
  discoverSkills(source: string): Promise<CatalogSkill[]>;
  /** A found skill's text files by path, SKILL.md included, to read before installing. */
  skillFiles(source: string, name: string): Promise<Record<string, string>>;
  /** Installs, or reinstalls keeping its profiles: into the library for this profile (default), or to the agents' own folders. */
  installSkill(spaceId: string, source: string, name: string, destination?: SkillDestination): Promise<LibraryEntry[]>;
  /** skills.sh's search (2+ characters) and its all-time leaderboard; cached, and the last answer when offline. */
  searchSkillsSh(query: string): Promise<SkillsShSkill[]>;
  popularSkillsSh(): Promise<SkillsShSkill[]>;
  /** The featured marketplaces, then the user's. */
  marketplaces(): Promise<Marketplace[]>;
  addMarketplace(source: string): Promise<Marketplace[]>;
  removeMarketplace(name: string): Promise<Marketplace[]>;
  marketplaceCatalog(name: string): Promise<MarketplaceCatalog>;
  installPlugin(spaceId: string, marketplace: string, name: string): Promise<LibraryEntry[]>;
  /** Reads a plugin file (.plugin, .zip, .tar.gz, .tgz) for review; throws with the reason when it isn't one Mochi can install. */
  reviewUpload(file: PluginFile): Promise<PluginReview>;
  /** Installs the file reviewed as `sha256` for `targets`, turned on for `profileIds`; replaces a plugin of the same name. */
  installUpload(spaceId: string, file: PluginFile, choice: { sha256: string; targets: Provider[]; profileIds: string[] }): Promise<LibraryEntry[]>;
  /**
   * Adds an account on a remote MCP server (turned on for the profile) and signs it in, in the browser when it uses OAuth.
   * For an agent's connect: `inPane` sends the sign-in page to `onAuthorize` instead of the user's browser, and `secretFrom`
   * has main read the client secret from a page element itself, so it never passes through the renderer or the agent;
   * `slackTokenFrom` is a Slack app configuration token there, from which main creates the app and takes its credentials;
   * `fromSetup` uses what the last `runSetup` for the connector captured instead.
   */
  addConnector(spaceId: string, account: { url: string; alias: string; name?: string; apiKey?: string; clientId?: string; clientSecret?: string }, options?: { inPane?: boolean; secretFrom?: PageRef; slackTokenFrom?: PageRef; fromSetup?: boolean }): Promise<LibraryEntry[]>;
  /** Runs a connector's setup recipe on a browser tab (LIBRARY.md); secrets it captures stay in main for `fromSetup`. */
  runSetup(connector: string, viewId: string, options?: { params?: Record<string, string>; fromStep?: string }): Promise<SetupResult>;
  /** Saves the user's own target for one step of a connector's recipe. */
  updateSetupStep(connector: string, stepId: string, target: SetupTarget): Promise<{ before: SetupTarget; after: SetupTarget }>;
  /** A sign-in page an `inPane` connect wants opened, for the agent's tab. */
  onAuthorize(listener: (page: { url: string; authorizationUrl: string }) => void): () => void;
  /** The providers accounts can sign in with without bringing an app: Mochi's own, or for Google one the user saved. */
  oauthApps(): Promise<AppProviderId[]>;
  /** The redirect URL to register in an app the user brings for a provider that only takes https redirects (Mochi's relay). */
  ownAppRedirect(): Promise<string>;
  /** A device sign-in's one-time code, for the connect dialog to show while main waits for approval. */
  onDeviceCode(listener: (code: DeviceCode) => void): () => void;
  /** Signs a connector account in again. */
  signIn(spaceId: string, id: string): Promise<LibraryEntry[]>;
  /** Updates a skill or plugin from its source now; `autoUpdate` set leaves it to follow its source (or pins it). */
  update(spaceId: string, id: string, autoUpdate?: boolean): Promise<LibraryEntry[]>;
  /** Names a connector (every account on it); its key, and so its permission rules, stay. */
  renameConnector(spaceId: string, key: string, name: string): Promise<LibraryEntry[]>;
  /** Every connector's on/off, tool permissions and last tool listing, by key. */
  connectorSettings(): Promise<Record<string, ConnectorSettings>>;
  /** Lists the connector's tools from its first signed-in account and keeps the result (an error included). */
  listConnectorTools(key: string): Promise<ConnectorToolList>;
  setConnectorSettings(key: string, settings: Omit<ConnectorSettings, 'toolList'>): Promise<Record<string, ConnectorSettings>>;
}

export interface PluginFile {
  name: string;
  bytes: Uint8Array;
}

/** An element on a browser tab's page, by its ref from the latest snapshot. */
export interface PageRef {
  viewId: string;
  ref: string;
}

export const libraryMethods = {
  list: 'invoke',
  setEnabled: 'invoke',
  remove: 'invoke',
  importFromAccount: 'invoke',
  discoverSkills: 'invoke',
  skillFiles: 'invoke',
  installSkill: 'invoke',
  searchSkillsSh: 'invoke',
  popularSkillsSh: 'invoke',
  marketplaces: 'invoke',
  addMarketplace: 'invoke',
  removeMarketplace: 'invoke',
  marketplaceCatalog: 'invoke',
  installPlugin: 'invoke',
  reviewUpload: 'invoke',
  installUpload: 'invoke',
  addConnector: 'invoke',
  onAuthorize: 'event',
  runSetup: 'invoke',
  updateSetupStep: 'invoke',
  oauthApps: 'invoke',
  ownAppRedirect: 'invoke',
  onDeviceCode: 'event',
  signIn: 'invoke',
  update: 'invoke',
  renameConnector: 'invoke',
  connectorSettings: 'invoke',
  listConnectorTools: 'invoke',
  setConnectorSettings: 'invoke',
} satisfies Manifest<LibraryHost>;
