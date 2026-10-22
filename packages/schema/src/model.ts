import { Effect, Schema, SchemaTransformation } from 'effect';
import { JsonObject, Str } from './checks.ts';

const opt = Schema.optional;

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

export const McpServerDef = Schema.Struct({
  name: Schema.String,
  type: Schema.Literals(['stdio', 'http', 'sse']),
  command: opt(Schema.String),
  args: opt(Schema.Array(Schema.String)),
  env: opt(Schema.Record(Schema.String, Schema.String)),
  cwd: opt(Schema.String),
  url: opt(Schema.String),
  headers: opt(Schema.Record(Schema.String, Schema.String)),
});
export type McpServerDef = typeof McpServerDef.Type;

export const FileEdit = Schema.Struct({ path: Schema.String, before: Schema.String, after: Schema.String });
export type FileEdit = typeof FileEdit.Type;

export const Access = Schema.Literals(['Manual', 'Auto', 'Full access', 'Plan']);
export type Access = typeof Access.Type;

const RENAMED_ACCESS: Record<string, Access> = { 'Ask first': 'Manual', 'Auto edit': 'Auto' };

/**
 * Access as threads and prefs stored it (`accessOf`): the names before the rename read as today's, and an unknown value as
 * Auto, so one odd value never makes a whole save unreadable. Stored data only: remote input takes the strict `Access`.
 */
export const StoredAccess = Schema.Unknown.pipe(
  Schema.decodeTo(
    Access,
    SchemaTransformation.transform<Access, unknown>({ decode: (value) => RENAMED_ACCESS[String(value)] ?? (Access.literals.find((a) => a === value) || 'Auto'), encode: (access) => access }),
  ),
);

export const ThreadControls = Schema.Struct({
  model: Schema.String,
  effort: Schema.String,
  // Threads saved before speed existed ran standard.
  speed: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed(''))),
  access: StoredAccess,
});
export type ThreadControls = typeof ThreadControls.Type;

export const AutofixTarget = Schema.Struct({ threadId: Schema.String, title: Schema.String, pr: Schema.Number, cwd: Schema.String, githubUser: opt(Schema.String), since: Schema.Number });
export type AutofixTarget = typeof AutofixTarget.Type;

export const AutofixCheck = Schema.Struct({ name: Schema.String, state: Schema.Literals(['pass', 'fail', 'pending', 'skip']), link: opt(Schema.String) });
export type AutofixCheck = typeof AutofixCheck.Type;

export const AutofixComment = Schema.Struct({ id: Schema.String, author: Schema.String, body: Schema.String, url: opt(Schema.String), where: opt(Schema.String) });
export type AutofixComment = typeof AutofixComment.Type;

export const StopReason = Schema.Literals(['merged', 'closed', 'cap']);

export const AutofixEvent = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('enabled'), pr: Schema.Number, url: opt(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal('ci'), pr: Schema.Number, url: Schema.String, head: Schema.String, failed: Schema.Array(AutofixCheck), attempt: Schema.Number, logs: opt(Schema.Array(Schema.Struct({ name: Schema.String, text: Schema.String }))) }),
  Schema.Struct({ kind: Schema.Literal('conflict'), pr: Schema.Number, url: Schema.String, head: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('review'), pr: Schema.Number, url: Schema.String, comments: Schema.Array(AutofixComment) }),
  Schema.Struct({ kind: Schema.Literal('stopped'), pr: Schema.Number, url: Schema.String, reason: StopReason, failed: opt(Schema.Array(AutofixCheck)) }),
]);
export type AutofixEvent = typeof AutofixEvent.Type;
const AutofixKind = Schema.Literals(['enabled', 'ci', 'conflict', 'review', 'stopped']);

export const FileMention = Schema.Struct({ kind: Schema.Literal('file'), id: Schema.String, title: Schema.String, path: Schema.String, isDir: Schema.Boolean });

export const Mention = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('thread'), id: Schema.String, title: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('window'), id: Schema.String, title: Schema.String, icon: opt(Schema.String), image: AgentImage }),
  Schema.Struct({ kind: Schema.Literal('skill'), id: Schema.String, title: Schema.String, description: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('mcp'), id: Schema.String, title: Schema.String, toolCount: opt(Schema.Number) }),
  FileMention,
]);
export type Mention = typeof Mention.Type;

