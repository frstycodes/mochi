import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { Schema } from 'effect';
import type { ImageGenHarness } from '../../../../apps/desktop/src/host/types/settings.ts';
import type { GeneratedImage } from '../../../../apps/desktop/src/model.ts';
import {
  IMAGE_SIZES,
  IMAGE_TOOL,
  IMAGE_TOOL_DESCRIPTION,
  IMAGE_TOOL_SHAPE,
  imageResultText,
  type ImageSize,
} from '../../../../apps/desktop/src/runtime/imageTool.ts';
import {
  decodeArgs,
  isAlwaysLoaded,
  jsonSchemaOf,
  MOCHI_SERVER,
  servedTools,
  TOOL_NAMES,
  TOOL_TABLE,
  type MochiScope,
} from '@mochi/domain/runtime/toolTable';
import {
  HISTORY_TOOL,
  HISTORY_TOOL_DESCRIPTION,
  HISTORY_TOOL_SHAPE,
  type HistoryArgs,
} from '../switch/history.ts';
import { agentSettings } from './config.ts';

/**
 * Mochi's own tools for the agent in a thread. Each call goes to the renderer, which runs it as the store action the UI
 * dispatches for the same change (`src/runtime/tools.ts`), so the thread view updates as if you had done it. Main relays
 * the call to its window (`callMochi` in electron/mcp/server.ts); Codex reaches the same tools over main's loopback HTTP.
 */
export const SERVER = MOCHI_SERVER;

export const toolsFor = (scope: MochiScope) =>
  servedTools(scope).map((name) => ({ name, ...TOOL_TABLE[name] }));

/** Shown to the model as the server's instructions (MCP `initialize`); the same for every thread, so it reads its own goal. */
const INSTRUCTIONS =
  "Mochi runs this thread and shows the user its goal. Call get_goal at the start. Mochi does not draft a goal from the first prompt: for a task with a checkable outcome, research the code and the user's request, then call propose_goal with the concrete outcome and checkable criteria before finishing the work. A goal is optional: a question, a chat, or a small one-step change needs none. Older threads may have a draft (isDraft): replace it after research. Propose again only if what done means has to change. While a proposal awaits acceptance, keep working and report progress; claim criteria once accepted. With a goal: call claim_criterion with one line of evidence as soon as each criterion is met; at the end of a turn where you changed anything, call report_turn once (what changed in the user's terms, decisions, what's left, at most one question for the user, and, only when the user has a real choice, the next move as one yes/no question). To split a goal, give each independent piece (pieces that touch different files) its own sub-thread with create_thread and that piece's criterionId: initiation user_asked when the user asked for it split, else own_initiative cards they start; a sub-thread works only on its piece and opens its own PR with gh pr create --base set explicitly (usually main, or the branch it was cut from), and its result comes back to the parent.";

/** With goals off (always, now goals are retired), nothing about goals: the main instructions say the rest. */
const NO_GOAL_INSTRUCTIONS =
  'Mochi runs this thread and shows the user what its tools do.';

const SETTINGS_CHAT_INSTRUCTIONS =
  "These tools read and suggest Mochi's own settings. Call get_settings before answering.";

export const instructionsFor = ({ isGoalsOff, isSettingsChat }: MochiScope) =>
  isSettingsChat
    ? SETTINGS_CHAT_INSTRUCTIONS
    : isGoalsOff
      ? NO_GOAL_INSTRUCTIONS
      : INSTRUCTIONS;

/** Mochi asks with its own widget for deletes and settings (`src/runtime/tools.ts`), so the harness never asks too. */
export const AUTO_ALLOWED = [...TOOL_NAMES, IMAGE_TOOL, HISTORY_TOOL].map(
  (name) => `mcp__${SERVER}__${name}`,
);

export type CallMochi = (
  thread: string,
  name: string,
  args: Record<string, unknown>,
) => Promise<CallToolResult>;

/**
 * Claude: an in-process server per session, bound to its thread. A server instance serves one connection. `generate_image`
 * is Claude's only (Codex generates natively) and runs here in Core, not in the renderer; a session started while it was
 * off in Settings doesn't get it.
 */
export function claudeServer(
  thread: string,
  spaceId: string,
  cwd: string,
  callMochi: CallMochi,
  scope: MochiScope = {},
): McpSdkServerConfigWithInstance {
  const tools = toolsFor(scope).map((t): ServedTool => ({
    ...t,
    alwaysLoad: !!scope.isSettingsChat || isAlwaysLoaded(t.name),
    call: (args) => callMochi(thread, t.name, args),
  }));
  const image: ServedTool = {
    name: IMAGE_TOOL,
    description: IMAGE_TOOL_DESCRIPTION,
    shape: IMAGE_TOOL_SHAPE,
    call: (args, signal) =>
      generateImage(spaceId, cwd, args as ImageArgs, signal),
  };
  const isImageOff = scope.isSettingsChat || agentSettings().imageGen === 'off';
  return {
    type: 'sdk',
    name: SERVER,
    instance: mochiServer(instructionsFor(scope), [
      ...tools,
      ...(isImageOff ? [] : [image]),
      ...(scope.isSettingsChat ? [] : [historyTool(thread, answerHistory)]),
    ]),
  };
}

