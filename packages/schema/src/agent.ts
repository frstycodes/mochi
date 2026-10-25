import { Schema, Tuple } from 'effect';
import { ArrayOf, event, Id, invoke, JsonObject, Str } from './checks.ts';
import {
  AgentImage,
  AgentInfo,
  AgentQuestion,
  BackgroundTaskKind,
  GeneratedImage,
  McpCall,
  McpWidget,
  McpWidgetResource,
  Provider,
  Thread,
  ThreadRef,
  WebLink,
  WorktreeSetup,
} from './model.ts';
import { versionedUnion } from './version.ts';

const opt = Schema.optional;
const S = Schema.String;
const N = Schema.Number;
const B = Schema.Boolean;
const Phase = Schema.Literals(['start', 'end']);

const EndStatus = Schema.Literals(['done', 'failed', 'stopped']);

export const AgentPlanItem = Schema.Struct({
  title: S,
  status: Schema.Literals(['pending', 'running', 'done']),
});
export type AgentPlanItem = typeof AgentPlanItem.Type;

export const AgentSubagentEvent = Schema.Struct({
  threadId: S,
  type: Schema.Literal('subagent'),
  id: S,
  phase: Schema.Literals(['start', 'progress', 'end']),
  toolId: opt(S),
  name: opt(S),
  prompt: opt(S),
  model: opt(S),
  isBackground: opt(B),
  status: opt(EndStatus),
  activity: opt(S),
  step: opt(
    Schema.Struct({
      id: S,
      phase: Phase,
      text: S,
      description: opt(S),
      files: opt(Schema.Array(S)),
      exitCode: opt(N),
      output: opt(S),
      patch: opt(S),
    }),
  ),
  message: opt(S),
  isDelta: opt(B),
  result: opt(S),
  tokens: opt(N),
  error: opt(S),
  cwd: opt(S),
});

export const AgentTaskEvent = Schema.Struct({
  threadId: S,
  type: Schema.Literal('task'),
  id: S,
  phase: Schema.Literals(['start', 'progress', 'end']),
  kind: opt(BackgroundTaskKind),
  title: opt(S),
  command: opt(S),
  outputFile: opt(S),
  status: opt(EndStatus),
  exitCode: opt(N),
});

const member = <const T extends string, F extends Schema.Struct.Fields>(
  type: T,
  fields: F,
) => Schema.Struct({ threadId: S, type: Schema.Literal(type), ...fields });

/** Every event an agent run sends the renderer, before `v` (`src/host/types/agent.ts` `AgentEvent`). */
const UnversionedAgentEvent = Schema.Union([
  member('worktree', { path: S }),
  member('setup', { setup: WorktreeSetup }),
  member('branch', { branch: S, isDetached: opt(B) }),
  member('title', { title: S }),
  member('session', { provider: Provider, sessionId: S }),
  member('info', { info: AgentInfo }),
  member('message', { text: S, isDelta: B }),
  member('steer-read', { id: S }),
  member('reasoning', { text: S }),
  member('tool', {
    id: S,
    phase: Phase,
    text: S,
    description: opt(S),
    command: opt(S),
    files: opt(Schema.Array(S)),
    exitCode: opt(N),
    output: opt(S),
    patch: opt(S),
    links: opt(Schema.Array(WebLink)),
    skill: opt(S),
    mcp: opt(McpCall),
    sent: opt(Schema.Struct({ ...ThreadRef.fields, text: S })),
    images: opt(Schema.Array(S)),
    generated: opt(GeneratedImage),
    widget: opt(McpWidget),
  }),
  member('tool-description', { id: S, description: S }),
  member('plan', { items: Schema.Array(AgentPlanItem), isFresh: opt(B) }),
  AgentSubagentEvent,
  AgentTaskEvent,
  member('approval', {
    requestId: S,
    kind: Schema.Literals(['command', 'edit', 'tool']),
    title: S,
    detail: S,
    code: opt(S),
  }),
  member('question', { requestId: S, questions: Schema.Array(AgentQuestion) }),
  member('resolved', { requestId: S }),
  member('usage', {
    inputTokens: N,
    outputTokens: N,
    cachedTokens: opt(N),
    costUsd: opt(N),
    contextUsed: opt(N),
    contextMax: opt(N),
  }),
  member('limit-notice', { text: S }),
  member('notice', { text: S }),
  member('limit', { resetsAt: opt(S), label: opt(S), isTurnHeld: opt(B) }),
  member('limit-cleared', {}),
  member('compaction', {
    phase: Schema.Literals(['start', 'end', 'summary']),
    trigger: opt(Schema.Literals(['manual', 'auto'])),
    preTokens: opt(N),
    postTokens: opt(N),
    summary: opt(S),
    error: opt(S),
  }),
  member('turn-end', {
    status: Schema.Literals(['done', 'interrupted', 'failed']),
    error: opt(S),
  }),
]);

