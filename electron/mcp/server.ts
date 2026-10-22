import { app } from 'electron';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Schema } from 'effect';
import type { ImageGenHarness } from '../../src/host/types/settings.ts';
import type { GeneratedImage } from '../../src/model.ts';
import { IMAGE_SIZES, IMAGE_TOOL, IMAGE_TOOL_DESCRIPTION, IMAGE_TOOL_SHAPE, imageResultText, type ImageSize } from '../../src/runtime/imageTool.ts';
import { decodeArgs, DEV_TOOL_TABLE, isTurnTool, jsonSchemaOf, MOCHI_SERVER, MOCHI_TIMEOUT_MS, servedTools, TOOL_NAMES, TOOL_TABLE, type MochiScope } from '../../src/runtime/toolTable.ts';
import { agentSettings } from '../agents/config.ts';
import { mainWindow } from '../window.ts';
import { toolCalls } from './calls.ts';

/**
 * Mochi's own tools for the agent in a thread. Each call goes to the renderer, which runs it as the store action the UI
 * dispatches for the same change (`src/runtime/tools.ts`), so the thread view updates as if you had done it.
 */
export const SERVER = MOCHI_SERVER;

const toolsFor = (scope: MochiScope) => servedTools(scope).map((name) => ({ name, ...TOOL_TABLE[name] }));

/** Shown to the model as the server's instructions (MCP `initialize`); the same for every thread, so it reads its own goal. */
const INSTRUCTIONS =
  "Mochi runs this thread and shows the user its goal. Call get_goal at the start. Mochi does not draft a goal from the first prompt: for a task with a checkable outcome, research the code and the user's request, then call propose_goal with the concrete outcome and checkable criteria before finishing the work. A goal is optional: a question, a chat, or a small one-step change needs none. Older threads may have a draft (isDraft): replace it after research. Propose again only if what done means has to change. While a proposal awaits acceptance, keep working and report progress; claim criteria once accepted. With a goal: call claim_criterion with one line of evidence as soon as each criterion is met; at the end of a turn where you changed anything, call report_turn once (what changed in the user's terms, decisions, what's left, at most one question for the user, and, only when the user has a real choice, the next move as one yes/no question). To split a goal, give each independent piece (pieces that touch different files) its own sub-thread with create_thread and that piece's criterionId: initiation user_asked when the user asked for it split, else own_initiative cards they start; a sub-thread works only on its piece and opens its own PR with gh pr create --base set explicitly (usually main, or the branch it was cut from), and its result comes back to the parent.";

/** With goals off (always, now goals are retired), nothing about goals: the main instructions say the rest. */
const NO_GOAL_INSTRUCTIONS = 'Mochi runs this thread and shows the user what its tools do.';

const SETTINGS_CHAT_INSTRUCTIONS = "These tools read and suggest Mochi's own settings. Call get_settings before answering.";

const instructionsFor = ({ isGoalsOff, isSettingsChat }: MochiScope) => (isSettingsChat ? SETTINGS_CHAT_INSTRUCTIONS : isGoalsOff ? NO_GOAL_INSTRUCTIONS : INSTRUCTIONS);

/** Mochi asks with its own widget for deletes and settings (`src/runtime/tools.ts`), so the harness never asks too. */
export const AUTO_ALLOWED = [...TOOL_NAMES, IMAGE_TOOL].map((name) => `mcp__${SERVER}__${name}`);

/**
 * Claude: an in-process server per session, bound to its thread. A server instance serves one connection. `generate_image`
 * is Claude's only (Codex generates natively) and runs here in main, not in the renderer; a session started while it was
 * off in Settings doesn't get it.
 */
export function claudeServer(thread: string, spaceId: string, cwd: string, scope: MochiScope = {}): McpSdkServerConfigWithInstance {
  const tools = toolsFor(scope).map((t): ServedTool => ({ ...t, alwaysLoad: !!scope.isSettingsChat || isTurnTool(t.name), call: (args) => callMochi(thread, t.name, args) }));
  const image: ServedTool = { name: IMAGE_TOOL, description: IMAGE_TOOL_DESCRIPTION, shape: IMAGE_TOOL_SHAPE, call: (args, signal) => generateImage(spaceId, cwd, args as ImageArgs, signal) };
  const isImageOff = scope.isSettingsChat || agentSettings().imageGen === 'off';
  return { type: 'sdk', name: SERVER, instance: mochiServer(instructionsFor(scope), isImageOff ? tools : [...tools, image]) };
}

interface ServedTool {
  name: string;
  description: string;
  shape: Schema.Struct.Fields;
  /** Claude: listed up front, never deferred behind tool search. */
  alwaysLoad?: boolean;
  call: (args: Record<string, unknown>, signal: AbortSignal) => Promise<CallToolResult>;
}

type ImageArgs = { prompt: string; size?: ImageSize; saveTo?: string };

/** An MCP server for `tools`, their inputs listed as JSON Schema and checked against their shapes before `call` runs. */
function mochiServer(instructions: string, tools: ServedTool[]) {
  const mcp = new McpServer({ name: SERVER, version: '1.0.0' }, { instructions, capabilities: { tools: {} } });
  mcp.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: jsonSchemaOf(t.shape), ...(t.alwaysLoad && { _meta: { 'anthropic/alwaysLoad': true } }) })),
  }));
  mcp.server.setRequestHandler(CallToolRequestSchema, async ({ params }, extra): Promise<CallToolResult> => {
    const tool = tools.find((t) => t.name === params.name);
    if (!tool) return { content: [{ type: 'text', text: `No Mochi tool ${params.name}` }], isError: true };
    const decoded = decodeArgs(tool.shape, params.arguments ?? {});
    if ('error' in decoded) return { content: [{ type: 'text', text: `Invalid arguments for ${params.name}: ${decoded.error}` }], isError: true };
    return tool.call(decoded.args as Record<string, unknown>, extra.signal);
  });
  return mcp;
}

