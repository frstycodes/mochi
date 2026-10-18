import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { MOCHI_SERVER, MOCHI_TIMEOUT_MS, TOOL_NAMES, TOOL_TABLE, type ToolName } from '../../src/runtime/toolTable.ts';
import { mainWindow } from '../window.ts';
import { toolCalls } from './calls.ts';

/**
 * Mochi's own tools for the agent in a thread. Each call goes to the renderer, which runs it as the store action the UI
 * dispatches for the same change (`src/runtime/tools.ts`), so the thread view updates as if you had done it.
 */
export const SERVER = MOCHI_SERVER;

const TOOLS = TOOL_NAMES.map((name) => ({ name, ...TOOL_TABLE[name] }));

/** Shown to the model as the server's instructions (MCP `initialize`); the same for every thread, so it reads its own goal. */
export const INSTRUCTIONS =
  "Mochi runs this thread and shows the user its goal. Call get_goal at the start of a task. A question or chat has no goal: then ignore the rest. A task starts with Mochi's draft goal (get_goal says isDraft): after your first look at the code, call propose_goal once with the concrete outcome and checkable criteria, before claiming or reporting anything. With a goal: keep your plan current in your own task tools; call claim_criterion with one line of evidence as soon as each criterion is met; at the end of a turn where you changed anything, call report_turn once (decisions, what's left, at most one question for the user).";

/** Mochi asks with its own widget for deletes and settings (`src/runtime/tools.ts`), so the harness never asks too. */
export const AUTO_ALLOWED = TOOL_NAMES.map((name) => `mcp__${SERVER}__${name}`);

/** Claude: an in-process server per session, bound to its thread. A server instance serves one connection. */
export function claudeServer(thread: string) {
  return createSdkMcpServer({ name: SERVER, instructions: INSTRUCTIONS, tools: TOOLS.map((t) => tool(t.name, t.description, t.shape, (args) => callMochi(thread, t.name, args))) });
}

/** Codex: a streamable-HTTP URL on localhost for its `mcp_servers` config, one path per thread behind a per-launch secret. */
export async function codexUrl(thread: string) {
  const { port } = (await listening()).address() as AddressInfo;
  return `http://127.0.0.1:${port}/mcp/${SECRET}/${thread}`;
}

/**
 * Another route on this loopback server. A private one lives under `/mcp/<secret>/<name>/…` and refuses browser pages,
 * like Codex's; a public one (an OAuth callback the browser lands on) is `/<name>`. `rest` is the path after the name.
 */
export function addLoopbackRoute(name: string, handle: (req: IncomingMessage, res: ServerResponse, rest: string[]) => Promise<void>, isPublic = false) {
  routes.set(name, { handle, isPublic });
}

/** The URL of a route added with `addLoopbackRoute`. */
export async function loopbackUrl(name: string, ...rest: string[]) {
  const { port } = (await listening()).address() as AddressInfo;
  const route = routes.get(name);
  return `http://127.0.0.1:${port}${route?.isPublic ? '' : `/mcp/${SECRET}`}/${[name, ...rest].join('/')}`;
}

const routes = new Map<string, { handle: (req: IncomingMessage, res: ServerResponse, rest: string[]) => Promise<void>; isPublic: boolean }>();

const SECRET = randomBytes(24).toString('hex');
const calls = toolCalls(MOCHI_TIMEOUT_MS);
let http: Promise<Server> | undefined;

/** The renderer's answer to a call from `callMochi`. */
export const resolveToolCall = calls.resolve;

/** The calls a window reload took from `renderer`'s page, for the reloaded page to run again. */
export const undeliveredToolCalls = calls.undelivered;

async function callMochi(thread: string, name: ToolName, args: Record<string, unknown>): Promise<CallToolResult> {
  const win = mainWindow();
  if (!win) return { content: [{ type: 'text', text: 'Mochi has no window open' }], isError: true };
  const result = await calls.call(win.webContents, { threadId: thread, name, args });
  const image = result.image ? [{ type: 'image' as const, data: result.image.data, mimeType: result.image.mimeType }] : [];
  return { content: [{ type: 'text', text: result.text }, ...image], isError: result.isError };
}

function listening() {
  http ??= new Promise((resolve, reject) => {
    // Stateless: each POST gets a fresh server and transport, so nothing is kept between Codex's calls.
    const server = createServer(async (req, res) => {
      if (await routed(req, res)) return;
      const match = req.url?.match(/^\/mcp\/(\w+)\/([\w-]+)$/);
      if (!match || match[1] !== SECRET) return void res.writeHead(404).end();
      // Codex sends no Origin; a browser page always does, so this keeps web pages off the port even if they learn the URL.
      if (req.headers.origin !== undefined) return void res.writeHead(403).end();
      const mcp = new McpServer({ name: SERVER, version: '1.0.0' }, { instructions: INSTRUCTIONS });
      for (const t of TOOLS) mcp.registerTool(t.name, { description: t.description, inputSchema: t.shape }, (args: Record<string, unknown>) => callMochi(match[2], t.name, args));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
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
  const isPrivate = parts[0] === 'mcp' && parts[1] === SECRET && parts.length > 3;
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