/** v1: the events as of the move to the event log. Events saved without `v` read as v1. */
export const AgentEvent = versionedUnion(1, UnversionedAgentEvent);
export type AgentEvent = typeof AgentEvent.Type;

/** `seq` rises with every event one run of main sends (`AgentHost.onEvent`). */
export const SeqAgentEvent = versionedUnion(
  1,
  UnversionedAgentEvent.mapMembers(
    Tuple.map(Schema.fieldsAssign({ seq: opt(N) })),
  ),
);
export type SeqAgentEvent = typeof SeqAgentEvent.Type;

export const LimitWindow = Schema.Struct({
  id: S,
  label: S,
  usedPct: N,
  resetsAt: opt(S),
});
export type LimitWindow = typeof LimitWindow.Type;

export const AccountLimits = Schema.Struct({
  accountId: S,
  provider: Provider,
  windows: Schema.Array(LimitWindow),
  updatedAt: opt(S),
});
export type AccountLimits = typeof AccountLimits.Type;

export const StartWorkspace = Schema.Struct({
  mode: Schema.Literals(['worktree', 'folder']),
  branch: Str(255),
  base: opt(Str(255)),
  isExisting: opt(B),
  isNew: opt(B),
  titlePrompt: opt(Str(40_000)),
  title: opt(Str(255)),
});
export type StartWorkspace = typeof StartWorkspace.Type;

const Images = ArrayOf(AgentImage, 8);
const Skills = ArrayOf(Id, 16);
const Short = Str(256);

export const AgentStartOptions = Schema.Struct({
  provider: Provider,
  spaceId: Short,
  cwd: Schema.NullOr(S),
  workspace: opt(StartWorkspace),
  prompt: Str(100_000),
  images: opt(Images),
  skills: opt(Skills),
  model: opt(Short),
  effort: opt(Short),
  speed: opt(Short),
  permissionMode: opt(Short),
  resume: opt(Short),
  forkAt: opt(Short),
  useApiKey: opt(B),
  isGoalsOff: opt(B),
  isSettingsChat: opt(B),
  nativeOff: opt(Schema.Array(S)),
}).check(
  Schema.makeFilter(
    (o) =>
      !o.useApiKey ||
      o.provider === 'claude' ||
      'Only Claude threads can continue on an API key',
  ),
);
export type AgentStartOptions = typeof AgentStartOptions.Type;

export const AgentSendInput = Schema.Struct({
  text: Str(100_000),
  images: opt(Images),
  skills: opt(Skills),
  steer: opt(B),
  steerId: opt(Short),
  policy: opt(Schema.Struct({ permissionMode: opt(Short), speed: opt(Short) })),
});

export const AttachedAgent = Schema.Struct({
  threadId: S,
  isWorking: B,
  events: Schema.Array(SeqAgentEvent),
});

export const AgentDecision = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('allow'), forSession: opt(B) }),
  Schema.Struct({
    kind: Schema.Literal('deny'),
    message: opt(Str(4096)),
    interrupt: opt(B),
  }),
  Schema.Struct({
    kind: Schema.Literal('answer'),
    answers: Schema.Array(Schema.Array(S)),
  }),
]);
export type AgentDecision = typeof AgentDecision.Type;

export const AgentAskEvent = Schema.Struct({
  id: S,
  type: Schema.Literals(['text', 'done', 'error']),
  text: S,
});

export const AgentAskContext = Schema.Struct({
  spaceId: Short,
  title: S,
  goal: S,
  steps: Schema.Array(Schema.Struct({ title: S, status: S })),
  activity: Schema.Array(Schema.Struct({ who: S, text: S })),
  diff: Schema.NullOr(
    Schema.Array(Schema.Struct({ path: S, added: N, removed: N })),
  ),
}).check(
  Schema.makeFilter(
    (c) =>
      JSON.stringify(c).length <= 50_000 || 'context must be under 50000 chars',
  ),
);