type GenerateImage = (spaceId: string, prompt: string, signal: AbortSignal) => Promise<GeneratedImage>;

const generators: Partial<Record<ImageGenHarness, GenerateImage>> = {};

/** Set by `electron/ipc/agent.ts` once the harness's adapter exists. */
export const setImageGenerator = (harness: Exclude<ImageGenHarness, 'off'>, generate: GenerateImage) => void (generators[harness] = generate);

// Claude rejects images over 5 MB; a bigger one is still made and saved, Claude just gets its path.
const MAX_RETURNED_BYTES = 5 * 1024 * 1024;
const MIME_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

async function generateImage(spaceId: string, cwd: string, args: { prompt: string; size?: ImageSize; saveTo?: string }, signal: AbortSignal): Promise<CallToolResult> {
  const failed = (text: string): CallToolResult => ({ content: [{ type: 'text', text }], isError: true });
  const harness = agentSettings().imageGen;
  const generate = harness !== 'off' && generators[harness];
  if (!generate) return failed('Image generation is off in Mochi’s Settings › Models.');
  const target = args.saveTo ? resolve(cwd, args.saveTo) : undefined;
  if (target && (relative(cwd, target).startsWith('..') || isAbsolute(relative(cwd, target)))) return failed('saveTo must be a path inside your worktree.');
  try {
    const image = await generate(spaceId, `${args.prompt}\n\nMake it ${IMAGE_SIZES[args.size ?? 'square'].ask}.`, signal);
    if (image.status !== 'done' || !image.src) return failed(image.error ?? 'The image wasn’t generated.');
    if (target) await mkdir(dirname(target), { recursive: true }).then(() => copyFile(image.src!, target));
    const bytes = await readFile(image.src);
    const returned = bytes.length <= MAX_RETURNED_BYTES ? [{ type: 'image' as const, data: bytes.toString('base64'), mimeType: MIME_TYPES[extname(image.src).toLowerCase()] ?? 'image/png' }] : [];
    return { content: [{ type: 'text', text: imageResultText(image.src, target && relative(cwd, target)) }, ...returned] };
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }
}

/** Codex: a streamable-HTTP URL on localhost for its `mcp_servers` config, one path per thread behind a per-launch secret. */
export async function codexUrl(thread: string, { isGoalsOff, isSettingsChat }: MochiScope = {}) {
  const { port } = (await listening()).address() as AddressInfo;
  const query = new URLSearchParams({ ...(isGoalsOff && { goals: 'off' }), ...(isSettingsChat && { kind: 'settings' }) }).toString();
  return `http://127.0.0.1:${port}/mcp/${SECRET}/${thread}${query && `?${query}`}`;
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

function isSecret(value: string | undefined) {
  const given = Buffer.from(value ?? '');
  return given.length === SECRET.length && timingSafeEqual(given, Buffer.from(SECRET));
}

const calls = toolCalls(MOCHI_TIMEOUT_MS);
let http: Promise<Server> | undefined;

/** The renderer's answer to a call from `callMochi`. */
export const resolveToolCall = calls.resolve;

/** The calls a window reload took from `renderer`'s page, for the reloaded page to run again. */
export const undeliveredToolCalls = calls.undelivered;

async function callMochi(thread: string, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
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
      const match = req.url?.match(/^\/mcp\/(\w+)\/([\w-]+)(?:\?([\w=&]*))?$/);
      if (!match || !isSecret(match[1])) return void res.writeHead(404).end();
      // Codex sends no Origin; a browser page always does, so this keeps web pages off the port even if they learn the URL.
      if (req.headers.origin !== undefined) return void res.writeHead(403).end();
      const query = new URLSearchParams(match[3]);
      const scope: MochiScope = { isGoalsOff: query.get('goals') === 'off', isSettingsChat: query.get('kind') === 'settings' };
      const isDev = !app.isPackaged && process.env.MOCHI_DEV_MCP === '1' && match[2] === '__dev__';
      const mcp = isDev ? mochiServer(DEV_INSTRUCTIONS, devTools()) : mochiServer(instructionsFor(scope), toolsFor(scope).map((t) => ({ ...t, call: (args) => callMochi(match[2], t.name, args) })));
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
  const isPrivate = parts[0] === 'mcp' && isSecret(parts[1]) && parts.length > 3;
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
  await writeFile(file, JSON.stringify({ url, pid: process.pid }, null, 2), { mode: 0o600 });
  app.once('will-quit', () => { void rm(file, { force: true }); });
  console.info(`Dev MCP connection written to ${file}`);
}

const DEV_INSTRUCTIONS = 'This is an opted-in Mochi dev build. Start test tasks, inspect their progress and transcript, and continue them to reproduce issues. These are real agents using the selected profile account. Never mark a criterion verified on the agent’s word.';

const devTools = () => Object.entries(DEV_TOOL_TABLE).map(([name, t]): ServedTool => ({ name, ...t, call: (args) => callMochi('__dev__', name, args) }));
