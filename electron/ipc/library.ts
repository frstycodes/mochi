import type { WebContents } from 'electron';
import { connectorKey, type DeviceCode } from '../../src/library/connectors.ts';
import { libraryEntries, removeItem, setItemEnabled, type LibraryConnector } from '../../src/library/library.ts';
import type { LibraryHost, PageRef } from '../../src/host/types/library.ts';
import type { Provider } from '../../src/model.ts';
import { HARNESS_IDS } from '../../src/settings/harnesses.ts';
import { discoverSkills, fetchMarketplace } from '../library/catalog.ts';
import { addMarketplace, importFromAccount, installPlugin, installSkill, marketplaces, readLibrary, removeMarketplace, updateLibrary } from '../library/store.ts';
import { copiedByRef, pageOfView, readRefValue } from '../browser/views.ts';
import { overrideStep, playwrightOps, recipeFor } from '../library/recipeRunner.ts';
import { runRecipe } from '../library/runRecipe.ts';
import { addConnectorAccount, forgetAccount, listConnectorTools, nameFromServer, readSecrets, recordIdentity, renameConnector, saveSecrets, signIn, withSettings } from '../library/connectors.ts';
import { TOOL_PERMISSIONS, type ConnectorSettings, type ToolPermission } from '../../src/library/connectorTools.ts';
import { sameAccount } from '../library/identity.ts';
import { hasGoogleClient } from '../library/googleWorkspace.ts';
import { createSlackApp } from '../library/slackApp.ts';
import { googleClientFrom, slackClientFrom, type SetupCapture, type SlackApps } from '../library/ownApp.ts';
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
  async addConnector(sender, spaceId, input, options) {
    const space = spaceIdOf(spaceId);
    const { inPane, secretFrom, slackTokenFrom, fromSetup } = connectOptions(options);
    const fields = connectorInput(input);
    if (secretFrom) fields.clientSecret = await secretOnPage(sender, secretFrom);
    if (slackTokenFrom) Object.assign(fields, await slackAppFrom(sender, slackTokenFrom));
    if (fromSetup) Object.assign(fields, await clientFromSetup(fields.url, takeCapture(sender, fields.url)));
    const account = await addConnectorAccount(space, fields);
    const open = inPane ? async (authorizationUrl: string) => void (!sender.isDestroyed() && sender.send('library:onAuthorize', { url: account.url, authorizationUrl })) : undefined;
    const info = await signIn(account, deviceCodeTo(sender), open);
    if (!fields.name) await nameFromServer(account, info);
    await keepOneAccount(space, await recordIdentity(account));
    return libraryEntries(await readLibrary(), space);
  },
  async oauthApps() {
    return [...mochiOAuthProviders(), ...((await hasGoogleClient()) ? (['google'] as const) : [])];
  },
  async runSetup(sender, connector, viewId, options) {
    const name = string(connector, 'connector', 64);
    const view = string(viewId, 'viewId', 32);
    if (!/^view-\d+$/.test(view)) throw new TypeError('viewId is not a view id');
    const { params, fromStep } = setupOptions(options);
    const { result, captured, params: own } = await runRecipe(await recipeFor(name), params, playwrightOps(await pageOfView(sender, view)), fromStep);
    if (Object.keys(captured).length) captures.set(`${sender.id}/${name}`, { values: captured, params: own, at: Date.now() });
    return result;
  },
  async updateSetupStep(_sender, connector, stepId, target) {
    return overrideStep(string(connector, 'connector', 64), string(stepId, 'stepId', 64), target);
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
  async renameConnector(_sender, spaceId, key, name) {
    const space = spaceIdOf(spaceId);
    const title = string(name, 'name', 64).trim();
    if (!title) throw new TypeError('Give the connector a name');
    await renameConnector(string(key, 'key', 128), title);
    return libraryEntries(await readLibrary(), space);
  },
  async connectorSettings() {
    return (await readLibrary()).connectors ?? {};
  },
  async listConnectorTools(_sender, key) {
    return listConnectorTools(string(key, 'key', 128));
  },
  async setConnectorSettings(_sender, key, settings) {
    const chosen = connectorSettingsInput(settings);
    const index = await updateLibrary((current) => withSettings(current, string(key, 'key', 128), ({ toolList }) => ({ ...chosen, ...(toolList && { toolList }) })));
    return index.connectors ?? {};
  },
} satisfies Handlers<LibraryHost>;

function connectorSettingsInput(value: unknown): Omit<ConnectorSettings, 'toolList'> {
  const input = record(value, 'settings');
  if (input.isOff !== undefined && typeof input.isOff !== 'boolean') throw new TypeError('isOff must be a boolean');
  const tools = Object.entries(input.tools === undefined ? {} : record(input.tools, 'tools'));
  if (tools.length > 1000) throw new TypeError('tools holds at most 1000 choices');
  for (const [name, permission] of tools) {
    string(name, 'tool name', 128);
    if (!TOOL_PERMISSIONS.includes(permission as ToolPermission)) throw new TypeError(`${name} must be one of ${TOOL_PERMISSIONS.join(', ')}`);
  }
  return { ...(input.isOff === true && { isOff: true }), tools: Object.fromEntries(tools) as Record<string, ToolPermission> };
}

