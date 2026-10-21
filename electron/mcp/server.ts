import { app } from 'electron';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ImageGenHarness } from '../../src/host/types/settings.ts';
import type { GeneratedImage } from '../../src/model.ts';
import { IMAGE_SIZES, IMAGE_TOOL, IMAGE_TOOL_DESCRIPTION, IMAGE_TOOL_SHAPE, imageResultText, type ImageSize } from '../../src/runtime/imageTool.ts';
import { isTurnTool, MOCHI_SERVER, MOCHI_TIMEOUT_MS, servedTools, TOOL_NAMES, TOOL_TABLE, type MochiScope } from '../../src/runtime/toolTable.ts';
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
export function claudeServer(thread: string, spaceId: string, cwd: string, scope: MochiScope = {}) {
  const tools = toolsFor(scope).map((t) => tool(t.name, t.description, t.shape, (args) => callMochi(thread, t.name, args), { alwaysLoad: !!scope.isSettingsChat || isTurnTool(t.name) }));
  const image = tool(IMAGE_TOOL, IMAGE_TOOL_DESCRIPTION, IMAGE_TOOL_SHAPE, (args, extra) => generateImage(spaceId, cwd, args, (extra as { signal?: AbortSignal } | undefined)?.signal ?? new AbortController().signal));
  const isImageOff = scope.isSettingsChat || agentSettings().imageGen === 'off';
  return createSdkMcpServer({ name: SERVER, instructions: instructionsFor(scope), tools: isImageOff ? tools : [...tools, image] });
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
      if (!match || match[1] !== SECRET) return void res.writeHead(404).end();
      // Codex sends no Origin; a browser page always does, so this keeps web pages off the port even if they learn the URL.
      if (req.headers.origin !== undefined) return void res.writeHead(403).end();
      const query = new URLSearchParams(match[3]);
      const scope: MochiScope = { isGoalsOff: query.get('goals') === 'off', isSettingsChat: query.get('kind') === 'settings' };
      const isDev = !app.isPackaged && process.env.MOCHI_DEV_MCP === '1' && match[2] === '__dev__';
      const mcp = new McpServer({ name: SERVER, version: '1.0.0' }, { instructions: isDev ? 'This is an opted-in Mochi dev build. Start test tasks, inspect their progress and transcript, and continue them to reproduce issues. These are real agents using the selected profile account. Never mark a criterion verified on the agent’s word.' : instructionsFor(scope) });
      if (isDev) registerDevTools(mcp);
      else for (const t of toolsFor(scope)) mcp.registerTool(t.name, { description: t.description, inputSchema: t.shape }, (args: Record<string, unknown>) => callMochi(match[2], t.name, args));
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

function registerDevTools(mcp: McpServer) {
  mcp.registerTool('inspect', {
    description: 'Inspect this dev build. Omit threadId to list threads; supply it for paginated transcript, goal, criteria, plan, report, verdict and next action. PR state is the last recorded state, not a fresh GitHub fetch.',
    inputSchema: { threadId: z.string().optional(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(200).optional() },
  }, (args: Record<string, unknown>) => callMochi('__dev__', 'inspect', args));
  mcp.registerTool('start_task', {
    description: 'Start a real task in the dev build’s selected profile, with its normal account and permission defaults. project is an optional absolute project folder; omit for a folderless task. Returns the thread id to inspect.',
    inputSchema: { prompt: z.string().trim().min(1).max(20000), provider: z.enum(['claude', 'codex']), project: z.string().min(1).optional() },
  }, (args: Record<string, unknown>) => callMochi('__dev__', 'start_task', args));
  mcp.registerTool('accept_goal', {
    description: 'Accept a test task’s researched goal in this opted-in dev build, as through its proposal card. This does not verify any criteria; it only makes them available for progress reporting.',
    inputSchema: { threadId: z.string().min(1) },
  }, (args: Record<string, unknown>) => callMochi('__dev__', 'accept_goal', args));
  mcp.registerTool('continue_task', {
    description: 'Send the next prompt to an idle dev task, as through its composer. Inspect its transcript, criteria and next action first. Refuses running or settled tasks.',
    inputSchema: { threadId: z.string().min(1), text: z.string().trim().min(1).max(20000) },
  }, (args: Record<string, unknown>) => callMochi('__dev__', 'continue_task', args));
}
