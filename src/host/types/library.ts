import type { AppProviderId, DeviceCode } from '../../library/connectors.ts';
import type { CatalogSkill, LibraryEntry, Marketplace, MarketplaceCatalog } from '../../library/library.ts';
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
  /** Installs, or reinstalls keeping its profiles, and turns it on for this profile. */
  installSkill(spaceId: string, source: string, name: string): Promise<LibraryEntry[]>;
  /** The featured marketplaces, then the user's. */
  marketplaces(): Promise<Marketplace[]>;
  addMarketplace(source: string): Promise<Marketplace[]>;
  removeMarketplace(name: string): Promise<Marketplace[]>;
  marketplaceCatalog(name: string): Promise<MarketplaceCatalog>;
  installPlugin(spaceId: string, marketplace: string, name: string): Promise<LibraryEntry[]>;
  /**
   * Adds an account on a remote MCP server (turned on for the profile) and signs it in, in the browser when it uses OAuth.
   * For an agent's connect: `inPane` sends the sign-in page to `onAuthorize` instead of the user's browser, and `secretFrom`
   * has main read the client secret from a page element itself, so it never passes through the renderer or the agent;
   * `slackTokenFrom` is a Slack app configuration token there, from which main creates the app and takes its credentials.
   */
  addConnector(spaceId: string, account: { url: string; alias: string; apiKey?: string; clientId?: string; clientSecret?: string }, options?: { inPane?: boolean; secretFrom?: PageRef; slackTokenFrom?: PageRef }): Promise<LibraryEntry[]>;
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
  installSkill: 'invoke',
  marketplaces: 'invoke',
  addMarketplace: 'invoke',
  removeMarketplace: 'invoke',
  marketplaceCatalog: 'invoke',
  installPlugin: 'invoke',
  addConnector: 'invoke',
  onAuthorize: 'event',
  oauthApps: 'invoke',
  ownAppRedirect: 'invoke',
  onDeviceCode: 'event',
  signIn: 'invoke',
  update: 'invoke',
} satisfies Manifest<LibraryHost>;