/** A device sign-in's code goes to the window that started it, for the dialog to show. */
const deviceCodeTo = (sender: WebContents) => (code: DeviceCode) => !sender.isDestroyed() && sender.send('library:onDeviceCode', code);

function connectOptions(value: unknown) {
  if (value === undefined) return {};
  const options = record(value, 'options');
  return { inPane: options.inPane === true, secretFrom: pageRef(options.secretFrom, 'secretFrom'), slackTokenFrom: pageRef(options.slackTokenFrom, 'slackTokenFrom'), fromSetup: options.fromSetup === true };
}

function pageRef(value: unknown, name: string): PageRef | undefined {
  if (value === undefined) return undefined;
  const at = record(value, name);
  const viewId = string(at.viewId, 'viewId', 32);
  if (!/^view-\d+$/.test(viewId)) throw new TypeError('viewId is not a view id');
  return { viewId, ref: string(at.ref, 'ref', 64) };
}

/** Mochi's Slack app, created with the configuration token on the page; the token and the credentials stay in main. */
async function slackAppFrom(sender: WebContents, at: PageRef) {
  const token = await valueAt(sender, at, (v) => v.startsWith('xoxe'));
  if (!token) throw new Error('No app configuration token there (they start xoxe): Generate Token on api.slack.com/apps, take a new browser_snapshot and pass the ref of the Access Token or its Copy button');
  const { clientId, clientSecret } = await createSlackApp(token, `${RELAY_URL}/oauth/callback`);
  return { clientId, clientSecret };
}

/**
 * A second name for an account that's already connected (same service, same person signed in): the new one goes, and the
 * one already there is turned on for this profile. Thrown, so the dialog and the agent both say what happened.
 */
async function keepOneAccount(spaceId: string, account: LibraryConnector) {
  const index = await readLibrary();
  const existing = sameAccount(index.items, account);
  if (!existing) return;
  await forgetAccount(account.id);
  await updateLibrary((current) => setItemEnabled(removeItem(current, account.id), spaceId, existing.id, true));
  throw new Error(`${account.identity!.label} is already connected as ${existing.title} (${existing.alias}): it's on for this profile now, and ${account.alias} wasn't added`);
}

/** Secrets the last setup run captured, per window and connector; taken once, and gone after `CAPTURE_TTL_MS`. */
const captures = new Map<string, SetupCapture & { at: number }>();
const CAPTURE_TTL_MS = 15 * 60_000;

function takeCapture(sender: WebContents, url: string): SetupCapture {
  const key = `${sender.id}/${connectorKey(url)}`;
  const capture = captures.get(key);
  captures.delete(key);
  if (!capture || Date.now() - capture.at >= CAPTURE_TTL_MS) throw new Error('Nothing from a setup run: run_setup first (what it captures lasts 15 minutes)');
  return capture;
}

const SLACK_APPS: SlackApps = {
  read: async (key) => {
    const known = (await readSecrets(key)).clientInformation;
    return known?.client_secret ? { clientId: known.client_id, clientSecret: known.client_secret } : undefined;
  },
  save: (key, { clientId, clientSecret }) => saveSecrets(key, { clientInformation: { client_id: clientId, client_secret: clientSecret }, isOwnClient: true }),
  create: (token) => createSlackApp(token, `${RELAY_URL}/oauth/callback`),
};

function clientFromSetup(url: string, capture: SetupCapture) {
  const key = connectorKey(url);
  if (key === 'slack') return slackClientFrom(capture, SLACK_APPS);
  if (key === 'google-workspace') return googleClientFrom(capture);
  throw new Error(`fromSetup is for Slack and Google Workspace, not ${key}`);
}

function setupOptions(value: unknown) {
  if (value === undefined) return { params: {} };
  const options = record(value, 'options');
  const params = options.params === undefined ? {} : record(options.params, 'params');
  if (Object.keys(params).length > 8) throw new TypeError('params holds at most 8 values');
  return { params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, string(v, k, 200)])), fromStep: options.fromStep === undefined ? undefined : string(options.fromStep, 'fromStep', 64) };
}

/** The client secret where an agent pointed: read in main, so it reaches only the keychain. A masked or empty field is refused. */
async function secretOnPage(sender: WebContents, at: PageRef) {
  const value = await valueAt(sender, at, (v) => v.length >= 8 && !/^[•*·●\s]+$/.test(v));
  if (!value) throw new Error('That field reads empty or masked: reveal the secret on the page (its Show button) or pass the ref of its Copy button, from a new browser_snapshot');
  return value;
}

/** An element's value or text when `isValid`, else what clicking it copies (a Copy button); '' when neither is. */
async function valueAt(sender: WebContents, { viewId, ref }: PageRef, isValid: (value: string) => boolean) {
  const value = await readRefValue(sender, viewId, ref);
  if (isValid(value)) return value;
  const copied = await copiedByRef(sender, viewId, ref);
  return isValid(copied) ? copied : '';
}

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
  return { url, alias, name: optional('name')?.slice(0, 64), apiKey: optional('apiKey'), clientId: optional('clientId'), clientSecret: optional('clientSecret') };
}

function spaceIdOf(value: unknown) {
  const id = string(value, 'spaceId', 128);
  if (!/^[a-z0-9-]+$/.test(id)) throw new TypeError('spaceId must be a profile id');
  return id;
}
