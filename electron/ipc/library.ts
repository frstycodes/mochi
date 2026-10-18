import type { WebContents } from 'electron';
import type { DeviceCode } from '../../src/library/connectors.ts';
import { libraryEntries, removeItem, setItemEnabled } from '../../src/library/library.ts';
import type { LibraryHost } from '../../src/host/types/library.ts';
import type { Provider } from '../../src/model.ts';
import { HARNESS_IDS } from '../../src/settings/harnesses.ts';
import { discoverSkills, fetchMarketplace } from '../library/catalog.ts';
import { addMarketplace, importFromAccount, installPlugin, installSkill, marketplaces, readLibrary, removeMarketplace, updateLibrary } from '../library/store.ts';
import { addConnectorAccount, forgetAccount, signIn } from '../library/connectors.ts';
import { hasGoogleClient } from '../library/googleWorkspace.ts';
import { mochiOAuthProviders } from '../library/oauthApps.ts';
import { RELAY_URL } from '../remote/relayClient.ts';
import { setAutoUpdate, updateItem } from '../library/updates.ts';
import { record, string, type Handlers } from './handlers.ts';

const PARTS = ['skills', 'mcp'] as const;

export const library = {
  async list(_sender, spaceId) {
    return libraryEntries(await readLibrary(), spaceIdOf(spaceId));
  },
  async setEnabled(_sender, spaceId, id, isEnabled) {
    if (typeof isEnabled !== 'boolean') throw new TypeError('isEnabled must be a boolean');
    const space = spaceIdOf(spaceId);
    return libraryEntries(await updateLibrary((index) => setItemEnabled(index, space, string(id, 'id', 64), isEnabled)), space);
  },
  async remove(_sender, spaceId, id) {
    const space = spaceIdOf(spaceId);
    const itemId = string(id, 'id', 64);
    const item = (await readLibrary()).items.find((i) => i.id === itemId);
    if (item?.kind === 'connector') await forgetAccount(itemId);
    return libraryEntries(await updateLibrary((index) => removeItem(index, itemId)), space);
  },
  async importFromAccount(_sender, spaceId, provider, parts) {
    const space = spaceIdOf(spaceId);
    if (!HARNESS_IDS.includes(provider as Provider)) throw new TypeError(`provider must be one of ${HARNESS_IDS.join(', ')}`);
    if (!Array.isArray(parts) || !parts.length || !parts.every((p) => PARTS.includes(p))) throw new TypeError(`parts must list ${PARTS.join(' and/or ')}`);
    const notes = await importFromAccount(space, provider as Provider, parts);
    return { entries: libraryEntries(await readLibrary(), space), notes };
  },
  async discoverSkills(_sender, source) {
    const skills = await discoverSkills(string(source, 'source', 512));
    return skills.map(({ name, description, source: from, files, icon }) => ({ name, description, source: from, fileCount: Object.keys(files).length, icon }));
  },
  async installSkill(_sender, spaceId, source, name) {
    const space = spaceIdOf(spaceId);
    await installSkill(space, string(source, 'source', 512), string(name, 'name', 128));
    return libraryEntries(await readLibrary(), space);
  },
  async marketplaces() {
    return marketplaces();
  },
  async addMarketplace(_sender, source) {
    await addMarketplace(string(source, 'source', 512));
    return marketplaces();
  },
  async removeMarketplace(_sender, name) {
    await removeMarketplace(string(name, 'name', 128));
    return marketplaces();
  },
  async marketplaceCatalog(_sender, name) {
    const marketplace = (await marketplaces()).find((m) => m.name === string(name, 'name', 128));
    if (!marketplace) throw new Error(`No marketplace named ${name as string}`);
    return fetchMarketplace(marketplace.source);
  },
  async installPlugin(_sender, spaceId, marketplace, name) {
    const space = spaceIdOf(spaceId);
    await installPlugin(space, string(marketplace, 'marketplace', 128), string(name, 'name', 128));
    return libraryEntries(await readLibrary(), space);
  },
  async addConnector(sender, spaceId, input) {
    const space = spaceIdOf(spaceId);
    const account = await addConnectorAccount(space, connectorInput(input));
    await signIn(account, deviceCodeTo(sender));
    return libraryEntries(await readLibrary(), space);
  },
  async oauthApps() {
    return [...mochiOAuthProviders(), ...((await hasGoogleClient()) ? (['google'] as const) : [])];
  },
  async ownAppRedirect() {
    return `${RELAY_URL}/oauth/callback`;
  },
  async signIn(sender, spaceId, id) {
    const space = spaceIdOf(spaceId);
    const account = (await readLibrary()).items.find((i) => i.id === string(id, 'id', 64));
    if (account?.kind !== 'connector') throw new Error('No such connector account');
    await signIn(account, deviceCodeTo(sender));
    return libraryEntries(await readLibrary(), space);
  },
  async update(_sender, spaceId, id, autoUpdate) {
    const space = spaceIdOf(spaceId);
    const itemId = string(id, 'id', 64);
    if (autoUpdate === undefined) await updateItem(itemId);
    else if (typeof autoUpdate === 'boolean') await setAutoUpdate(itemId, autoUpdate);
    else throw new TypeError('autoUpdate must be a boolean');
    return libraryEntries(await readLibrary(), space);
  },
} satisfies Handlers<LibraryHost>;

/** A device sign-in's code goes to the window that started it, for the dialog to show. */
const deviceCodeTo = (sender: WebContents) => (code: DeviceCode) => !sender.isDestroyed() && sender.send('library:onDeviceCode', code);

const ALIAS = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** A server on https, or on this machine; an alias that can be an enum value and part of a key. */
function connectorInput(value: unknown) {
  const input = record(value, 'account');
  const url = string(input.url, 'url', 2048);
  const parsed = URL.canParse(url) ? new URL(url) : null;
  const isLocal = parsed?.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (!parsed || (parsed.protocol !== 'https:' && !isLocal)) throw new TypeError('The server URL must start with https:// (or http://localhost)');
  const alias = string(input.alias, 'alias', 32);
  if (!ALIAS.test(alias)) throw new TypeError('Name the account with lowercase letters, digits and dashes, like work or personal');
  const optional = (key: string) => (input[key] === undefined || input[key] === '' ? undefined : string(input[key], key, 4096));
  return { url, alias, apiKey: optional('apiKey'), clientId: optional('clientId'), clientSecret: optional('clientSecret') };
}

function spaceIdOf(value: unknown) {
  const id = string(value, 'spaceId', 128);
  if (!/^[a-z0-9-]+$/.test(id)) throw new TypeError('spaceId must be a profile id');
  return id;
}