export const WorkspaceDraft = Schema.Struct({
  base: opt(Schema.String),
  isExisting: opt(Schema.Boolean),
  autoBranch: opt(Schema.String),
  mode: Schema.Literals(['worktree', 'folder']),
  branch: opt(Schema.String),
});
export type WorkspaceDraft = typeof WorkspaceDraft.Type;

export const Verdict = Schema.Struct({
  verdict: Schema.Literals(['approve', 'concerns', 'block']),
  summary: Schema.String,
  findings: Schema.Array(Schema.Struct({ file: Schema.String, line: opt(Schema.Number), severity: Schema.Literals(['high', 'medium', 'low']), text: Schema.String })),
});
export type Verdict = typeof Verdict.Type;

export const Review = Schema.Struct({
  id: Schema.String,
  provider: Provider,
  afterIndex: Schema.Number,
  startedAt: Schema.Number,
  status: Schema.Literals(['running', 'done', 'failed']),
  steps: Schema.Array(Schema.String),
  result: opt(Verdict),
  error: opt(Schema.String),
  isTruncated: opt(Schema.Boolean),
  isSent: opt(Schema.Boolean),
  isDismissed: opt(Schema.Boolean),
  isAgentAsked: opt(Schema.Boolean),
});
export type Review = typeof Review.Type;

export const VizLanguage = Schema.Literals(['chart', 'svg', 'html', 'harness-metro', 'harness-diff']);
export type VizLanguage = typeof VizLanguage.Type;

export const PaneLayout = Schema.Struct({
  columns: Schema.Array(Schema.Array(PaneTabKind)),
  focused: opt(PaneTabKind),
  expanded: opt(PaneTabKind),
  weights: opt(Schema.Record(PaneTabKind, opt(Schema.Number))),
  share: opt(Schema.Number),
  columnWeights: opt(Schema.Array(Schema.Number)),
});
export type PaneLayout = typeof PaneLayout.Type;

const Author = Schema.Literals(['claude', 'codex', 'you', 'harness']);

const StepStatus = Schema.Literals(['done', 'running', 'ready', 'blocked', 'dropped']);

export const Step = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: StepStatus,
  addedAt: Schema.Number,
  addedBy: Author,
  startedAt: opt(Schema.Number),
  doneAt: opt(Schema.Number),
  startedMs: opt(Schema.Number),
  doneMs: opt(Schema.Number),
  stoppedAt: opt(Schema.Number),
  stoppedMs: opt(Schema.Number),
  droppedAt: opt(Schema.Number),
  note: opt(Schema.String),
});
export type Step = typeof Step.Type;

export const Criterion = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  command: opt(Schema.String),
  claim: opt(Schema.Struct({ evidence: Schema.String, at: Schema.Number, by: Provider })),
  check: opt(Schema.Struct({ status: Schema.Literals(['running', 'passed', 'failed']), at: Schema.Number, ms: opt(Schema.Number), output: opt(Schema.String) })),
});
export type Criterion = typeof Criterion.Type;

export const NextOption = Schema.Struct({ label: Schema.String, reply: Schema.String, isDraft: opt(Schema.Boolean) });

export const TurnReport = Schema.Struct({
  at: Schema.Number,
  turn: opt(Schema.Number),
  by: Provider,
  decisions: Schema.Array(Schema.String),
  left: Schema.Array(Schema.String),
  question: opt(Schema.String),
  summary: opt(Schema.String),
  next: opt(Schema.String),
  options: opt(Schema.Array(NextOption)),
  isSuperseded: opt(Schema.Literal(true)),
});
export type TurnReport = typeof TurnReport.Type;

const GoalCriteria = Schema.Array(Schema.Struct({ text: Schema.String, command: opt(Schema.String) }));

export const GoalProposal = Schema.Struct({
  goal: Schema.String,
  criteria: GoalCriteria,
  basis: opt(Schema.String),
  at: Schema.Number,
  by: Provider,
  state: Schema.Literals(['waiting', 'accepted', 'applied', 'kept', 'undone']),
  before: Schema.Struct({ goal: Schema.String, criteria: GoalCriteria }),
});