type AnswerHistory = (
  thread: string,
  args: HistoryArgs,
) => Promise<CallToolResult>;

let answerHistory: AnswerHistory = async () => ({
  content: [{ type: 'text', text: 'The thread history is not available' }],
  isError: true,
});

/** Set by the agents layer once Core's `ThreadContext` runs. */
export const setThreadHistory = (answer: AnswerHistory) =>
  void (answerHistory = answer);

/** `thread_history` for `thread`, answered by Core however the agent reaches it. */
export const historyTool = (
  thread: string,
  call: AnswerHistory,
): ServedTool => ({
  name: HISTORY_TOOL,
  description: HISTORY_TOOL_DESCRIPTION,
  shape: HISTORY_TOOL_SHAPE,
  call: (args) => call(thread, args as HistoryArgs),
});

export interface ServedTool {
  name: string;
  description: string;
  shape: Schema.Struct.Fields;
  /** Claude: listed up front, never deferred behind tool search. */
  alwaysLoad?: boolean;
  call: (
    args: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<CallToolResult>;
}

type ImageArgs = { prompt: string; size?: ImageSize; saveTo?: string };

/** An MCP server for `tools`, their inputs listed as JSON Schema and checked against their shapes before `call` runs. */
export function mochiServer(instructions: string, tools: ServedTool[]) {
  const mcp = new McpServer(
    { name: SERVER, version: '1.0.0' },
    { instructions, capabilities: { tools: {} } },
  );
  mcp.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: jsonSchemaOf(t.shape),
      ...(t.alwaysLoad && { _meta: { 'anthropic/alwaysLoad': true } }),
    })),
  }));
  mcp.server.setRequestHandler(
    CallToolRequestSchema,
    async ({ params }, extra): Promise<CallToolResult> => {
      const tool = tools.find((t) => t.name === params.name);
      if (!tool)
        return {
          content: [{ type: 'text', text: `No Mochi tool ${params.name}` }],
          isError: true,
        };
      const decoded = decodeArgs(tool.shape, params.arguments ?? {});
      if ('error' in decoded)
        return {
          content: [
            {
              type: 'text',
              text: `Invalid arguments for ${params.name}: ${decoded.error}`,
            },
          ],
          isError: true,
        };
      return tool.call(decoded.args as Record<string, unknown>, extra.signal);
    },
  );
  return mcp;
}

type GenerateImage = (
  spaceId: string,
  prompt: string,
  signal: AbortSignal,
) => Promise<GeneratedImage>;

const generators: Partial<Record<ImageGenHarness, GenerateImage>> = {};

/** Set by the agents' handlers once the harness's adapter exists. */
export const setImageGenerator = (
  harness: Exclude<ImageGenHarness, 'off'>,
  generate: GenerateImage,
) => void (generators[harness] = generate);

// Claude rejects images over 5 MB; a bigger one is still made and saved, Claude just gets its path.
const MAX_RETURNED_BYTES = 5 * 1024 * 1024;
const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

async function generateImage(
  spaceId: string,
  cwd: string,
  args: { prompt: string; size?: ImageSize; saveTo?: string },
  signal: AbortSignal,
): Promise<CallToolResult> {
  const failed = (text: string): CallToolResult => ({
    content: [{ type: 'text', text }],
    isError: true,
  });
  const harness = agentSettings().imageGen;
  const generate = harness !== 'off' && generators[harness];
  if (!generate)
    return failed('Image generation is off in Mochi’s Settings › Models.');
  const target = args.saveTo ? resolve(cwd, args.saveTo) : undefined;
  if (
    target &&
    (relative(cwd, target).startsWith('..') ||
      isAbsolute(relative(cwd, target)))
  )
    return failed('saveTo must be a path inside your worktree.');
  try {
    const image = await generate(
      spaceId,
      `${args.prompt}\n\nMake it ${IMAGE_SIZES[args.size ?? 'square'].ask}.`,
      signal,
    );
    if (image.status !== 'done' || !image.src)
      return failed(image.error ?? 'The image wasn’t generated.');
    if (target)
      await mkdir(dirname(target), { recursive: true }).then(() =>
        copyFile(image.src!, target),
      );
    const bytes = await readFile(image.src);
    const returned =
      bytes.length <= MAX_RETURNED_BYTES
        ? [
            {
              type: 'image' as const,
              data: bytes.toString('base64'),
              mimeType:
                MIME_TYPES[extname(image.src).toLowerCase()] ?? 'image/png',
            },
          ]
        : [];
    return {
      content: [
        {
          type: 'text',
          text: imageResultText(image.src, target && relative(cwd, target)),
        },
        ...returned,
      ],
    };
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }
}
