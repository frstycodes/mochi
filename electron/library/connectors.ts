import { app, safeStorage, shell } from 'electron';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { auth, discoverOAuthProtectedResourceMetadata, discoverOAuthServerInfo, UnauthorizedError, type OAuthClientProvider, type OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { connectorKey, GOOGLE_WORKSPACE_URL, isSameServer, OAUTH_PROVIDERS, oauthProviderFor, relayState, type DeviceCode, type OAuthProviderId } from '../../src/library/connectors.ts';
import { RELAY_URL } from '../remote/relayClient.ts';
import { mochiOAuthApp } from './oauthApps.ts';
import { ensureLocalServer, saveGoogleClient } from './googleWorkspace.ts';
import { connectorName, toolRules, type ConnectorSettings, type ConnectorToolList, type ToolRules } from '../../src/library/connectorTools.ts';
import { profileConnectors, type LibraryConnector, type LibraryIndex } from '../../src/library/library.ts';
import { addLoopbackRoute, loopbackUrl } from '../mcp/server.ts';
import { identityOf } from './identity.ts';
import { allTools, connectorServer } from './proxy.ts';
import { readLibrary, updateLibrary } from './store.ts';

/**
 * Connector accounts (LIBRARY.md Phase 1b): sign-in, tokens, and the proxy route sessions reach them through. Tokens and
 * keys are sealed with `safeStorage` in userData/connector-secrets.json, apart from the index, and never leave main.
 */
interface Secrets {
  apiKey?: string;
  tokens?: OAuthTokens;
  clientInformation?: OAuthClientInformationMixed;
  /** An OAuth app the user brought (for servers that can't register one); kept when the redirect port changes. */
  isOwnClient?: boolean;
  /** The redirect a registered client was made for; the loopback port changes per launch, so a new one re-registers. */
  registeredFor?: string;
  codeVerifier?: string;
  discoveryState?: OAuthDiscoveryState;
}

const secretsFile = () => join(app.getPath('userData'), 'connector-secrets.json');
let writes = Promise.resolve();

async function readAll(): Promise<Record<string, string>> {
  return readFile(secretsFile(), 'utf8').then((text) => JSON.parse(text) as Record<string, string>, () => ({}));
}

export async function readSecrets(id: string): Promise<Secrets> {
  const sealed = (await readAll())[id];
  if (!sealed || !safeStorage.isEncryptionAvailable()) return {};
  return JSON.parse(safeStorage.decryptString(Buffer.from(sealed, 'base64'))) as Secrets;
}

/** Merges `patch` into the account's secrets; `null` deletes them. Writes go one at a time. */
export function saveSecrets(id: string, patch: Partial<Secrets> | null): Promise<void> {
  const next = writes.then(async () => {
    if (patch && !safeStorage.isEncryptionAvailable()) throw new Error('The OS keychain is not available, so sign-ins cannot be stored safely');
    const all = await readAll();
    if (patch === null) delete all[id];
    else all[id] = safeStorage.encryptString(JSON.stringify({ ...(await readSecrets(id)), ...patch })).toString('base64');
    const tmp = `${secretsFile()}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(all), { mode: 0o600 });
    await rename(tmp, secretsFile());
  });
  writes = next.catch(() => {});
  return next;
}

type OpenPage = (url: string) => Promise<unknown>;

export interface NewConnectorAccount {
  url: string;
  alias: string;
  /** The connector's name; left out, accounts already on it keep theirs, else the directory's or the host. */
  name?: string;
  apiKey?: string;
  clientId?: string;
  clientSecret?: string;
}

/** Adds the account, turned on for the profile and not yet signed in; its key or OAuth app are sealed first. */
export async function addConnectorAccount(spaceId: string, input: NewConnectorAccount): Promise<LibraryConnector> {
  const key = connectorKey(input.url);
  const index = await readLibrary();
  if (index.items.some((item) => item.kind === 'connector' && item.key === key && item.alias === input.alias)) throw new Error(`There is already a ${input.alias} account on ${key}`);
  const sibling = index.items.find((item): item is LibraryConnector => item.kind === 'connector' && item.key === key);
  const title = input.name?.trim() || sibling?.title || connectorName(input.url);
  const account: LibraryConnector = { kind: 'connector', id: randomUUID(), key, title, url: input.url, alias: input.alias, isLinked: false, targets: ['claude', 'codex'], addedAt: Date.now() };
  if (input.apiKey) await saveApiKey(account.id, input.apiKey);
  // Google Workspace's accounts register with the local server; a client brought for it is the server's, for every account.
  const isGoogle = isSameServer(input.url, GOOGLE_WORKSPACE_URL);
  if (input.clientId && isGoogle && !input.clientSecret) throw new Error('A Google client needs its secret too');
  if (input.clientId && isGoogle) await saveGoogleClient(input.clientId, input.clientSecret!);
  else if (input.clientId) await saveOwnClient(account.id, input.clientId, input.clientSecret);
  await updateLibrary((current) => ({ ...current, items: [...current.items, account], profiles: { ...current.profiles, [spaceId]: [...(current.profiles[spaceId] ?? []), account.id] } }));
  return account;
}

/**
 * Signs the account in: its key, else OAuth in the browser, else a server that needs neither. Marks it linked. `open`
 * shows the sign-in page: the user's browser, or for an agent's connect the agent's own tab, where it clicks Allow.
 */
export async function signIn(account: LibraryConnector, onDeviceCode: (code: DeviceCode) => void = () => {}, open: OpenPage = (url) => shell.openExternal(url)) {
  forget(account.id);
  await ensureLocalServer(account.url);
  const secrets = await readSecrets(account.id);
  const oauthProvider = oauthProviderFor(account.url);
  const usesMochiApp = !!oauthProvider && !secrets.apiKey && !secrets.isOwnClient;
  if (usesMochiApp && !mochiOAuthApp(oauthProvider))
    throw new Error(`${OAUTH_PROVIDERS[oauthProvider].name} doesn’t let apps register themselves, and this build of Mochi has no ${OAUTH_PROVIDERS[oauthProvider].name} app yet. Connect it with an API key or your own OAuth app.`);
  if (usesMochiApp && OAUTH_PROVIDERS[oauthProvider].flow === 'device') {
    await deviceSignIn(account, mochiOAuthApp(oauthProvider)!.client_id, onDeviceCode, open);
    const info = await probe(account, new AccountAuth(account, await loopbackUrl(CALLBACK)));
    await setLinked(account.id, true);
    return info;
  }
  const { redirectUrl, port } = await redirectFor(oauthProvider);
  if (secrets.clientInformation && !secrets.isOwnClient && secrets.registeredFor !== redirectUrl) await saveSecrets(account.id, { clientInformation: undefined });
  const provider = new AccountAuth(account, redirectUrl, oauthProvider && OAUTH_PROVIDERS[oauthProvider].redirect === 'relay' ? port : undefined);
  // Some servers (Google's) answer the handshake without a token and only refuse tool calls, so an account with no token
  // signs in up front whenever its server publishes OAuth metadata.
  const metadata = !secrets.apiKey && !secrets.tokens ? await discoverOAuthProtectedResourceMetadata(account.url).catch(() => undefined) : undefined;
  if (metadata?.authorization_servers?.length && (await auth(provider, { serverUrl: account.url })) === 'REDIRECT') await finish(provider, account, open);
  let info: ServerInfo;
  try {
    info = await probe(account, provider);
  } catch (error) {
    if (!(error instanceof UnauthorizedError) || !provider.authorizationUrl) throw error;
    await finish(provider, account, open);
    info = await probe(account, provider);
  }
  await setLinked(account.id, true);
  return info;
}

type ServerInfo = { name?: string; title?: string } | undefined;

/** Connects once to check the sign-in, and returns what the server calls itself. */
async function probe(account: LibraryConnector, provider: AccountAuth): Promise<ServerInfo> {
  const client = await connect(account, provider);
  const info = client.getServerVersion();
  await client.close();
  return info;
}

/** A connector added without a name, and not in the directory, takes the name its server gives itself. */
export async function nameFromServer(account: LibraryConnector, info: ServerInfo) {
  if (account.title !== connectorName(account.url)) return;
  const name = connectorName(account.url, undefined, info);
  if (name !== account.title) await renameConnector(account.key, name);
}

/** Every account on the connector takes the name; the key (and so every permission rule) stays. */
export function renameConnector(key: string, name: string) {
  return updateLibrary((index) => ({ ...index, items: index.items.map((item) => (item.kind === 'connector' && item.key === key ? { ...item, title: name } : item)) }));
}

/**
 * RFC 8628: the provider shows a one-time code page, you enter the code `onCode` hands the dialog, and Mochi polls the
 * token endpoint until you approve. No redirect and no client secret. Endpoints and scopes come from the server's
 * metadata. GAP: closing the dialog doesn't stop the polling; it ends when the code expires.
 */
async function deviceSignIn(account: LibraryConnector, clientId: string, onCode: (code: DeviceCode) => void, open: OpenPage) {
  const { authorizationServerMetadata: server, resourceMetadata } = await discoverOAuthServerInfo(account.url);
  const deviceEndpoint = (server as { device_authorization_endpoint?: string } | undefined)?.device_authorization_endpoint;
  if (!server || !deviceEndpoint) throw new Error(`${account.title} doesn’t offer sign-in with a code`);
  const scope = resourceMetadata?.scopes_supported?.join(' ');
  const start = (await postForm(deviceEndpoint, { client_id: clientId, ...(scope && { scope }) })) as DeviceStart;
  if (!start.device_code) throw new Error(start.error_description ?? start.error ?? `${account.title} gave no sign-in code`);
  onCode({ url: account.url, userCode: start.user_code, verificationUri: start.verification_uri });
  await open(start.verification_uri_complete ?? start.verification_uri);
  let interval = (start.interval ?? 5) * 1000;
  const deadline = Date.now() + (start.expires_in ?? 900) * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    const answer = (await postForm(server.token_endpoint, { client_id: clientId, device_code: start.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' })) as DeviceAnswer;
    if (answer.access_token) {
      const { access_token, token_type = 'bearer', refresh_token, expires_in, scope: granted } = answer;
      return saveSecrets(account.id, { tokens: { access_token, token_type, ...(refresh_token && { refresh_token }), ...(expires_in && { expires_in }), ...(granted && { scope: granted }) } });
    }
    if (answer.error === 'authorization_pending') continue;
    if (answer.error === 'slow_down') {
      interval += 5000;
      continue;
    }
    throw new Error(answer.error === 'access_denied' ? 'Sign-in was declined.' : answer.error === 'expired_token' ? 'The code expired. Try again.' : (answer.error_description ?? answer.error ?? 'Sign-in failed.'));
  }
  throw new Error('The code expired. Try again.');
}

type DeviceStart = { device_code: string; user_code: string; verification_uri: string; verification_uri_complete?: string; interval?: number; expires_in?: number; error?: string; error_description?: string };
type DeviceAnswer = { access_token?: string; token_type?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };

async function postForm(url: string, body: Record<string, string>) {
  const res = await fetch(url, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  return res.json() as Promise<unknown>;
}

/** Mochi's loopback callback, or for a provider that only takes https redirects the relay's bounce, whoever's app it is. */
async function redirectFor(provider: OAuthProviderId | undefined) {
  const loopback = await loopbackUrl(CALLBACK);
  const port = Number(new URL(loopback).port);
  const isRelayed = !!provider && OAUTH_PROVIDERS[provider].redirect === 'relay';
  return { redirectUrl: isRelayed ? `${RELAY_URL}/oauth/callback` : loopback, port };
}

/** Opens the sign-in page and waits for the browser to land on the callback with a code. */
async function finish(provider: AccountAuth, account: LibraryConnector, open: OpenPage) {
  if (!provider.authorizationUrl || !provider.pendingState) throw new Error(`${account.url} asked for sign-in but gave no sign-in page`);
  const code = waitForCode(provider.pendingState);
  await open(provider.authorizationUrl.toString());
  await auth(provider, { serverUrl: account.url, authorizationCode: await code });
}

/** Asks the service who the account signed in as and keeps it on the account; quiet when the service won't say. */
export async function recordIdentity(account: LibraryConnector) {
  const { apiKey, tokens } = await readSecrets(account.id);
  const token = apiKey ?? tokens?.access_token;
  const identity = token ? await identityOf(account.url, token).catch(() => undefined) : undefined;
  if (!identity) return account;
  await updateLibrary((index) => ({ ...index, items: index.items.map((item) => (item.id === account.id && item.kind === 'connector' ? { ...item, identity } : item)) }));
  return { ...account, identity };
}

export async function setLinked(id: string, isLinked: boolean) {
  await updateLibrary((index) => ({ ...index, items: index.items.map((item) => (item.id === id && item.kind === 'connector' ? { ...item, isLinked } : item)) }));
}

export function forgetAccount(id: string) {
  forget(id);
  return saveSecrets(id, null);
}

export function saveApiKey(id: string, apiKey: string) {
  return saveSecrets(id, { apiKey });
}

export function saveOwnClient(id: string, clientId: string, clientSecret?: string) {
  return saveSecrets(id, { clientInformation: { client_id: clientId, ...(clientSecret && { client_secret: clientSecret }) }, isOwnClient: true });
}

/** The tool permissions per connector the profile reaches, by server name. */
export async function sessionToolRules(spaceId: string): Promise<Record<string, ToolRules>> {
  const index = await readLibrary();
  return Object.fromEntries([...profileConnectors(index, spaceId).keys()].map((key) => [key, toolRules(index.connectors?.[key])]));
}

/** Lists the connector's tools through its first signed-in account, and keeps the listing (or its error) in the index. */
export async function listConnectorTools(key: string): Promise<ConnectorToolList> {
  const account = (await readLibrary()).items.find((item): item is LibraryConnector => item.kind === 'connector' && item.key === key && item.isLinked);
  const toolList = account ? await listTools(account) : { tools: [], listedAt: Date.now(), error: 'No account on it is signed in.' };
  await updateLibrary((index) => withSettings(index, key, (settings) => ({ ...settings, toolList })));
  return toolList;
}

async function listTools(account: LibraryConnector): Promise<ConnectorToolList> {
  try {
    const tools = await allTools(await clientFor(account));
    return {
      tools: tools.map(({ name, title, description, annotations }) => ({ name, title: title ?? annotations?.title ?? null, description: description ?? '', isReadOnly: annotations?.readOnlyHint === true, isDestructive: annotations?.readOnlyHint !== true && annotations?.destructiveHint !== false })),
      listedAt: Date.now(),
      error: null,
    };
  } catch (error) {
    return { tools: [], listedAt: Date.now(), error: error instanceof Error ? error.message : String(error) };
  }
}

export function withSettings(index: LibraryIndex, key: string, change: (settings: ConnectorSettings) => ConnectorSettings): LibraryIndex {
  return { ...index, connectors: { ...index.connectors, [key]: change(index.connectors?.[key] ?? {}) } };
}

/** The proxy URL per connector the profile has a signed-in account on, as `[server name, url]`. */
export async function sessionConnectors(spaceId: string): Promise<[string, string][]> {
  const groups = profileConnectors(await readLibrary(), spaceId);
  return Promise.all([...groups.keys()].map(async (key) => [key, await loopbackUrl(PROXY, spaceId, key)] as [string, string]));
}

// {OAUTH}

const CALLBACK = 'oauth-callback';
const SIGN_IN_TIMEOUT_MS = 10 * 60_000;
const pending = new Map<string, { resolve: (code: string) => void; reject: (error: Error) => void }>();

function waitForCode(state: string) {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(state);
      reject(new Error('Sign-in timed out. Try again.'));
    }, SIGN_IN_TIMEOUT_MS);
    const done = () => {
      clearTimeout(timer);
      pending.delete(state);
    };
    pending.set(state, {
      resolve: (code) => {
        done();
        resolve(code);
      },
      reject: (error) => {
        done();
        reject(error);
      },
    });
  });
}

addLoopbackRoute(
  CALLBACK,
  async (req, res) => {
    const params = new URL(req.url ?? '', 'http://127.0.0.1').searchParams;
    const waiting = pending.get(params.get('state') ?? '');
    const code = params.get('code');
    const error = params.get('error_description') ?? params.get('error');
    if (waiting && code) waiting.resolve(code);
    else waiting?.reject(new Error(error ?? 'The sign-in page returned no code'));
    const message = waiting && code ? 'Signed in. You can close this tab and go back to Mochi.' : `Sign-in didn't finish${error ? `: ${error}` : ''}.`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html><meta charset="utf-8"><title>Mochi</title><p style="font:16px system-ui;margin:3rem">${escapeHtml(message)}</p>`);
  },
  true,
);

class AccountAuth implements OAuthClientProvider {
  authorizationUrl?: URL;
  pendingState?: string;
  readonly redirectUrl: string;
  private account: LibraryConnector;
  /** Set when the sign-in returns through the relay, which reads the loopback port from the state. */
  private relayPort?: number;

  constructor(account: LibraryConnector, redirectUrl: string, relayPort?: number) {
    this.account = account;
    this.redirectUrl = redirectUrl;
    this.relayPort = relayPort;
  }

  get clientMetadata() {
    return { client_name: 'Mochi', redirect_uris: [this.redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
  }

  state() {
    const nonce = randomBytes(16).toString('hex');
    this.pendingState = this.relayPort ? relayState(this.relayPort, nonce) : nonce;
    return this.pendingState;
  }

  // The account's own app, or one it registered itself; else Mochi's app for a provider that can't register any, read
  // fresh so a rotated id in a new build applies without signing in again.
  clientInformation = async () => {
    const own = (await readSecrets(this.account.id)).clientInformation;
    const provider = oauthProviderFor(this.account.url);
    return own ?? (provider ? mochiOAuthApp(provider) : undefined);
  };
  saveClientInformation = (clientInformation: OAuthClientInformationMixed) => saveSecrets(this.account.id, { clientInformation, registeredFor: this.redirectUrl });
  tokens = async () => (await readSecrets(this.account.id)).tokens;
  saveTokens = (tokens: OAuthTokens) => saveSecrets(this.account.id, { tokens, codeVerifier: undefined });
  codeVerifier = async () => (await readSecrets(this.account.id)).codeVerifier ?? '';
  saveCodeVerifier = (codeVerifier: string) => saveSecrets(this.account.id, { codeVerifier });
  discoveryState = async () => (await readSecrets(this.account.id)).discoveryState;
  saveDiscoveryState = (discoveryState: OAuthDiscoveryState) => saveSecrets(this.account.id, { discoveryState });

  redirectToAuthorization(url: URL) {
    const provider = oauthProviderFor(this.account.url);
    const params: Record<string, string> = provider ? OAUTH_PROVIDERS[provider].authorizationParams : {};
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    this.authorizationUrl = url;
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    const cleared = {
      all: { tokens: undefined, clientInformation: undefined, codeVerifier: undefined, discoveryState: undefined },
      client: { clientInformation: undefined },
      tokens: { tokens: undefined },
      verifier: { codeVerifier: undefined },
      discovery: { discoveryState: undefined },
    }[scope];
    await saveSecrets(this.account.id, cleared);
  }
}

// {PROXY}

const PROXY = 'connector';
const clients = new Map<string, Promise<Client>>();

/** One connected client per account, reused across sessions; a failed one is dropped so the next call reconnects. */
function clientFor(account: LibraryConnector) {
  let client = clients.get(account.id);
  if (!client) {
    client = loopbackUrl(CALLBACK).then((redirectUrl) => connect(account, new AccountAuth(account, redirectUrl)));
    clients.set(account.id, client);
    client.catch(async (error) => {
      clients.delete(account.id);
      // A refresh that failed left it wanting the browser: it is signed out until the user signs in again.
      if (error instanceof UnauthorizedError) await setLinked(account.id, false);
    });
  }
  return client;
}

function forget(id: string) {
  void clients.get(id)?.then((c) => c.close(), () => {});
  clients.delete(id);
}

async function connect(account: LibraryConnector, provider: AccountAuth) {
  await ensureLocalServer(account.url);
  const { apiKey } = await readSecrets(account.id);
  const transport = new StreamableHTTPClientTransport(new URL(account.url), apiKey ? { requestInit: { headers: { Authorization: `Bearer ${apiKey}` } } } : { authProvider: provider });
  const client = new Client({ name: 'mochi', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

addLoopbackRoute(PROXY, async (req, res, [spaceId, key]) => {
  const accounts = profileConnectors(await readLibrary(), spaceId ?? '').get(key ?? '');
  if (!accounts?.length) return void res.writeHead(404).end();
  const byAlias = new Map(accounts.map((account) => [account.alias, account]));
  const server = await connectorServer(key!, [...byAlias.keys()], (alias) => clientFor(byAlias.get(alias)!));
  // Stateless, like Mochi's own tools server: each request gets a fresh server over the shared upstream clients.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => void transport.close().then(() => server.close()));
  await server.connect(transport);
  await transport.handleRequest(req, res);
});

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