export const IdleCheck = Schema.Struct({
  at: Schema.Number,
  turn: opt(Schema.Number),
  uncommitted: opt(Schema.Number),
  isGathering: opt(Schema.Boolean),
  audit: opt(Schema.Struct({ question: opt(Schema.String), unverified: Schema.Array(Schema.Struct({ text: Schema.String, quote: Schema.String })) })),
  accepted: Schema.Array(Schema.String),
  isConfirmed: opt(Schema.Boolean),
  isMoveAnswered: opt(Schema.Boolean),
});

export const Similar = Schema.Struct({ threadId: Schema.String, relation: Schema.Literals(['same', 'related']) });

export const Revision = Schema.Struct({ n: Schema.Number, at: Schema.Number, label: Schema.String, by: Author, diff: opt(Schema.Array(Schema.String)) });

export const SubThreadLink = Schema.Struct({ threadId: Schema.String, criterionId: opt(Schema.String), handedBackAt: opt(Schema.Number) });
export type SubThreadLink = typeof SubThreadLink.Type;

export const ThreadProposal = Schema.Struct({
  id: Schema.String,
  initiation: Schema.Literals(['offer', 'own_initiative', 'user_asked']),
  title: Schema.String,
  brief: Schema.String,
  state: Schema.Literals(['pending', 'started', 'dismissed', 'here']),
  reason: opt(Schema.String),
  threadId: opt(Schema.String),
  create: Schema.Struct({ provider: Provider, project: Schema.NullOr(Schema.String), workspace: opt(WorkspaceDraft), controls: opt(ThreadControls), isLive: Schema.Boolean, parent: opt(SubThreadLink) }),
});

export const Handoff = Schema.Struct({
  from: Provider,
  to: Provider,
  status: Schema.Literals(['drafting', 'started', 'failed']),
  prompt: opt(Schema.String),
  fallback: opt(Schema.Literals(['timeout', 'error'])),
  error: opt(Schema.String),
});

export const Compaction = Schema.Struct({
  trigger: Schema.Literals(['manual', 'auto']),
  status: Schema.Literals(['running', 'done', 'failed']),
  pins: Schema.Number,
  hasGoal: Schema.Boolean,
  focus: opt(Schema.String),
  preTokens: opt(Schema.Number),
  postTokens: opt(Schema.Number),
  summary: opt(Schema.String),
  error: opt(Schema.String),
});

export const ActivityEntry = Schema.Struct({
  at: Schema.Number,
  who: Author,
  kind: Schema.Literals(['message', 'tool', 'event', 'reasoning', 'subagent']),
  text: Schema.String,
  simplified: opt(Schema.Struct({ text: Schema.String, rulesKey: Schema.String, isShown: Schema.Boolean })),
  detail: opt(Schema.String),
  seconds: opt(Schema.Number),
  drift: opt(Schema.Literals(['on-goal', 'scope-add', 'off-goal'])),
  toolId: opt(Schema.String),
  description: opt(Schema.String),
  output: opt(Schema.String),
  exitCode: opt(Schema.Number),
  patch: opt(Schema.String),
  isLimit: opt(Schema.Boolean),
  card: opt(Schema.Struct({ id: Schema.String, isOpen: Schema.Boolean })),
  links: opt(Schema.Array(WebLink)),
  glyph: opt(Schema.Literals(['click', 'type', 'browse'])),
  site: opt(Schema.String),
  subagentId: opt(Schema.String),
  ms: opt(Schema.Number),
  skill: opt(Schema.String),
  mcp: opt(McpCall),
  wasQueued: opt(Schema.Boolean),
  isSeen: opt(Schema.Literal(true)),
  secondOpinion: opt(Schema.Struct({ reviewId: Schema.String, provider: Provider })),
  images: opt(Schema.Array(Schema.String)),
  generated: opt(GeneratedImage),
  widget: opt(McpWidget),
  turnUndo: opt(Schema.Struct({ start: Schema.Number, isUndone: Schema.Boolean })),
  nextMove: opt(Schema.Struct({ summary: opt(Schema.String), question: Schema.String, answer: opt(Schema.String) })),
  from: opt(ThreadRef),
  autofix: opt(Schema.Struct({ kind: AutofixKind, pr: Schema.Number, title: Schema.String })),
  subThread: opt(Schema.Struct({ threadId: Schema.String, title: Schema.String, text: Schema.String })),
  sent: opt(Schema.Struct({ ...ThreadRef.fields, text: Schema.String })),
  compaction: opt(Compaction),
  handoff: opt(Handoff),
  proposals: opt(Schema.Array(ThreadProposal)),
});
export type ActivityEntry = typeof ActivityEntry.Type;

