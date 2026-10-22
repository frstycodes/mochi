import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { GOOGLE_WORKSPACE_PORT, GOOGLE_WORKSPACE_URL, isSameServer } from '../../src/library/connectors.ts';
import { userPath } from '@mochi/core/shellPath';
import { readSecrets, saveSecrets } from './connectors.ts';
import { mochiOAuthApp } from './oauthApps.ts';

/**
 * The Google Workspace connector is workspace-mcp (github.com/taylorwilsdon/google_workspace_mcp, MIT) run by Mochi on
 * this machine: Google's own Gmail, Calendar and Drive MCP servers only serve projects in its Developer Preview. It calls
 * the GA APIs with Mochi's Google OAuth app and is an OAuth 2.1 server of its own (dynamic registration, PKCE), so its
 * accounts sign in like any other connector's. Started on first use and kept for the app's run, on a fixed port: its
 * issuer and stored registrations carry the URL. The packaged app ships `uv`, which fetches Python and the pinned package
 * into userData on first start (network needed once).
 * GAP: Google refresh tokens sit in its credentials directory as plain files, not the keychain.
 * GAP: Windows builds don't ship uv yet (scripts/build-native.mjs).
 */
export function ensureLocalServer(serverUrl: string): Promise<void> {
  if (!isSameServer(serverUrl, GOOGLE_WORKSPACE_URL)) return Promise.resolve();
  starting ??= start().catch((error: unknown) => {
    starting = undefined;
    throw error;
  });
  return starting;
}

const PACKAGE = 'workspace-mcp==2.1.0';
// Pinned so every machine gets the same uv-managed Python rather than whichever is on PATH; google-api-core drops 3.10.
const PYTHON = '3.12';
// First start downloads Python and ~95 packages (about 20s and 150 MB on a fast connection).
const START_TIMEOUT_MS = 5 * 60_000;

let starting: Promise<void> | undefined;
let child: ChildProcess | undefined;

app.on('will-quit', () => child?.kill());

async function start() {
  if (await isUp()) return;
  const google = await googleClient();
  if (!google?.client_secret) throw new Error('Google Workspace needs a Google Cloud client: connect it with your own app.');
  const home = path.join(app.getPath('userData'), 'google-workspace');
  await mkdir(path.join(home, 'logs'), { recursive: true });
  const log = createWriteStream(path.join(home, 'logs', 'workspace-mcp.log'), { flags: 'a' });
  child = spawn(uvBinary(), ['tool', 'run', '--python', PYTHON, '--from', PACKAGE, 'workspace-mcp', '--transport', 'streamable-http', '--tools', 'gmail', 'drive', 'calendar'], {
    env: {
      PATH: await userPath(),
      HOME: process.env.HOME,
      UV_CACHE_DIR: path.join(home, 'uv-cache'),
      UV_PYTHON_INSTALL_DIR: path.join(home, 'python'),
      UV_TOOL_DIR: path.join(home, 'uv-tools'),
      GOOGLE_OAUTH_CLIENT_ID: google.client_id,
      GOOGLE_OAUTH_CLIENT_SECRET: google.client_secret,
      MCP_ENABLE_OAUTH21: 'true',
      WORKSPACE_MCP_HOST: '127.0.0.1',
      WORKSPACE_MCP_PORT: String(GOOGLE_WORKSPACE_PORT),
      WORKSPACE_MCP_BRAND_NAME: 'Mochi',
      WORKSPACE_MCP_CREDENTIALS_DIR: path.join(home, 'credentials'),
      // Registrations and tokens it issues survive restarts only on disk; the default store is memory.
      WORKSPACE_MCP_OAUTH_PROXY_STORAGE_BACKEND: 'disk',
      FASTMCP_HOME: home,
      FASTMCP_SERVER_AUTH_GOOGLE_JWT_SIGNING_KEY: await signingKey(home),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  const exited = new Promise<never>((_, reject) => child!.once('exit', (code) => reject(new Error(`Google Workspace stopped while starting (exit ${code}); see ${path.join(home, 'logs')}`))));
  child.once('exit', () => {
    child = undefined;
    starting = undefined;
  });
  await Promise.race([waitUntilUp(), exited]);
}

/** A Desktop client from the user's own Google Cloud project, saved once for every Google account; else Mochi's, when the build has one. */
async function googleClient() {
  return (await readSecrets(OWN_CLIENT)).clientInformation ?? mochiOAuthApp('google');
}

export async function hasGoogleClient() {
  return !!(await googleClient())?.client_secret;
}

/**
 * Saves the user's own Google client and stops the server, so the next sign-in starts it on that client.
 * GAP: accounts signed in through the previous client sign in again; a server left running by an earlier Mochi run isn't ours to stop.
 */
export async function saveGoogleClient(clientId: string, clientSecret: string) {
  await saveSecrets(OWN_CLIENT, { clientInformation: { client_id: clientId, client_secret: clientSecret }, isOwnClient: true });
  starting = undefined;
  const running = child;
  if (!running) return;
  const exited = new Promise((resolve) => running.once('exit', resolve));
  running.kill();
  await exited;
}

const OWN_CLIENT = 'app:google';

/** The packaged app's uv (electron-builder `extraResources`), else the one on the user's PATH in development. */
function uvBinary() {
  return app.isPackaged ? path.join(process.resourcesPath, process.platform === 'win32' ? 'uv.exe' : 'uv') : 'uv';
}

/** Per install, so the tokens it issues are only good here; derived from the client secret otherwise, which every copy of Mochi shares. */
async function signingKey(home: string) {
  const file = path.join(home, 'signing-key');
  const existing = await readFile(file, 'utf8').catch(() => '');
  if (existing) return existing;
  const key = randomBytes(32).toString('hex');
  await writeFile(file, key, { mode: 0o600 });
  return key;
}

async function waitUntilUp() {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isUp()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Google Workspace took too long to start');
}

async function isUp() {
  const res = await fetch(new URL('/.well-known/oauth-authorization-server', GOOGLE_WORKSPACE_URL)).catch(() => undefined);
  return !!res?.ok;
}
