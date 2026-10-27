import { app } from 'electron';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  DEV_TOOL_TABLE,
  MOCHI_TIMEOUT_MS,
  type MochiScope,
} from '@mochi/domain/runtime/toolTable';
import {
  historyTool,
  instructionsFor,
  mochiServer,
  toolsFor,
  type ServedTool,
} from '@mochi/core/agents/mochiTools';
import { mainCoreClient } from '@mochi/core/host';
import { makeHostCaller } from '@mochi/core/hostClient';
import { mainWindow } from '../window.ts';
import { toolCalls } from './calls.ts';

// The tool definitions and the MCP server are Core's (packages/core/src/agents/mochiTools.ts); main relays each call to its window.
/** Codex: a streamable-HTTP URL on localhost for its `mcp_servers` config, one path per thread behind a per-launch secret. */
export async function codexUrl(
  thread: string,
  { isGoalsOff, isSettingsChat, isSpineOff }: MochiScope = {},
) {
  const { port } = (await listening()).address() as AddressInfo;
  const query = new URLSearchParams({
    ...(isGoalsOff && { goals: 'off' }),
    ...(isSettingsChat && { kind: 'settings' }),
    ...(isSpineOff && { spine: 'off' }),
  }).toString();
  return `http://127.0.0.1:${port}/mcp/${SECRET}/${thread}${query && `?${query}`}`;
}

/**
 * Another route on this loopback server. A private one lives under `/mcp/<secret>/<name>/…` and refuses browser pages,
 * like Codex's; a public one (an OAuth callback the browser lands on) is `/<name>`. `rest` is the path after the name.
 */
export function addLoopbackRoute(
  name: string,
  handle: (
    req: IncomingMessage,
    res: ServerResponse,
    rest: string[],
  ) => Promise<void>,
  isPublic = false,
) {
  routes.set(name, { handle, isPublic });
}

/** The URL of a route added with `addLoopbackRoute`. */
export async function loopbackUrl(name: string, ...rest: string[]) {
  const { port } = (await listening()).address() as AddressInfo;
  const route = routes.get(name);
  return `http://127.0.0.1:${port}${route?.isPublic ? '' : `/mcp/${SECRET}`}/${[name, ...rest].join('/')}`;
}

const routes = new Map<
  string,
  {
    handle: (
      req: IncomingMessage,
      res: ServerResponse,
      rest: string[],
    ) => Promise<void>;
    isPublic: boolean;
  }
>();

const SECRET = randomBytes(24).toString('hex');

/** Codex's PreToolUse hook (packages/core/src/agents/codex/killGuard.ts) POSTs its input here; a pattern kill gets a deny back. */
export const killGuardUrl = () => loopbackUrl(HOOKS, 'kill-guard');

const HOOKS = 'codex-hooks';

addLoopbackRoute(HOOKS, async (req, res, [hook]) => {
  if (req.method !== 'POST' || hook !== 'kill-guard')
    return void res.writeHead(404).end();
  let body = '';
  for await (const chunk of req) body += chunk;
  // Core decides, with the same rules and process registry as Claude's hook.
  const answer = await makeHostCaller(await mainCoreClient())('agentKillHook', {
    input: JSON.parse(body),
  });
  res
    .writeHead(200, { 'Content-Type': 'application/json' })
    .end(answer ? JSON.stringify(answer) : '');
});

function isSecret(value: string | undefined) {
  const given = Buffer.from(value ?? '');
  return (
    given.length === SECRET.length &&
    timingSafeEqual(given, Buffer.from(SECRET))
  );
}

const calls = toolCalls(MOCHI_TIMEOUT_MS);
let http: Promise<Server> | undefined;

/** The renderer's answer to a call from `callMochi`. */
export const resolveToolCall = calls.resolve;

/** The calls a window reload took from `renderer`'s page, for the reloaded page to run again. */
export const undeliveredToolCalls = calls.undelivered;