export const QueuedMessage = Schema.Struct({
  id: Schema.String,
  draft: Schema.String,
  images: opt(Schema.Array(SentImage)),
  mentions: Schema.Array(Mention),
  isCommand: Schema.Boolean,
  typedSkills: Schema.Array(Schema.String),
  isSentNow: opt(Schema.Literal(true)),
});

export const PendingSteer = Schema.Struct({
  message: QueuedMessage,
  entry: ActivityEntry,
  reason: Schema.String,
  hasReportBefore: opt(Schema.Literal(true)),
  sendNow: opt(Schema.Literals(['pending', 'turn-ended'])),
});

export const Subagent = Schema.Struct({
  id: Schema.String,
  origin: Schema.Literals(['native', 'mochi']),
  provider: Provider,
  name: Schema.String,
  prompt: opt(Schema.String),
  model: opt(Schema.String),
  toolId: opt(Schema.String),
  isBackground: Schema.Boolean,
  status: SubagentStatus,
  startedAt: Schema.Number,
  endedAt: opt(Schema.Number),
  tokens: Schema.Number,
  activity: opt(Schema.String),
  steps: Schema.Array(
    Schema.Struct({ id: Schema.String, text: Schema.String, isDone: Schema.Boolean, description: opt(Schema.String), files: opt(Schema.Array(Schema.String)), exitCode: opt(Schema.Number), output: opt(Schema.String), patch: opt(Schema.String) }),
  ),
  message: opt(Schema.String),
  result: opt(Schema.String),
  error: opt(Schema.String),
  sessionId: opt(Schema.String),
  cwd: opt(Schema.String),
  hasOwnWorktree: opt(Schema.Boolean),
  isReportDue: opt(Schema.Boolean),
});

export const BackgroundTask = Schema.Struct({
  id: Schema.String,
  kind: BackgroundTaskKind,
  provider: Provider,
  title: Schema.String,
  command: opt(Schema.String),
  status: SubagentStatus,
  startedAt: Schema.Number,
  endedAt: opt(Schema.Number),
  exitCode: opt(Schema.Number),
  outputFile: opt(Schema.String),
});

export const LiveRun = Schema.Struct({
  isWorking: Schema.Boolean,
  turnEnd: opt(Schema.Literals(['done', 'interrupted', 'failed'])),
  starting: opt(Provider),
  cwd: opt(Schema.String),
  limit: opt(Schema.Struct({ resetsAt: opt(Schema.String), label: opt(Schema.String), isTurnHeld: opt(Schema.Boolean), autoResume: opt(Schema.Boolean) })),
  isDetached: opt(Schema.Boolean),
  eventSeq: opt(Schema.Number),
  isOnApiKey: opt(Schema.Boolean),
  notes: opt(Schema.Array(Schema.String)),
  restart: opt(Schema.Union([Schema.Struct({ forkAt: Schema.String }), Schema.Struct({ seed: Schema.String })])),
});

export const Repo = Schema.Struct({
  autoBranch: opt(Schema.String),
  project: Schema.String,
  branch: Schema.String,
  path: opt(Schema.String),
  mode: opt(Schema.Literal('folder')),
  base: opt(Schema.String),
  isExisting: opt(Schema.Boolean),
  isDetached: opt(Schema.Boolean),
});
export type Repo = typeof Repo.Type;