export const AgentAskModel = Schema.Struct({
  provider: Provider,
  model: opt(Str(128)),
});

export const AgentSpeed = Schema.Struct({ id: S, name: S, description: S });

export const AgentModel = Schema.Struct({
  id: S,
  name: S,
  description: S,
  efforts: Schema.Array(S),
  defaultEffort: opt(S),
  speeds: Schema.Array(AgentSpeed),
  isDefault: B,
});
export type AgentModel = typeof AgentModel.Type;

export const AgentAskMessage = Schema.Struct({
  role: Schema.Literals(['user', 'assistant']),
  text: Str(20_000),
});

export const AgentReviewRequest = Schema.Struct({
  provider: Provider,
  spaceId: Short,
  cwd: Str(),
  prompt: Str(100_000),
});

export const AgentReviewEvent = Schema.Union([
  Schema.Struct({ id: S, type: Schema.Literal('step'), text: S }),
  Schema.Struct({
    id: S,
    type: Schema.Literal('done'),
    result: Schema.Unknown,
  }),
  Schema.Struct({ id: S, type: Schema.Literal('error'), text: S }),
]);

export const AgentToolCall = Schema.Struct({
  id: S,
  threadId: S,
  name: S,
  args: JsonObject,
});
export type AgentToolCall = typeof AgentToolCall.Type;

export const AgentToolResult = Schema.Struct({
  text: Str(50_000),
  isError: opt(B),
  image: opt(Schema.Struct({ data: S, mimeType: Schema.Literal('image/png') })),
});
export type AgentToolResult = typeof AgentToolResult.Type;

export const UtilityTask = Schema.Literals([
  'title',
  'outcome',
  'simplify',
  'commit',
  'pr',
  'handoff',
  'audit',
  'command',
]);

export const DriftVerdict = Schema.Struct({
  kind: Schema.Literals(['on-goal', 'scope-add', 'off-goal']),
  reason: S,
});

const T = Schema.Tuple;
const o = Schema.optional;
const Void = Schema.Void;
const IdOut = Schema.Struct({ id: S });

/** `AgentHost` (`src/host/types/agent.ts`): each method's arguments and result, each push channel's payload. */
export const agentRpc = {
  start: invoke(T([Id, AgentStartOptions]), Void),
  send: invoke(T([Id, AgentSendInput]), Void),
  unsteer: invoke(T([Id, Id]), B),
  compact: invoke(T([Id, Str(10_000)]), Void),
  compactInstructions: invoke(T([Id, Str(20_000)]), Void),
  interrupt: invoke(T([Id]), Void),
  setupChoice: invoke(T([Id, Schema.Literals(['retry', 'skip'])]), Void),
  keepTitle: invoke(T([Id]), Void),
  resolve: invoke(T([Id, AgentDecision]), Void),
  stop: invoke(T([Id]), Void),
  settle: invoke(T([Id]), Void),
  attached: invoke(
    T([Schema.Array(Schema.Struct({ threadId: Id, after: opt(N) }))]),
    Schema.Array(AttachedAgent),
  ),
  onEvent: event(SeqAgentEvent),
  ask: invoke(
    T([AgentAskContext, ArrayOf(AgentAskMessage, 200), AgentAskModel]),
    IdOut,
  ),
  onAskEvent: event(AgentAskEvent),
  review: invoke(T([AgentReviewRequest]), IdOut),
  onReviewEvent: event(AgentReviewEvent),
  classify: invoke(T([Str(20_000), Thread]), DriftVerdict),
  utility: invoke(T([UtilityTask, Short, Str(40_000)]), Schema.NullOr(S)),
  rewindFiles: invoke(T([Id, Str(100_000)]), Void),
  rewindPoint: invoke(T([Id, Str(100_000)]), Schema.NullOr(S)),
  readWidget: invoke(
    T([Id, Short, Str(2048).check(Schema.isStartingWith('ui://'))]),
    McpWidgetResource,
  ),
  stopTask: invoke(T([Id, Id]), Void),
  warm: invoke(T([Short]), Void),
  models: invoke(T([Provider, Short]), Schema.Array(AgentModel)),
  limits: invoke(T([Provider, Short, o(B)]), AccountLimits),
  onLimits: event(AccountLimits),
  onToolCall: event(AgentToolCall),
  pendingToolCalls: invoke(T([]), Schema.Array(AgentToolCall)),
  toolResult: invoke(T([Id, AgentToolResult]), Void),
};
