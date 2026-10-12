import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { STEP_STATUSES, type AgentToolResult } from '../../src/host/types/agent.ts';
import { mainWindow } from '../window.ts';

/**
 * Mochi's own tools for the agent in a thread. Each call goes to the renderer, which runs it as the store action the UI
 * dispatches for the same change (`src/runtime/tools.ts`), so the thread view updates as if you had done it.
 */
export const SERVER = 'mochi';

const threadId = z.string().optional().describe('Another thread in this profile; defaults to your own thread');

const TOOLS = [
  { name: 'get_goal', description: "Read a thread's goal and its steps, with each step's id and status.", shape: { threadId } },
  {
    name: 'set_step_status',
    description: "Set a goal step's status. Mark steps running when you start them and done when finished, so the user sees progress.",
    shape: { stepId: z.string(), status: z.enum(STEP_STATUSES), threadId },
  },
  { name: 'add_step', description: "Add a step to a thread's goal, as a new goal revision.", shape: { title: z.string(), size: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().describe('1 small, 2 medium, 3 large'), threadId } },
  { name: 'list_threads', description: 'List the threads in this profile.', shape: {} },
  {
    name: 'create_thread',
    description: 'Start a new thread in the same project, with its own agent working on `prompt`. The user stays on the view they are on.',
    shape: { prompt: z.string(), provider: z.enum(['claude', 'codex']).optional().describe("Defaults to this thread's agent") },
  },
] as const;

/** Read-only and goal-bookkeeping tools run without an approval card; `create_thread` starts an agent, so it asks. */
export const AUTO_ALLOWED = ['get_goal', 'set_step_status', 'add_step', 'list_threads'].map((name) => `mcp__${SERVER}__${name}`);

/** Claude: an in-process server per session, bound to its thread. A server instance serves one connection. */
export function claudeServer(thread: string) {
  return createSdkMcpServer({ name: SERVER, tools: TOOLS.map((t) => tool(t.name, t.description, t.shape, (args) => callMochi(thread, t.name, args))) });
}

/** Codex: a streamable-HTTP URL on localhost for its `mcp_servers` config, one path per thread behind a per-launch secret. */
export async function codexUrl(thread: string) {
  const { port } = (await listening()).address() as AddressInfo;
  return `http://127.0.0.1:${port}/mcp/${SECRET}/${thread}`;
}

const SECRET = randomBytes(24).toString('hex');
const TOOL_TIMEOUT_MS = 30_000;
let nextId = 0;
const pending = new Map<string, (result: AgentToolResult) => void>();
let http: Promise<Server> | undefined;

/** The renderer's answer to a call from `callMochi`. */
export function resolveToolCall(id: string, result: AgentToolResult) {
  pending.get(id)?.(result);
  pending.delete(id);
}

async function callMochi(thread: string, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const win = mainWindow();
  if (!win) return { content: [{ type: 'text', text: 'Mochi has no window open' }], isError: true };
  const id = `tool-${++nextId}`;
  const result = await new Promise<AgentToolResult>((resolve) => {
    pending.set(id, resolve);
    win.webContents.send('agent:onToolCall', { id, threadId: thread, name, args });
    setTimeout(() => resolveToolCall(id, { text: 'Mochi did not answer in time', isError: true }), TOOL_TIMEOUT_MS);
  });
  return { content: [{ type: 'text', text: result.text }], isError: result.isError };
}

function listening() {
  http ??= new Promise((resolve, reject) => {
    // Stateless: each POST gets a fresh server and transport, so nothing is kept between Codex's calls.
    const server = createServer(async (req, res) => {
      const match = req.url?.match(/^\/mcp\/(\w+)\/([\w-]+)$/);
      if (!match || match[1] !== SECRET) return void res.writeHead(404).end();
      const mcp = new McpServer({ name: SERVER, version: '1.0.0' });
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
