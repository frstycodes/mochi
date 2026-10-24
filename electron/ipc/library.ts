import type { WebContents } from 'electron';
import { statSync } from 'node:fs';
import { connectorKey, type DeviceCode } from '../../src/library/connectors.ts';
import { libraryEntries, removeItem, setItemEnabled, type LibraryConnector } from '../../src/library/library.ts';
import type { LibraryHost, PageRef } from '../../src/host/types/library.ts';
import { discoverSkills, fetchMarketplace } from '../library/catalog.ts';
import { addMarketplace, addOwnSkill, importFromAccount, installPlugin, installSkill, installUploadedPlugin, marketplaces, readLibrary, removeMarketplace, removePlacements, reviewUploadedPlugin, updateLibrary } from '../library/store.ts';
import { popularSkillsSh, searchSkillsSh } from '../library/skillsSh.ts';
import type { SkillDestination } from '../../src/library/library.ts';
import { copiedByRef, pageOfView, readRefValue } from '../browser/views.ts';
import { overrideStep, playwrightOps, recipeFor } from '../library/recipeRunner.ts';
import { runRecipe } from '../library/runRecipe.ts';
import { addConnectorAccount, forgetAccount, listConnectorTools, nameFromServer, readSecrets, recordIdentity, renameConnector, saveSecrets, signIn, withSettings } from '../library/connectors.ts';
import { sameAccount } from '../library/identity.ts';
import { hasGoogleClient } from '../library/googleWorkspace.ts';
import { createSlackApp } from '../library/slackApp.ts';
import { googleClientFrom, slackClientFrom, type SetupCapture, type SlackApps } from '../library/ownApp.ts';
import { mochiOAuthProviders } from '../library/oauthApps.ts';
import { RELAY_URL } from '@mochi/core/remote/relayClient';
import { setAutoUpdate, updateItem } from '../library/updates.ts';
import type { Handlers } from './handlers.ts';