/** One Mochi tool call, run by the window's renderer; Core's Claude sessions reach it through main's `main` capability. */
export async function callMochi(
  thread: string,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const win = mainWindow();
  if (!win)
    return {
      content: [{ type: 'text', text: 'Mochi has no window open' }],
      isError: true,
    };
  const result = await calls.call(win.webContents, {
    threadId: thread,
    name,
    args,
  });
  const image = result.image
    ? [
        {
          type: 'image' as const,
          data: result.image.data,
          mimeType: result.image.mimeType,
        },
      ]
    : [];
  return {
    content: [{ type: 'text', text: result.text }, ...image],
    isError: result.isError,
  };
}

/** Codex's `thread_history`: Core answers it from its log. */
const coreThreadHistory = async (threadId: string, args: unknown) =>
  (await makeHostCaller(await mainCoreClient())('agentThreadHistory', {
    threadId,
    args,
  })) as CallToolResult;

function listening() {
  http ??= new Promise((resolve, reject) => {
    // Stateless: each POST gets a fresh server and transport, so nothing is kept between Codex's calls.
    const server = createServer(async (req, res) => {
      if (await routed(req, res)) return;
      const match = req.url?.match(/^\/mcp\/(\w+)\/([\w-]+)(?:\?([\w=&]*))?$/);
      if (!match || !isSecret(match[1])) return void res.writeHead(404).end();
      // Codex sends no Origin; a browser page always does, so this keeps web pages off the port even if they learn the URL.
      if (req.headers.origin !== undefined)
        return void res.writeHead(403).end();
      const query = new URLSearchParams(match[3]);
      const scope: MochiScope = {
        isGoalsOff: query.get('goals') === 'off',
        isSettingsChat: query.get('kind') === 'settings',
        isSpineOff: query.get('spine') === 'off',
      };
      const isDev =
        !app.isPackaged &&
        process.env.MOCHI_DEV_MCP === '1' &&
        match[2] === '__dev__';
      const mcp = isDev
        ? mochiServer(DEV_INSTRUCTIONS, devTools())
        : mochiServer(instructionsFor(scope), [
            ...toolsFor(scope).map((t) => ({
              ...t,
              call: (args: Record<string, unknown>) =>
                callMochi(match[2], t.name, args),
            })),
            ...(scope.isSettingsChat
              ? []
              : [historyTool(match[2], coreThreadHistory)]),
          ]);
      const transport = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => void transport.close().then(() => mcp.close()));
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
  return http;
}

async function routed(req: IncomingMessage, res: ServerResponse) {
  const [path] = (req.url ?? '').split('?');
  const parts = path.split('/').filter(Boolean);
  const isPrivate =
    parts[0] === 'mcp' && isSecret(parts[1]) && parts.length > 3;
  const [name, ...rest] = isPrivate ? parts.slice(2) : parts;
  const route = routes.get(name);
  if (!route || route.isPublic === isPrivate) return false;
  if (isPrivate && req.headers.origin !== undefined) {
    res.writeHead(403).end();
    return true;
  }
  await route.handle(req, res, rest).catch((error: Error) => {
    if (!res.headersSent) res.writeHead(500).end(error.message);
  });
  return true;
}

/** Explicit opt-in: a per-launch URL readable only by the local user, never a LAN listener. */
export async function startDevMcp() {
  if (app.isPackaged || process.env.MOCHI_DEV_MCP !== '1') return;
  const url = await codexUrl('__dev__');
  const file = resolve(app.getPath('userData'), 'dev-mcp.json');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ url, pid: process.pid }, null, 2), {
    mode: 0o600,
  });
  app.once('will-quit', () => {
    void rm(file, { force: true });
  });
  console.info(`Dev MCP connection written to ${file}`);
}

const DEV_INSTRUCTIONS =
  'This is an opted-in Mochi dev build. Start test tasks, inspect their progress and transcript, and continue them to reproduce issues. These are real agents using the selected profile account. Never mark a criterion verified on the agent’s word.';

const devTools = () =>
  Object.entries(DEV_TOOL_TABLE).map(([name, t]): ServedTool => ({
    name,
    ...t,
    call: (args) => callMochi('__dev__', name, args),
  }));
