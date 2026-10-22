import { Schema } from 'effect';
import { JsonObject, Str } from './checks.ts';

const opt = Schema.optionalKey;

export const Provider = Schema.Literals(['claude', 'codex']);
export type Provider = typeof Provider.Type;

export const ThreadRef = Schema.Struct({ threadId: opt(Schema.String), title: Schema.String });
export type ThreadRef = typeof ThreadRef.Type;

export const GeneratedImage = Schema.Struct({
  status: Schema.Literals(['running', 'done', 'failed']),
  prompt: opt(Schema.String),
  src: opt(Schema.String),
  aspect: opt(Schema.Number),
  error: opt(Schema.String),
});
export type GeneratedImage = typeof GeneratedImage.Type;

export const McpCall = Schema.Struct({ server: Schema.String, tool: Schema.String, account: opt(Schema.String) });
export type McpCall = typeof McpCall.Type;

export const McpWidgetResult = Schema.Struct({
  content: Schema.Array(Schema.Struct({ type: Schema.Literal('text'), text: Schema.String })),
  structuredContent: opt(JsonObject),
});
export type McpWidgetResult = typeof McpWidgetResult.Type;

export const McpWidget = Schema.Struct({ server: Schema.String, uri: Schema.String, input: JsonObject, result: McpWidgetResult });
export type McpWidget = typeof McpWidget.Type;

export const McpWidgetResource = Schema.Struct({ html: Schema.String, meta: opt(JsonObject) });
export type McpWidgetResource = typeof McpWidgetResource.Type;

export const WebLink = Schema.Struct({ url: Schema.String, title: opt(Schema.String) });
export type WebLink = typeof WebLink.Type;

export const AgentCommand = Schema.Struct({ name: Schema.String, description: Schema.String, argumentHint: opt(Schema.String), path: opt(Schema.String) });
export type AgentCommand = typeof AgentCommand.Type;

export const McpServer = Schema.Struct({
  name: Schema.String,
  status: Schema.Literals(['connected', 'pending', 'needs-auth', 'failed', 'disabled']),
  toolCount: opt(Schema.Number),
  url: opt(Schema.String),
});
export type McpServer = typeof McpServer.Type;

export const AgentInfo = Schema.Struct({
  model: opt(Schema.String),
  effort: opt(Schema.String),
  cwd: opt(Schema.String),
  permissionMode: opt(Schema.String),
  version: opt(Schema.String),
  tools: opt(Schema.Array(Schema.String)),
  mcpServers: opt(Schema.Array(McpServer)),
  skills: opt(Schema.Array(Schema.String)),
  plugins: opt(Schema.Array(Schema.Struct({ name: Schema.String, version: opt(Schema.String) }))),
  slashCommands: opt(Schema.Array(Schema.String)),
  commands: opt(Schema.Array(AgentCommand)),
});
export type AgentInfo = typeof AgentInfo.Type;

export const SubagentStatus = Schema.Literals(['running', 'done', 'failed', 'stopped']);
export type SubagentStatus = typeof SubagentStatus.Type;

export const BackgroundTaskKind = Schema.Literals(['shell', 'workflow', 'monitor']);
export type BackgroundTaskKind = typeof BackgroundTaskKind.Type;

export const SetupStep = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  command: opt(Schema.String),
  status: Schema.Literals(['pending', 'running', 'done', 'failed', 'skipped']),
  startedAt: opt(Schema.Number),
  endedAt: opt(Schema.Number),
  output: opt(Schema.String),
  exitCode: opt(Schema.Number),
});
export type SetupStep = typeof SetupStep.Type;

export const WorktreeSetup = Schema.Struct({
  status: Schema.Literals(['running', 'failed', 'ready', 'skipped', 'cancelled']),
  startedAt: Schema.Number,
  endedAt: opt(Schema.Number),
  steps: Schema.Array(SetupStep),
});
export type WorktreeSetup = typeof WorktreeSetup.Type;

export const AgentQuestion = Schema.Struct({ text: Schema.String, options: Schema.Array(Schema.String), multiSelect: Schema.Boolean });
export type AgentQuestion = typeof AgentQuestion.Type;

// Claude rejects images over 5 MB; base64 runs 4/3 of that.
const MAX_IMAGE_CHARS = 6_900_000;

export const AgentImage = Schema.Struct({ mediaType: Schema.Literals(['image/jpeg', 'image/png', 'image/gif', 'image/webp']), data: Str(MAX_IMAGE_CHARS) });
export type AgentImage = typeof AgentImage.Type;

export const SentImage = Schema.Struct({ ...AgentImage.fields, thumb: Schema.String, original: opt(Schema.String) });
export type SentImage = typeof SentImage.Type;

export const PullRequest = Schema.Struct({
  number: Schema.Number,
  state: Schema.Literals(['open', 'merged', 'draft', 'closed']),
  title: Schema.String,
  url: opt(Schema.String),
  autofixSince: opt(Schema.Number),
  autoArchive: opt(Schema.Boolean),
});
export type PullRequest = typeof PullRequest.Type;

export const PaneTabKind = Schema.Literals(['browser', 'changes', 'terminal', 'files', 'simulator', 'ports', 'sidechat', 'agents', 'visual', 'artifacts', 'pr']);
export type PaneTabKind = typeof PaneTabKind.Type;

export const SpaceIconName = Schema.Literals(['work', 'home', 'layers', 'code', 'book', 'rocket', 'coffee', 'star']);
export type SpaceIconName = typeof SpaceIconName.Type;

/** A profile, before `v` (`src/model.ts` `Space`); `stored.ts` versions it as a row. */
export const Space = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  icon: SpaceIconName,
  plans: Schema.Struct({ claude: Schema.String, codex: Schema.String }),
  github: Schema.String,
  nativeOff: opt(Schema.Array(Schema.String)),
  nativeNew: opt(Schema.Struct({ claude: opt(Schema.Literals(['on', 'off'])), codex: opt(Schema.Literals(['on', 'off'])) })),
});
export type Space = typeof Space.Type;