export const library = {
  async list(_sender, spaceId) {
    return libraryEntries(await readLibrary(), spaceId);
  },
  async setEnabled(_sender, spaceId, id, isEnabled) {
    return libraryEntries(await updateLibrary((index) => setItemEnabled(index, spaceId, id, isEnabled)), spaceId);
  },
  async remove(_sender, spaceId, id) {
    const item = (await readLibrary()).items.find((i) => i.id === id);
    if (item?.kind === 'connector') await forgetAccount(id);
    await removePlacements(item);
    return libraryEntries(await updateLibrary((index) => removeItem(index, id)), spaceId);
  },
  async importFromAccount(_sender, spaceId, provider, parts, names) {
    const notes = await importFromAccount(spaceId, provider, parts, names);
    return { entries: libraryEntries(await readLibrary(), spaceId), notes };
  },
  async addSkill(_sender, spaceId, files) {
    await addOwnSkill(spaceId, files);
    return libraryEntries(await readLibrary(), spaceId);
  },
  async discoverSkills(_sender, source) {
    const skills = await discoverSkills(source);
    return skills.map(({ name, description, source: from, files, icon, commit }) => ({ name, description, source: from, fileCount: Object.keys(files).length, icon, commit }));
  },
  async skillFiles(_sender, source, name) {
    const skill = (await discoverSkills(source)).find((s) => s.name === name);
    if (!skill) throw new Error(`${name} isn't in ${source}`);
    return skill.files;
  },
  async installSkill(_sender, spaceId, source, name, destination) {
    await installSkill(spaceId, source, name, skillDestination(destination));
    return libraryEntries(await readLibrary(), spaceId);
  },
  async searchSkillsSh(_sender, query) {
    return searchSkillsSh(query);
  },
  async popularSkillsSh() {
    return popularSkillsSh();
  },
  async marketplaces() {
    return marketplaces();
  },
  async addMarketplace(_sender, source) {
    await addMarketplace(source);
    return marketplaces();
  },
  async removeMarketplace(_sender, name) {
    await removeMarketplace(name);
    return marketplaces();
  },
  async marketplaceCatalog(_sender, name) {
    const marketplace = (await marketplaces()).find((m) => m.name === name);
    if (!marketplace) throw new Error(`No marketplace named ${name}`);
    return fetchMarketplace(marketplace.source);
  },
  async installPlugin(_sender, spaceId, marketplace, name) {
    await installPlugin(spaceId, marketplace, name);
    return libraryEntries(await readLibrary(), spaceId);
  },
  async reviewUpload(_sender, file) {
    return reviewUploadedPlugin(file.name, file.bytes);
  },
  async installUpload(_sender, spaceId, file, choice) {
    await installUploadedPlugin(file.name, file.bytes, choice.sha256, choice.targets, choice.profileIds);
    return libraryEntries(await readLibrary(), spaceId);
  },
  async addConnector(sender, spaceId, input, options) {
    const space = spaceId;
    const { inPane, secretFrom, slackTokenFrom, fromSetup } = options ?? {};
    const fields = connectorFields(input);
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
    const { params = {}, fromStep } = options ?? {};
    const { result, captured, params: own } = await runRecipe(await recipeFor(connector), params, playwrightOps(await pageOfView(sender, viewId)), fromStep);
    if (Object.keys(captured).length) captures.set(`${sender.id}/${connector}`, { values: captured, params: own, at: Date.now() });
    return result;
  },
  async updateSetupStep(_sender, connector, stepId, target) {
    return overrideStep(connector, stepId, target);
  },
  async ownAppRedirect() {
    return `${RELAY_URL}/oauth/callback`;
  },
  async signIn(sender, spaceId, id) {
    const account = (await readLibrary()).items.find((i) => i.id === id);
    if (account?.kind !== 'connector') throw new Error('No such connector account');
    await signIn(account, deviceCodeTo(sender));
    return libraryEntries(await readLibrary(), spaceId);
  },
  async update(_sender, spaceId, id, autoUpdate) {
    if (autoUpdate === undefined) await updateItem(id);
    else await setAutoUpdate(id, autoUpdate);
    return libraryEntries(await readLibrary(), spaceId);
  },
  async renameConnector(_sender, spaceId, key, name) {
    await renameConnector(key, name.trim());
    return libraryEntries(await readLibrary(), spaceId);
  },
  async connectorSettings() {
    return (await readLibrary()).connectors ?? {};
  },
  async listConnectorTools(_sender, key) {
    return listConnectorTools(key);
  },
  async setConnectorSettings(_sender, key, settings) {
    const chosen = { ...(settings.isOff === true && { isOff: true }), tools: settings.tools ?? {} };
    const index = await updateLibrary((current) => withSettings(current, key, ({ toolList }) => ({ ...chosen, ...(toolList && { toolList }) })));
    return index.connectors ?? {};
  },
} satisfies Handlers<LibraryHost>;

/** A device sign-in's code goes to the window that started it, for the dialog to show. */
const deviceCodeTo = (sender: WebContents) => (code: DeviceCode) => !sender.isDestroyed() && sender.send('library:onDeviceCode', code);

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

type ConnectorAccountInput = Parameters<LibraryHost['addConnector']>[1];

/** Empty optional fields count as unset. */
function connectorFields(input: ConnectorAccountInput) {
  const optional = (value?: string) => value || undefined;
  return { url: input.url, alias: input.alias, name: optional(input.name)?.slice(0, 64), apiKey: optional(input.apiKey), clientId: optional(input.clientId), clientSecret: optional(input.clientSecret) };
}

// GAP: a project path is checked to be an existing folder, not that it is one of the profile's projects.
function skillDestination(input: SkillDestination | undefined): SkillDestination | undefined {
  if (!input || input.scope === 'library') return input;
  const providers = [...new Set(input.providers)];
  if (input.scope === 'user') return { scope: 'user', providers };
  if (!statSync(input.project, { throwIfNoEntry: false })?.isDirectory()) throw new TypeError('destination.project must be a project folder');
  return { scope: 'project', providers, project: input.project };
}