export const Thread = Schema.Struct({
  id: Schema.String,
  spaceId: Schema.String,
  repo: Schema.NullOr(Repo),
  title: Schema.String,
  isTitleRenamed: opt(Schema.Boolean),
  isTitleGenerated: opt(Schema.Boolean),
  goal: Schema.String,
  criteria: opt(Schema.Array(Criterion)),
  similar: opt(Schema.Array(Similar)),
  parent: opt(SubThreadLink),
  isGoalOff: opt(Schema.Boolean),
  report: opt(TurnReport),
  idle: opt(IdleCheck),
  turn: opt(Schema.Struct({ start: Schema.Number, isAgentDriven: opt(Schema.Literal(true)) })),
  proposal: opt(GoalProposal),
  providers: Schema.Array(Provider),
  status: Schema.Literals(['running', 'needs-you', 'review', 'settled']),
  line: Schema.Literals([1, 2, 3, 4, 5]),
  startedAt: Schema.Number,
  steps: Schema.Array(Step),
  revisions: Schema.Array(Revision),
  activity: Schema.Array(ActivityEntry),
  prs: Schema.Array(PullRequest),
  sources: Schema.Array(Schema.Struct({ kind: Schema.Literals(['link', 'mcp', 'file']), label: Schema.String })),
  context: Schema.Struct({ used: Schema.Number, max: Schema.Number }),
  orbitSlot: opt(Schema.Number),
  pinOrder: opt(Schema.Number),
  settledAt: opt(Schema.Number),
  drift: opt(Schema.Struct({ isMuted: Schema.Boolean, keeps: opt(Schema.Number) })),
  session: opt(Schema.Struct({ provider: Provider, id: Schema.String, usage: opt(Schema.Struct({ input: Schema.Number, output: Schema.Number, cached: opt(Schema.Number), costUsd: opt(Schema.Number) })) })),
  controls: opt(ThreadControls),
  agent: opt(AgentInfo),
  live: opt(LiveRun),
  setup: opt(WorktreeSetup),
  reviews: opt(Schema.Array(Review)),
  subagents: opt(Schema.Array(Subagent)),
  backgroundTasks: opt(Schema.Array(BackgroundTask)),
  queued: opt(Schema.Array(QueuedMessage)),
  queuePause: opt(Schema.Literals(['failed', 'interrupted', 'limit', 'restart'])),
  steering: opt(Schema.Array(PendingSteer)),
  isInterruptedToSend: opt(Schema.Literal(true)),
  isSettingsChat: opt(Schema.Literal(true)),
  seenActivity: opt(Schema.Number),
});
export type Thread = typeof Thread.Type;

export const ToolWidget = Schema.Struct({
  callId: Schema.String,
  options: opt(Schema.Array(Schema.Struct({ id: Schema.String, label: Schema.String }))),
  pick: opt(Schema.Literal('one')),
  isDestructive: opt(Schema.Boolean),
  isHandoff: opt(Schema.Boolean),
  edits: opt(Schema.Array(FileEdit)),
  notes: opt(Schema.Array(Schema.String)),
});

export const SettingsSuggestion = Schema.Struct({
  by: Author,
  reason: opt(Schema.String),
  changes: Schema.Array(Schema.Struct({ key: Schema.String, value: Schema.String, profileId: opt(Schema.String) })),
  addServer: opt(Schema.Struct({ profileId: Schema.String, provider: Provider, server: McpServerDef })),
  before: Schema.Record(Schema.String, Schema.String),
});

export const QueueKind = Schema.Literals(['approval', 'question', 'review', 'ci', 'collision', 'setting', 'run']);

export const QueueItem = Schema.Struct({
  id: Schema.String,
  kind: QueueKind,
  threadId: Schema.String,
  title: Schema.String,
  detail: Schema.String,
  code: opt(Schema.String),
  blocks: Schema.Struct({ steps: Schema.Number, threads: Schema.Number }),
  questions: opt(Schema.Array(AgentQuestion)),
  collision: opt(Schema.Struct({ otherThreadId: Schema.String, files: Schema.Array(Schema.String) })),
  requestId: opt(Schema.String),
  tool: opt(ToolWidget),
  settings: opt(SettingsSuggestion),
  ci: opt(Schema.Struct({ pr: Schema.Number, url: Schema.String, check: opt(Schema.Struct({ name: Schema.String, link: opt(Schema.String) })) })),
  createdAt: Schema.Number,
  isSeen: opt(Schema.Boolean),
});
export type QueueItem = typeof QueueItem.Type;
