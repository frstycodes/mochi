import type {
  AgentImage,
  AgentQuestion,
  BackgroundTaskKind,
  SubagentStatus,
  SwitchFrom,
  WorktreeSetup,
} from './host/types/agent.ts';
import type { AutofixEvent } from './git/autofix.ts';
import type { Mention } from './chat/mentions.ts';
import type { FileEdit } from './host/types/settings.ts';
import type { McpServerDef } from './settings/agentConfig.ts';
import type { ThreadControls } from './runtime/controls.ts';
import type { WorkspaceDraft } from './git/workspace.ts';
import type { Review } from './secondOpinion/verdict.ts';
import type { VizLanguage } from '@mochi/domain/viz/fence';
import type { PaneLayout } from './pane/layout.ts';
import { shallow as shallowEqual } from 'zustand/vanilla/shallow';
import { vizGalleryThread } from './viz/fixtures.ts';
import { longThreadFromUrl } from './longThread.ts';
import { claudeLimitThread, codexLimitThread } from './usage/limitDemo.ts';
export type Provider = 'claude' | 'codex';
export type Author = Provider | 'you' | 'harness';
export type StepStatus = 'done' | 'running' | 'ready' | 'blocked' | 'dropped';
export type ThreadStatus = 'running' | 'needs-you' | 'review' | 'settled';
export type LineSlot = 1 | 2 | 3 | 4 | 5;

/** One item of the agent's own to-do list, mirrored as it plans (`applyPlan`); never the goal, which is its criteria. */
export interface Step {
  id: string;
  title: string;
  status: StepStatus;
  addedAt: number;
  addedBy: Author;
  startedAt?: number;
  doneAt?: number;
  /** Wall-clock epoch ms of `startedAt`/`doneAt`, stamped from the agent action; demo steps have only Mochi's minute clock. */
  startedMs?: number;
  doneMs?: number;
  /** The turn ended with it still running: its clock stops here until the agent picks it up or finishes it. */
  stoppedAt?: number;
  stoppedMs?: number;
  droppedAt?: number;
  /** Why it's blocked or was dropped. */
  note?: string;
}

/** What done means for a goal: checkable (a command Mochi can run) or judged (a sentence). */
export interface Criterion {
  id: string;
  text: string;
  command?: string;
  /** The agent says it's met (`claim_criterion`), with one line of evidence; checking it is yours or Mochi's. */
  claim?: { evidence: string; at: number; by: Provider };
  /** Mochi ran `command` in the worktree when you asked; a failed check outweighs a claim. */
  check?: {
    status: 'running' | 'passed' | 'failed';
    at: number;
    ms?: number;
    output?: string;
  };
}

/** Met when its check passed. One with a command counts only then; one you judge also counts once the agent claims it or you confirm it. */
export const isMet = (c: Criterion, isConfirmed = false) =>
  c.check?.status === 'passed' || (!c.command && (!!c.claim || isConfirmed));

/** What the agent said at the end of a turn of work (`report_turn`): the judgment the transcript buries. */
export interface TurnReport {
  at: number;
  /** The turn it was made in: one past the last idle record's `turn`. Unset on reports saved before turns were counted. */
  turn?: number;
  by: Provider;
  decisions: string[];
  left: string[];
  /** The one thing that needs you, if anything. */
  question?: string;
  /** What changed, in your terms: the next-move card's opening lines. */
  summary?: string;
  /** The next move as one question naming the exact thing ("Commit the cookie fix and its test?"). */
  next?: string;
  /** The agent's answers to `next`, its pick first: the next-move card's buttons. */
  options?: NextOption[];
  /** Written before the agent read a message you sent into its turn: the card keeps it, muted, without its answers. */
  isSuperseded?: true;
  /** The activity's length when it was made, which places it in its turn. Unset on reports saved before it was recorded. */
  index?: number;
}

/** One button on the next-move card: `reply` goes to the agent as your message, or into the message box when `isDraft`, for you to finish. */
export interface NextOption {
  label: string;
  reply: string;
  isDraft?: boolean;
}

/** A goal the agent wrote after its first look: waiting for your Accept, or applied with an Undo (Settings › Goals and checks). */
export interface GoalProposal {
  goal: string;
  criteria: { text: string; command?: string }[];
  /** What the agent saw that makes this the goal, one line. */
  basis?: string;
  at: number;
  by: Provider;
  state: 'waiting' | 'accepted' | 'applied' | 'kept' | 'undone';
  /** The goal it replaces: struck through on the card, put back by Undo. */
  before: { goal: string; criteria: { text: string; command?: string }[] };
}

export interface IdleCheck {
  at: number;
  /** Counts the thread's ended turns; a report stamped with the same number is this turn's. `at` can't tell: it ticks once a minute. */
  turn?: number;
  /** Uncommitted files in the thread's folder; unset without one or until read. */
  uncommitted?: number;
  /** Checks, git status and the transcript audit are still coming in; the verdict reads Checking until they have. */
  isGathering?: boolean;
  /** Unset when no model could read the turn. */
  audit?: TurnAudit;
  /** Gap ids you accepted this turn. */
  accepted: string[];
  /** You said this turn got you what you wanted: what only you can check counts as met, until your next message. */
  isConfirmed?: boolean;
  /** You answered this turn's next-move card (or wrote instead); it stays in the chat as a record, not a card. */
  isMoveAnswered?: boolean;
}

/** What the agent's last turn says, read by a model: a question it asked in prose, things it says it didn't verify. */
export interface TurnAudit {
  question?: string;
  unverified: { text: string; quote: string }[];
}

/** Another thread doing the same work (`same`) or overlapping it (`related`), found when this goal was drafted. */
export interface Similar {
  threadId: string;
  relation: 'same' | 'related';
}

export interface Revision {
  n: number;
  at: number;
  label: string;
  by: Author;
  diff?: string[];
}

export interface ActivityEntry {
  at: number;
  who: Author;
  kind: 'message' | 'tool' | 'event' | 'reasoning' | 'subagent';
  text: string;
  /** A reply rewritten as bullets for you (Simplify). Display only: never sent to an agent. `rulesKey`: the settings it was made with. */
  simplified?: { text: string; rulesKey: string; isShown: boolean };
  /** Events only: the why, shown muted under the label. */
  detail?: string;
  seconds?: number;
  drift?: 'on-goal' | 'scope-add' | 'off-goal';
  /** The agent's id for a tool call, so its end can find the entry its start logged. */
  toolId?: string;
  /** Tool calls: the agent's own plain-language line for it, the command's output and exit code, an edit's unified diff. */
  description?: string;
  output?: string;
  exitCode?: number;
  patch?: string;
  /** Shell commands: the files the worktree changed in while it ran (`tool-files`). */
  files?: string[];
  /** Events only: the thread paused here on a usage limit; the latest such entry renders the live limit card while the pause lasts. */
  isLimit?: boolean;
  /** Events only: a Mochi widget asked here (`src/runtime/tools.ts`). Open, the queue item `id` renders in its place; closed, `text` is its one-line record. */
  card?: { id: string; isOpen: boolean };
  links?: WebLink[];
  /** Events only: what kind of action, for its icon (`EventLine`), and the page it happened on, shown as favicon and host. */
  glyph?: EventGlyph;
  site?: string;
  /** `subagent` entries: the row in `Thread.subagents` this one shows, where it was started. */
  subagentId?: string;
  /** Wall-clock milliseconds, stamped on live agents' entries; `at` is the app clock's minute. */
  ms?: number;
  /** Tool entries: the skill this call loaded. */
  skill?: string;
  /** Tool entries: the MCP server tool this call ran. */
  mcp?: McpCall;
  /** Your messages: it waited in the queue while the agent worked, and went out when its turn ended (or you sent it). */
  wasQueued?: boolean;
  /** Your messages: sent into a running turn, and placed where the agent read it. */
  isSeen?: true;
  /** Your messages: the verdict of a second opinion your agent asked for, sent on its own; the review's card renders here in its place. */
  secondOpinion?: { reviewId: string; provider: Provider };
  /** Your messages: the images sent with it, as `shownImage` gives them. Tool entries: images the call returned, as absolute paths. */
  images?: string[];
  /** Tool entries: the image this call made, shown as its own card in the transcript. */
  generated?: GeneratedImage;
  /** Tool entries: the MCP App view this call declared, shown as its own card after the call's group. */
  widget?: McpWidget;
  /** Events only: the file changes of the turn your message at activity index `start` began were undone, or put back. */
  turnUndo?: { start: number; isUndone: boolean };
  /** Events only: the turn ended here because you stopped it or it failed. */
  turnEnd?: 'interrupted' | 'failed';
  /** Events only: a next-move card you answered, kept where it was: its summary, its question and what you picked (none when you wrote instead). */
  nextMove?: { summary?: string; question: string; answer?: string };
  /** Messages: another thread's agent sent this (`send_to_thread`), not you. */
  from?: ThreadRef;
  /** Messages: an Auto-fix event Mochi sent the agent about one of the thread's PRs; `text` is the event, the row shows `title`. */
  autofix?: { kind: AutofixEvent['kind']; pr: number; title: string };
  /** Events only: a sub-thread handed its result back here. */
  subThread?: { threadId: string; title: string; text: string };
  /** Tool entries: the message this `send_to_thread` call delivered. */
  sent?: ThreadRef & { text: string };
  /** Events only: the harness compacted the conversation here. */
  compaction?: Compaction;
  /** Events only: the thread moved to the other agent here. */
  handoff?: Handoff;
  /** Events only: side work the agent suggested or asked about in this turn (`create_thread`), one card. */
  proposals?: ThreadProposal[];
}

/**
 * A thread the agent suggested (own_initiative: New thread / Do it here / Dismiss), a sub-thread was asked to start (user_asked: Start / Dismiss, as it
 * can't start threads itself), or the agent asked whether to start (offer: New thread / Do it here).
 * Nothing runs until it's started; a pending one expires after `PROPOSAL_TTL`.
 */
export interface ThreadProposal {
  /** The taskId the agent starts or withdraws it by. */
  id: string;
  initiation: 'offer' | 'own_initiative' | 'user_asked';
  title: string;
  /** The new thread's first prompt. */
  brief: string;
  state: 'pending' | 'started' | 'dismissed' | 'here';
  /** Dismissed by the agent: why it withdrew it. */
  reason?: string;
  /** Started: the thread it became. */
  threadId?: string;
  /** What starting it creates, resolved when the agent asked, so a click starts what the agent meant. */
  create: {
    provider: Provider;
    project: string | null;
    workspace?: WorkspaceDraft;
    controls?: ThreadControls;
    isLive: boolean;
    parent?: SubThreadLink;
  };
}

/** App-clock minutes: a week. */
export const PROPOSAL_TTL = 7 * 24 * 60;

/**
 * A handoff to the other agent: drafting while a model writes `prompt`, started once the new agent has it as its first message.
 * A provider switch is `pending` until your next message, `drafting` while Core writes the handoff that message starts `to` from,
 * then `started` with the context package it got as `prompt` and `contents` naming what the package holds.
 */
export interface Handoff {
  from: Provider;
  to: Provider;
  status: 'drafting' | 'pending' | 'started' | 'failed';
  prompt?: string;
  /** Why `prompt` is the local summary instead of a model's draft. */
  fallback?: 'timeout' | 'error';
  error?: string;
  /** A provider switch, not a handoff: `drafting` while Core writes its handoff at your next message. */
  isSwitch?: true;
  /** A switch: the model `from` ran ('' its default); unset on rows from before it was recorded. */
  fromModel?: string;
  /** A switch: who wrote the handoff the new session got; unset when it went without one. */
  handoffBy?: Provider;
  /** A switch: the model `to` runs; unset runs its default. */
  model?: string;
  /** A switch: what the package held, `brief, 6 recent turns, 11.8k tokens`. */
  contents?: string;
}

/**
 * One compaction of a thread's conversation. `pins` and `hasGoal`: what Mochi asked it to keep. `focus`: what you typed after
 * `/compact`. Token counts as the harness reported them; Codex reports none after a compaction (0.155.1), so its rows carry no sizes.
 */
export interface Compaction {
  trigger: 'manual' | 'auto';
  status: 'running' | 'done' | 'failed';
  pins: number;
  hasGoal: boolean;
  focus?: string;
  preTokens?: number;
  postTokens?: number;
  summary?: string;
  error?: string;
}

/** Another thread, with its title when the entry was written; a renamed or deleted thread still reads. `threadId` is missing only on messages migrated from the old `From "…":` prefix whose sender is gone. */
export interface SubThreadLink {
  threadId: string;
  /** The parent's criterion this sub-thread covers; handing back claims it. Unset when nested by hand. */
  criterionId?: string;
  /** Its result went back to the parent (`subthread-handback`); the parent stops waiting on it. */
  handedBackAt?: number;
}

export interface ThreadRef {
  threadId?: string;
  title: string;
}

/** An image an agent generated. `src` is a file path or a data URL; `aspect` (width / height) is the size it asked for, square when unknown. */
export interface GeneratedImage {
  status: 'running' | 'done' | 'failed';
  prompt?: string;
  src?: string;
  aspect?: number;
  /** Why it failed, as the harness said it. */
  error?: string;
}

export interface McpCall {
  server: string;
  tool: string;
  /** The connector account it acted as, when the profile has several on the server (`__mochi_account`). */
  account?: string;
}

/**
 * An MCP Apps (SEP-1865) view a tool call declared: its `ui://` resource on `server`, with the call's input and result to
 * hand it. `server` is the name the harness reports, for reading the resource back.
 */
export interface McpWidget {
  server: string;
  uri: string;
  input: Record<string, unknown>;
  result: McpWidgetResult;
}

/** GAP: image blocks are left out (they're saved as the call's `images`); a view that draws from them gets text only. */
// A type, not an interface: it's handed to `AppBridge.sendToolResult`, whose param has an index signature an interface can't meet.
export type McpWidgetResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
};

/** A `ui://` resource as read: the view's HTML and the sandbox it asks for (`_meta.ui.csp`, `_meta.ui.permissions`). */
export interface McpWidgetResource {
  html: string;
  meta?: Record<string, unknown>;
}

/** The icon an action's line in a thread gets; everything else keeps the flag. */
export type EventGlyph = 'click' | 'type' | 'browse';

export interface WebLink {
  url: string;
  title?: string;
}

/** What you first asked: the agent's opening prompt and a schedule's default, whatever the goal became. */
/** Shown with the other threads (sidebar, palette, queue, list_threads); a settings chat lives only in Settings. */
export const isListed = (thread: Thread) => !thread.isSettingsChat;

/** A live thread keeps `running` between turns; only its agent knows whether it's working. Demo threads run while their status says so. */
export function isWorking(thread: Thread) {
  return thread.live ? thread.live.isWorking : thread.status === 'running';
}

/** The same thread but for what an agent's events stream into it: its transcript and the seq of the last event applied. */
export function isStreamedOnly(a: Thread, b: Thread) {
  const keys = Object.keys(a) as (keyof Thread)[];
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(
    (k) =>
      k === 'activity' ||
      Object.is(a[k], b[k]) ||
      (k === 'live' &&
        shallowEqual({ ...a.live, eventSeq: 0 }, { ...b.live, eventSeq: 0 })),
  );
}

export function firstPrompt(thread: Thread) {
  return (
    thread.activity.find((e) => e.who === 'you' && e.kind === 'message')
      ?.text ?? thread.goal
  );
}

export function authorName(who: Author) {
  return { you: 'You', claude: 'Claude', codex: 'Codex', harness: 'Mochi' }[
    who
  ];
}

export interface Source {
  kind: 'link' | 'mcp' | 'file';
  label: string;
}

/** What the agent reports about its session: what it can reach, not what it used. Fields can arrive separately (Codex lists them after start), so each is optional. */
export interface AgentInfo {
  model?: string;
  effort?: string;
  cwd?: string;
  /** In the agent's own terms: Claude's permission mode, Codex's approval policy and sandbox. */
  permissionMode?: string;
  version?: string;
  tools?: string[];
  mcpServers?: McpServer[];
  skills?: string[];
  plugins?: { name: string; version?: string }[];
  slashCommands?: string[];
  /** The harness's built-ins, skills, and custom or plugin commands `/name` runs, with what they say about themselves. */
  commands?: AgentCommand[];
}

export interface AgentCommand {
  name: string;
  description: string;
  /** `<file> [--fix]`: what the command takes after its name. */
  argumentHint?: string;
  /** Codex: the skill's SKILL.md, which a turn names to run it. */
  path?: string;
  /** The harness's own command (`/compact`), not a skill or a user, plugin or MCP one. */
  builtin?: boolean;
}

export interface McpServer {
  name: string;
  status: 'connected' | 'pending' | 'needs-auth' | 'failed' | 'disabled';
  toolCount?: number;
  /** An http or SSE server's endpoint, whose site's favicon marks its calls. */
  url?: string;
}

export interface PullRequest {
  number: number;
  state: 'open' | 'merged' | 'draft' | 'closed';
  title: string;
  /** Live PRs from `gh`; the demo fixtures have none, so their rows don't open anything. */
  url?: string;
  /** Auto-fix is on (`src/git/autofix.ts`) since this epoch ms. */
  autofixSince?: number;
  /** Archive the thread once this and every other PR of it merged or closed (`src/git/autoArchive.ts`). */
  autoArchive?: boolean;
}

/**
 * `project` is the folder's name; `path` its absolute path, unset for the web build's fixture projects. A thread works in its own
 * worktree unless `mode` is `folder` (the project's own checkout, on `branch`). `base`: the branch a new worktree starts from and
 * the Changes tab diffs against, the default branch when unset. `isExisting`: `branch` is used as it is, checked out in the
 * worktree or switched to in the folder, instead of created.
 */
export interface Repo {
  /** The initial automatic name, eligible for renaming once the task has a summary. */
  autoBranch?: string;
  project: string;
  branch: string;
  path?: string;
  mode?: 'folder';
  base?: string;
  isExisting?: boolean;
  /** The checkout is on a detached HEAD: `branch` holds its short commit, shown as such, never as a branch name. */
  isDetached?: boolean;
}

export interface Thread {
  id: string;
  spaceId: string;
  /** null: a chat with no folder, so no files, branch or PRs. */
  repo: Repo | null;
  title: string;
  /** Renamed by you (or by the agent at your request), or titled by the agent that started it: a generated title never replaces it. */
  isTitleRenamed?: boolean;
  /** A model named the thread after its first exchange (the reactor's `title.generate`). */
  isTitleGenerated?: boolean;
  /** The drafted or edited outcome; '' while the thread has no goal (a question, a chat). */
  goal: string;
  criteria?: Criterion[];
  /** Open until you dismiss them on the goal card. */
  similar?: Similar[];
  /** A sub-thread: the thread it was started for or nested under, and the parent's criterion it covers when known. */
  parent?: SubThreadLink;
  /** You removed the goal: drafts don't bring it back, an edit does. */
  isGoalOff?: boolean;
  /** The latest `report`; a newer message from you starts a turn it no longer describes. */
  report?: TurnReport;
  /** What Mochi gathered when the agent last went idle; `src/goals/verdict.ts` reads it with the thread's own state. */
  idle?: IdleCheck;
  /** Where the latest turn began (an `activity` index) and whether another thread or an automated event began it, not you. */
  turn?: { start: number; isAgentDriven?: true };
  proposal?: GoalProposal;
  providers: Provider[];
  status: ThreadStatus;
  line: LineSlot;
  startedAt: number;
  steps: Step[];
  revisions: Revision[];
  activity: ActivityEntry[];
  prs: PullRequest[];
  sources: Source[];
  context: { used: number; max: number };
  orbitSlot?: number;
  /** Where its pin sorts among all your computers' pins (`pinOrderOf`); unset while unpinned. */
  pinOrder?: number;
  settledAt?: number;
  /** Wall-clock ms it settled (`markSettled`); `settledAt` is on the app clock. */
  settledMs?: number;
  /** `keeps`: drift suggestions you answered with Keep here; at `KEEPS_TO_MUTE` the guard mutes itself for the thread. */
  drift?: { isMuted: boolean; keeps?: number };
  session?: {
    provider: Provider;
    id: string;
    usage?: {
      input: number;
      output: number;
      cached?: number;
      costUsd?: number;
    };
  };
  controls?: ThreadControls;
  /** From the live agent's session start; reset each time a session (re)starts. */
  agent?: AgentInfo;
  /** Set when a real agent runs the thread (desktop); the demo adapter leaves it alone. */
  live?: LiveRun;
  /** Its new worktree's preparation before the agent's first turn; unset when there was nothing to prepare. */
  setup?: WorktreeSetup;
  /** Second opinions from the other provider, oldest first. */
  reviews?: Review[];
  /** Agents this thread's agent started, oldest first. */
  subagents?: Subagent[];
  /** Commands and other non-agent tasks its agent left running in the background, oldest first (`src/runtime/tasks.ts`). */
  backgroundTasks?: BackgroundTask[];
  /** Messages you wrote while the agent worked, sent one per turn end, first first (`src/chat/outbox.ts`). */
  queued?: QueuedMessage[];
  /** Why the queue stopped sending; cleared by your next send or Resume. */
  queuePause?: QueuePause;
  /** Messages you sent into the running turn that the agent hasn't read yet, oldest first; each joins `activity` where it was read. */
  steering?: PendingSteer[];
  /** You stopped the turn to send a waiting message now (`sendSteerNow`): its interrupted end doesn't pause the queue. */
  isInterruptedToSend?: true;
  /** The profile's settings chat (Settings › Ask Mochi): one per profile, never listed with the other threads (`isListed`). */
  isSettingsChat?: true;
  /** How many `activity` entries you had seen when you last had it open, on any device; more now is unread. */
  seenActivity?: number;
}

/** A message as you wrote it; references, skills and the drift verdict resolve when it's sent, not when it's queued. */
/** A message sent into a running turn, until the agent reads it: what Take back returns to the composer, and the entry it logs then. */
export interface PendingSteer {
  message: QueuedMessage;
  entry: ActivityEntry;
  /** The drift guard's why, for the off-goal line logged with the entry. */
  reason: string;
  /** The agent reported its turn while this waited: reading it makes that report one written before your message. */
  hasReportBefore?: true;
  /** Send now is taking it back: `pending` while the turn it was clicked in runs, `turn-ended` once that turn is over. */
  sendNow?: 'pending' | 'turn-ended';
}

export interface QueuedMessage {
  id: string;
  /** The text as typed: what the transcript shows, and what Edit puts back in the composer. */
  draft: string;
  /** Unset on messages queued before images were sent. */
  images?: SentImage[];
  mentions: Mention[];
  /** The text starts with a `/` command, so mention tags go after it. */
  isCommand: boolean;
  /** Skills typed as `/name` later in the text. */
  typedSkills: string[];
  /** You clicked Send now on it: it goes out through the queue but isn't marked as queued in the transcript. */
  isSentNow?: true;
}

/** An image you sent: what the agent gets, a small copy (`thumb`, a data URL), and where the original was kept (`original`). */
export interface SentImage extends AgentImage {
  thumb: string;
  /** A file path on desktop, the data URL in the web build; unset for images sent from a phone or before originals were kept. */
  original?: string;
}

export type QueuePause = 'failed' | 'interrupted' | 'limit' | 'restart';

/** A subagent of a thread: the harness's own (Claude Agent tool, Codex spawn) or a task delegated to another provider (`start_subagent`). */
export interface Subagent {
  id: string;
  /** `mochi`: a delegated task Mochi runs as a session of its own (`sessionId`), reporting back into this thread. */
  origin: 'native' | 'mochi';
  provider: Provider;
  name: string;
  prompt?: string;
  model?: string;
  toolId?: string;
  isBackground: boolean;
  status: SubagentStatus;
  /** Wall-clock ms, for elapsed time. */
  startedAt: number;
  endedAt?: number;
  tokens: number;
  activity?: string;
  steps: SubagentStep[];
  message?: string;
  result?: string;
  error?: string;
  /** Mochi agents: their session's thread id in `host.agent`. */
  sessionId?: string;
  /** Mochi agents: the folder they run in, and whether it is a worktree of their own (else the parent's, shared). */
  cwd?: string;
  hasOwnWorktree?: boolean;
  /** Mochi agents: it ended on its own and its report hasn't reached this thread's agent yet (`dueReports`). */
  isReportDue?: boolean;
}

export interface BackgroundTask {
  id: string;
  kind: BackgroundTaskKind;
  provider: Provider;
  title: string;
  command?: string;
  status: SubagentStatus;
  /** Wall-clock ms, for elapsed time. */
  startedAt: number;
  endedAt?: number;
  exitCode?: number;
  outputFile?: string;
}

export interface SubagentStep {
  id: string;
  text: string;
  isDone: boolean;
  description?: string;
  files?: string[];
  exitCode?: number;
  output?: string;
  patch?: string;
}

export interface LiveRun {
  isWorking: boolean;
  /** How the last turn ended, for an alert on another computer that only sees it stop working. */
  turnEnd?: 'done' | 'interrupted' | 'failed';
  /** Mochi launched this agent and it hasn't reported anything yet. */
  starting?: Provider;
  /** The folder the agent first started in; restarts reuse it, since Claude Code files a session's transcript under its folder. Unset for a folderless chat. */
  cwd?: string;
  /**
   * The account hit its usage limit. `isTurnHeld`: Claude Code holds the turn and continues it at the reset. Otherwise (Codex)
   * the turn ended and the thread waits for you to resume (`autoResume`: you chose Resume at reset), use an API key, or hand off.
   */
  limit?: {
    resetsAt?: string;
    label?: string;
    isTurnHeld?: boolean;
    autoResume?: boolean;
  };
  /** Restored after Mochi restarted: no agent process holds it, so the next message starts one with `resume`. */
  isDetached?: boolean;
  /** `seq` of the last agent event applied: after a window reload, main replays the ones after it. */
  eventSeq?: number;
  /** You chose to continue on your API key after a limit; it stays on the key until handed off. */
  isOnApiKey?: boolean;
  /** Codex compaction restore notes, sent to the agent ahead of your next message. */
  notes?: string[];
  /**
   * A chat rewind replaced the session: the next start forks it at `forkAt`, or starts fresh with the transcript up to the rewind as
   * `seed`. A provider switch: the next start runs `providers[0]`, and Core hands it the thread so far (`switchFrom` is the old one).
   */
  restart?: { forkAt: string } | { seed: string } | { switchFrom: SwitchFrom };
}

/** `run`: a scheduled or background run finished (`src/schedule`). */
export type QueueKind =
  | 'approval'
  | 'question'
  | 'review'
  | 'ci'
  | 'collision'
  | 'setting'
  | 'run';

export interface QueueItem {
  id: string;
  kind: QueueKind;
  threadId: string;
  title: string;
  detail: string;
  code?: string;
  blocks: { steps: number; threads: number };
  questions?: AgentQuestion[];
  /** Two live threads of one project edited the same files (repo-relative). */
  collision?: { otherThreadId: string; files: string[] };
  requestId?: string;
  /** A Mochi tool call waiting on this widget (`src/runtime/tools.ts`); `options` are checkboxes, all off by default. */
  tool?: ToolWidget;
  /** A `setting` card: settings an agent (or a blocked Mochi call) suggests, as live rows you change in place. */
  settings?: SettingsSuggestion;
  /** A `ci` card: the PR and the first failed check, whose log "Send failing log to agent" fetches. */
  ci?: { pr: number; url: string; check?: { name: string; link?: string } };
  createdAt: number;
  /** You looked at it, on any device. */
  isSeen?: boolean;
}

/** What a Mochi widget asks and waits on: a delete naming exactly what goes, or a browser escalation. */
export interface ToolWidget {
  callId: string;
  options?: { id: string; label: string }[];
  /** `options` are radio buttons: one must be picked. */
  pick?: 'one';
  isDestructive?: boolean;
  /** Something only you can do in the browser (a sign-in, a code); Mochi closes it itself once the page shows it's done. */
  isHandoff?: boolean;
  /** A config write's file diffs, secrets redacted (the card is saved with the thread). */
  edits?: FileEdit[];
  /** Mochi's own facts under the title, like which other profiles share the account. */
  notes?: string[];
}

/**
 * Settings shown as their real rows with a suggested value each. Nothing waits on it: the rows change settings live, and
 * Done closes it into a record of what changed while it was open.
 */
export interface SettingsSuggestion {
  by: Author;
  reason?: string;
  changes: { key: string; value: string; profileId?: string }[];
  /** An MCP server to add, filled into Settings' add form. */
  addServer?: { profileId: string; provider: Provider; server: McpServerDef };
  /** Each row's value when the widget opened, by `settingRef`, so Done can say what changed. */
  before: Record<string, string>;
}

/** One row of a settings suggestion: the key, in a profile for profile settings. */
export const settingRef = (change: { key: string; profileId?: string }) =>
  change.profileId ? `${change.profileId}/${change.key}` : change.key;

/** Mochi's own widgets render inline in the thread where the agent asked, not in the composer tray. */
export const isMochiCard = (item: QueueItem) =>
  !!item.tool || item.kind === 'setting';

/** The options of a lone single-choice question, the only kind a number key can answer. */
export function singleChoice(item: QueueItem) {
  const [question, ...rest] = item.questions ?? [];
  return question &&
    !rest.length &&
    !question.multiSelect &&
    question.options.length
    ? question.options
    : null;
}

export function answerText(answers: string[][]) {
  return answers
    .filter((a) => a.length)
    .map((a) => a.join(', '))
    .join(' · ');
}

export const PANE_TAB_KINDS = [
  'browser',
  'changes',
  'terminal',
  'files',
  'simulator',
  'ports',
  'sidechat',
  'agents',
  'visual',
  'artifacts',
  'pr',
] as const;
export type PaneTabKind = (typeof PANE_TAB_KINDS)[number];

export interface PaneTab {
  id: string;
  kind: PaneTabKind;
  title?: string;
  url?: string;
  file?: { path: string; line?: number };
  isPopped?: boolean;
  /** Agents tabs: the agent shown expanded, picked from the chat's "Open". */
  agentId?: string;
  /** Visual tabs: the chat visual's fence, rendered again here. */
  visual?: PaneVisual;
}

export interface PaneVisual {
  language: VizLanguage;
  code: string;
}

/** Kinds that keep several tabs in one pane, shown as tabs in its header; every other kind is one tab per thread. */
const MULTI_TAB_KINDS = new Set<PaneTabKind>(['browser', 'sidechat', 'visual']);

export const isMultiTab = (kind: PaneTabKind) => MULTI_TAB_KINDS.has(kind);

/** One pane per kind, laid out in `layout`; `isOpen` shows or hides them all without forgetting the layout. */
export interface Pane {
  threadId: string;
  isOpen: boolean;
  tabs: PaneTab[];
  /** The tab picked last, in whichever pane. */
  activeTab: string;
  layout?: PaneLayout;
  /** The tab each multi-tab pane shows. */
  shown?: Partial<Record<PaneTabKind, string>>;
  /** The browser tab the thread's agent last drove; it floats while the agent works and the tab is off screen. */
  drivenTab?: string;
  /** Counts requests to bring the pane in front, so a narrow window, which shows the pane in place of the chat by its own state, swaps to it. */
  reveals?: number;
}

export function seedPanes(): Pane[] {
  return [
    {
      threadId: 'adm',
      isOpen: true,
      activeTab: 'adm-browser',
      drivenTab: 'adm-browser',
      layout: { columns: [['browser']], focused: 'browser' },
      tabs: [
        {
          id: 'adm-browser',
          kind: 'browser',
          title: 'API usage',
          url: 'localhost:3000/admin/usage',
        },
        { id: 'adm-changes', kind: 'changes' },
      ],
    },
  ];
}

export const SPACE_ICON_NAMES = [
  'work',
  'home',
  'layers',
  'code',
  'book',
  'rocket',
  'coffee',
  'star',
] as const;
export type SpaceIconName = (typeof SPACE_ICON_NAMES)[number];

/** A profile. Its Claude Code and Codex accounts are linked by id in the desktop host (`AccountLinks`), not stored here. */
export interface Space {
  id: string;
  name: string;
  icon: SpaceIconName;
  /** GAP: demo plan names until usage reads the linked account's detected plan; empty for profiles made in Settings. */
  plans: Record<Provider, string>;
  /** The gh login this profile pushes and opens pull requests as (`login`, or `host/login` off github.com); empty means gh's active account and your own git credentials. */
  github: string;
  /** Claude Code's and Codex's own items this profile leaves out of Mochi threads, by `NativeItem.id`; the tools themselves keep loading them (PROFILES-UX.md). */
  nativeOff?: string[];
  /** What items that appear in a harness later do in this profile: load (the default) or arrive off ("Only what I add"). */
  nativeNew?: Partial<Record<Provider, 'on' | 'off'>>;
}

// Orbit's outer ring keeps slots 0, 4 and 6 for Queue, Board and New thread; pinned threads take the rest, in order.
export const PIN_SLOTS = [1, 2, 3, 5, 7];

export const NOW0 = 14 * 60 + 20;

/** The profiles a fresh install starts with; `src/profiles.ts` holds the live list. */
export const DEFAULT_SPACES: Space[] = [
  {
    id: 'latitude',
    name: 'Latitude',
    icon: 'work',
    plans: { claude: 'Team', codex: 'Business' },
    github: '',
  },
  {
    id: 'personal',
    name: 'Personal',
    icon: 'home',
    plans: { claude: 'Max', codex: 'Plus' },
    github: '',
  },
  {
    id: 'liane',
    name: 'Liane',
    icon: 'layers',
    plans: { claude: 'Max', codex: 'Plus' },
    github: '',
  },
];

function step(id: string, title: string, rest: Partial<Step> = {}): Step {
  return {
    id,
    title,
    status: 'ready',
    addedAt: 0,
    addedBy: 'harness',
    ...rest,
  };
}

function at(start: number, minutes: number) {
  return start + minutes;
}

function rateLimiting(): Thread {
  const s = 710;
  return {
    id: 'rl',
    spaceId: 'latitude',
    repo: { project: 'latitude', branch: 'feat/api-rate-limits' },
    title: 'Public API rate limiting',
    goal: 'Every public API key is rate limited by plan tier, with per-key overrides and clear 429s.',
    providers: ['claude'],
    status: 'running',
    line: 1,
    startedAt: s,
    orbitSlot: 1,
    revisions: [
      { n: 1, at: s, label: 'Goal set', by: 'you' },
      { n: 2, at: at(s, 92), label: 'Added per-key overrides', by: 'you' },
    ],
    steps: [
      step('rl1', 'Agree limit tiers per plan', {
        status: 'done',
        addedAt: s,
        startedAt: s,
        doneAt: at(s, 20),
        addedBy: 'claude',
      }),
      step('rl2', 'Design limits schema', {
        status: 'done',
        addedAt: s,
        startedAt: at(s, 20),
        doneAt: at(s, 58),
        addedBy: 'claude',
      }),
      step('rl3', 'Rate limit by IP address', {
        status: 'dropped',
        addedAt: s,
        droppedAt: at(s, 64),
        addedBy: 'claude',
        note: 'Dropped: tiers decision limits API keys only',
      }),
      step('rl4', 'Wire limits into gateway config', {
        status: 'done',
        addedAt: s,
        startedAt: at(s, 58),
        doneAt: at(s, 84),
        addedBy: 'claude',
      }),
      step('rl5', 'Add Redis client', {
        status: 'running',
        addedAt: s,
        startedAt: at(s, 96),
        addedBy: 'claude',
      }),
      step('rl6', 'Token bucket middleware', { addedAt: s, addedBy: 'claude' }),
      step('rl7', 'Per-key overrides', { addedAt: at(s, 92), addedBy: 'you' }),
      step('rl8', 'Load test at 2k req/s', { addedAt: s, addedBy: 'claude' }),
      step('rl9', 'Document 429 responses', { addedAt: s, addedBy: 'claude' }),
    ],
    activity: [
      {
        at: s,
        who: 'you',
        kind: 'message',
        text: 'Rate limit the public API by plan tier. Free 60/min, Pro 600/min, Enterprise custom.',
      },
      {
        at: at(s, 1),
        who: 'claude',
        kind: 'reasoning',
        seconds: 11,
        text: 'Every public route already requires an API key, so limiting by key is stricter than by IP and avoids punishing shared NAT addresses. A token bucket in Redis keeps limits consistent across the 4 API instances; an in-memory limiter would let each instance allow the full rate.',
      },
      {
        at: at(s, 2),
        who: 'claude',
        kind: 'message',
        text: 'Plan: tiers doc, schema, gateway wiring, Redis-backed token bucket, load test, docs. I will rate limit by API key, not IP, since every public route needs a key.',
      },
      {
        at: at(s, 92),
        who: 'you',
        kind: 'message',
        text: 'Also add per-key overrides, sales wants to raise limits for a few customers.',
      },
      {
        at: at(s, 93),
        who: 'harness',
        kind: 'event',
        text: 'Goal v2: added per-key overrides',
      },
      {
        at: at(s, 94),
        who: 'claude',
        kind: 'tool',
        text: 'Skill sizing-the-change',
        skill: 'sizing-the-change',
      },
      {
        at: at(s, 94),
        who: 'claude',
        kind: 'tool',
        text: 'Mcp linear: get_issue',
        mcp: { server: 'linear', tool: 'get_issue' },
      },
      {
        at: at(s, 94),
        who: 'claude',
        kind: 'tool',
        text: 'Mcp mochi: get_goal',
        mcp: { server: 'mochi', tool: 'get_goal' },
      },
      {
        at: at(s, 94),
        who: 'claude',
        kind: 'tool',
        text: 'Mcp mochi: propose_goal',
        mcp: { server: 'mochi', tool: 'propose_goal' },
      },
      {
        at: at(s, 95),
        who: 'claude',
        kind: 'tool',
        text: 'Search redis token bucket rate limiter lua script atomic',
        links:
          DEMO_LINKS[
            'Search redis token bucket rate limiter lua script atomic'
          ],
      },
      {
        at: at(s, 95),
        who: 'claude',
        kind: 'tool',
        text: 'Fetch https://redis.io/docs/latest/develop/interact/programmability/eval-intro/',
        links:
          DEMO_LINKS[
            'Fetch https://redis.io/docs/latest/develop/interact/programmability/eval-intro/'
          ],
      },
      {
        at: at(s, 96),
        who: 'claude',
        kind: 'tool',
        text: 'Run REDIS_URL=redis://localhost:6379/0 RATE_LIMIT_TIERS=free:60,pro:600,enterprise:custom pnpm --filter @acme/api exec vitest run apps/api/middleware/__tests__/ratelimit.integration.test.ts apps/api/middleware/__tests__/ratelimit.overrides.test.ts --reporter=verbose --coverage.enabled --coverage.include=apps/api/middleware/ratelimit.ts',
      },
      {
        at: at(s, 96),
        who: 'claude',
        kind: 'tool',
        text: "Run node -e \"\\\n  const lua = require('fs').readFileSync('packages/cache/bucket.lua', 'utf8');\\\n  console.log(lua.length)\"",
      },
      {
        at: at(s, 96),
        who: 'claude',
        kind: 'tool',
        text: 'Read packages/cache/index.ts',
      },
      { at: at(s, 96), who: 'claude', kind: 'tool', text: 'Read src/logo.svg' },
      {
        at: at(s, 101),
        who: 'claude',
        kind: 'tool',
        text: 'Edit packages/cache/redis.ts  +38 −0',
      },
      {
        at: at(s, 104),
        who: 'claude',
        kind: 'tool',
        text: 'Run pnpm --filter cache test',
      },
      {
        at: at(s, 105),
        who: 'claude',
        kind: 'tool',
        text: 'Skill code-review',
        skill: 'code-review',
      },
      {
        at: at(s, 106),
        who: 'claude',
        kind: 'tool',
        text: 'Mcp mochi: send_to_thread',
        mcp: MOCHI_SEND,
        sent: {
          threadId: 'adm',
          title: 'Admin usage dashboard',
          text: LIMITS_NOTE,
        },
      },
      {
        at: at(s, 109),
        who: 'you',
        kind: 'message',
        text: USAGE_REPLY,
        from: { threadId: 'adm', title: 'Admin usage dashboard' },
      },
      {
        at: at(s, 110),
        who: 'claude',
        kind: 'message',
        text: 'Admin usage will badge overridden keys, so I will keep `override_rpm` nullable rather than defaulting it to the tier limit.',
      },
    ],
    prs: [],
    sources: [
      { kind: 'mcp', label: 'Linear · LAT-198 Rate limits' },
      { kind: 'file', label: 'docs/api/limits.md' },
      { kind: 'link', label: 'redis.io/docs/latest/develop/use/patterns' },
    ],
    context: { used: 84_000, max: 200_000 },
    // What @ offers with tool counts; no session, so the summary's live-agent sections stay hidden.
    agent: {
      mcpServers: [
        {
          name: 'linear',
          status: 'connected',
          toolCount: 23,
          url: 'https://mcp.linear.app/mcp',
        },
        { name: 'github', status: 'needs-auth' },
      ],
    },
  };
}

// The demo's two threads messaging each other (`send_to_thread`).
const MOCHI_SEND = { server: 'mochi', tool: 'send_to_thread' };
const LIMITS_NOTE =
  'Heads up: the limits table now has a `tier` column and a nullable `override_rpm` per key.\n\n- Read limits from `packages/db/schema/limits.ts` instead of hardcoding 60/600\n- Enterprise keys have no tier default, only an override';
const USAGE_REPLY =
  'Got it. The usage page now reads the limit per key and shows **Override** on keys with `override_rpm` set. Tell me if the column gets renamed.';

function adminDashboard(): Thread {
  const s = 770;
  return {
    id: 'adm',
    spaceId: 'latitude',
    repo: { project: 'latitude', branch: 'feat/admin-usage' },
    title: 'Admin usage dashboard',
    goal: 'Admins see API usage per key and per day, can export it, and the page stays fast at 10k keys.',
    providers: ['codex'],
    status: 'running',
    line: 2,
    startedAt: s,
    orbitSlot: 2,
    revisions: [{ n: 1, at: s, label: 'Goal set', by: 'you' }],
    steps: [
      step('ad1', 'Usage query endpoint', {
        status: 'done',
        addedAt: s,
        startedAt: s,
        doneAt: at(s, 38),
        addedBy: 'codex',
      }),
      step('ad2', 'Charts page', {
        status: 'running',
        addedAt: s,
        startedAt: at(s, 40),
        addedBy: 'codex',
      }),
      step('ad3', 'Export CSV', { addedAt: s, addedBy: 'codex' }),
      step('ad4', 'Empty and loading states', { addedAt: s, addedBy: 'codex' }),
    ],
    activity: [
      {
        at: s,
        who: 'you',
        kind: 'message',
        text: 'Build the admin usage dashboard. Per key, per day, exportable. It has to stay fast at 10k keys.',
      },
      {
        at: at(s, 1),
        who: 'codex',
        kind: 'tool',
        text: 'Skill ui',
        skill: 'ui',
      },
      {
        at: at(s, 1),
        who: 'codex',
        kind: 'tool',
        text: 'Mcp linear: get_issue',
        mcp: { server: 'linear', tool: 'get_issue' },
      },
      {
        at: at(s, 1),
        who: 'codex',
        kind: 'tool',
        text: 'Read packages/db/schema/usage.ts',
      },
      {
        at: at(s, 1),
        who: 'codex',
        kind: 'tool',
        text: 'Read apps/web/components/charts/BarChart.tsx',
      },
      {
        at: at(s, 2),
        who: 'codex',
        kind: 'reasoning',
        seconds: 14,
        text: 'api_usage_daily is append-only and partitioned by day, so grouping by key and day is cheap if the query filters on the partition first. Offset pagination would drift while new rows land; a (key_id, day) cursor stays stable at 10k keys.',
      },
      {
        at: at(s, 2),
        who: 'codex',
        kind: 'message',
        text: 'Plan:\n1. Usage endpoint that aggregates api_usage_daily by key and day\n2. Charts page with a key filter and a 14-day range\n3. CSV export streaming from the same query\n4. Empty and loading states\n\nI will reuse BarChart and the date range picker from settings instead of adding a chart library.',
      },
      {
        at: at(s, 9),
        who: 'you',
        kind: 'message',
        text: 'Good. Keep the endpoint paginated, some customers have thousands of keys.',
      },
      {
        at: at(s, 10),
        who: 'codex',
        kind: 'tool',
        text: 'Write apps/api/routes/admin/usage.ts  +18 −0',
      },
      {
        at: at(s, 24),
        who: 'codex',
        kind: 'tool',
        text: 'Run pnpm --filter api test usage',
      },
      {
        at: at(s, 38),
        who: 'codex',
        kind: 'message',
        text: 'Endpoint is done and paginated by cursor. p95 is 140ms on the 10k-key seed database. Setup notes are in `README.md`, the page mounts from `src/App.tsx` and the scripts live in `package.json`. Moving on to the charts page.',
      },
      {
        at: at(s, 39),
        who: 'codex',
        kind: 'message',
        text: 'Related work: #45 is open, #49 is still a draft, #47 merged and #30 was closed. #46 has conflicts with main and #48 is failing CI. Issues: #12 is open, #9 was fixed, #8 closed as not planned, and #999 is one gh cannot read. Upstream there is vercel/streamdown#120 and https://github.com/frstycodes/mochi/pull/45. The header lives in src/App.tsx:3 and styles in [the stylesheet](src/index.css); src/missing.ts stays plain, and this is our #1 priority. On GitHub: frstycodes/mochi#45, frstycodes/mochi#47, frstycodes/mochi#7 and frstycodes/mochi#50.',
      },
      {
        at: at(s, 40),
        who: 'harness',
        kind: 'event',
        text: 'Finished "Usage query endpoint"',
      },
      {
        at: at(s, 41),
        who: 'codex',
        kind: 'tool',
        text: 'Skill dataviz',
        skill: 'dataviz',
      },
      {
        at: at(s, 41),
        who: 'codex',
        kind: 'tool',
        text: 'Skill ui',
        skill: 'ui',
      },
      {
        at: at(s, 42),
        who: 'codex',
        kind: 'tool',
        text: 'Mcp figma: get_design_context',
        mcp: { server: 'figma', tool: 'get_design_context' },
      },
      {
        at: at(s, 42),
        who: 'codex',
        kind: 'tool',
        text: 'Mcp figma: get_screenshot',
        mcp: { server: 'figma', tool: 'get_screenshot' },
      },
      {
        at: at(s, 44),
        who: 'codex',
        kind: 'tool',
        text: 'Edit apps/web/routes/admin/usage.tsx  +120 −4',
      },
      {
        at: at(s, 45),
        who: 'you',
        kind: 'message',
        text: LIMITS_NOTE,
        from: { threadId: 'rl', title: 'Public API rate limiting' },
      },
      {
        at: at(s, 46),
        who: 'codex',
        kind: 'tool',
        text: 'Read packages/db/schema/limits.ts',
      },
      {
        at: at(s, 47),
        who: 'codex',
        kind: 'tool',
        text: 'Mcp mochi: send_to_thread',
        mcp: MOCHI_SEND,
        sent: {
          threadId: 'rl',
          title: 'Public API rate limiting',
          text: USAGE_REPLY,
        },
      },
    ],
    prs: [],
    sources: [
      { kind: 'mcp', label: 'Linear · LAT-212 Admin usage' },
      { kind: 'mcp', label: 'Figma · Admin / Usage' },
      { kind: 'file', label: 'packages/db/schema/usage.ts' },
    ],
    context: { used: 121_000, max: 272_000 },
  };
}

function flakyCheckout(): Thread {
  const s = 805;
  return {
    id: 'e2e',
    spaceId: 'latitude',
    repo: { project: 'latitude', branch: 'fix/checkout-e2e' },
    title: 'Fix flaky checkout e2e',
    goal: 'checkout.spec passes 20 runs in a row in CI.',
    providers: ['codex'],
    status: 'needs-you',
    line: 3,
    startedAt: s,
    revisions: [{ n: 1, at: s, label: 'Goal set', by: 'you' }],
    steps: [
      step('e1', 'Reproduce in CI', {
        status: 'done',
        addedAt: s,
        startedAt: s,
        doneAt: at(s, 22),
        addedBy: 'codex',
      }),
      step('e2', 'Isolate the flaky assertion', {
        status: 'done',
        addedAt: s,
        startedAt: at(s, 22),
        doneAt: at(s, 48),
        addedBy: 'codex',
      }),
      step('e3', 'Stabilize Stripe webhook timing', {
        status: 'blocked',
        addedAt: s,
        startedAt: at(s, 48),
        addedBy: 'codex',
        note: 'Waiting on your answer',
      }),
      step('e4', 'Run 20× in CI', { addedAt: s, addedBy: 'codex' }),
    ],
    activity: [
      {
        at: s,
        who: 'you',
        kind: 'message',
        text: 'checkout.spec fails about 1 in 6 runs on CI only. Find out why and fix it.',
      },
      {
        at: at(s, 2),
        who: 'codex',
        kind: 'tool',
        text: 'Read e2e/checkout.spec.ts',
      },
      {
        at: at(s, 3),
        who: 'codex',
        kind: 'tool',
        text: 'Read e2e/fixtures/stripe.ts',
      },
      {
        at: at(s, 4),
        who: 'codex',
        kind: 'tool',
        text: 'Skill run',
        skill: 'run',
      },
      {
        at: at(s, 5),
        who: 'codex',
        kind: 'tool',
        text: 'Run pnpm e2e checkout.spec --repeat-each 6',
      },
      {
        at: at(s, 47),
        who: 'codex',
        kind: 'message',
        text: 'The flake is the Stripe webhook arriving after the success page asserts. I can either stub webhooks in e2e, or record real fixtures and replay them. Which do you prefer?',
      },
    ],
    prs: [],
    sources: [
      {
        kind: 'link',
        label: 'github.com/latitude-media/latitude/actions/runs/1182',
      },
    ],
    context: { used: 46_000, max: 272_000 },
  };
}

function authMigration(): Thread {
  const s = 560;
  const done = (id: string, title: string, a: number, b: number) =>
    step(id, title, {
      status: 'done',
      addedAt: s,
      startedAt: at(s, a),
      doneAt: at(s, b),
      addedBy: 'claude',
    });
  return {
    id: 'auth',
    spaceId: 'latitude',
    repo: { project: 'latitude', branch: 'feat/better-auth' },
    title: 'Migrate auth to Better Auth',
    goal: 'All sign-in paths run on Better Auth, existing sessions survive, old auth code is deleted.',
    providers: ['claude', 'codex'],
    status: 'review',
    line: 4,
    startedAt: s,
    orbitSlot: 3,
    revisions: [
      { n: 1, at: s, label: 'Goal set', by: 'you' },
      { n: 2, at: at(s, 140), label: 'Split into two PRs', by: 'claude' },
    ],
    steps: [
      done('au1', 'Install and configure Better Auth', 0, 25),
      done('au2', 'Port email + password sign-in', 25, 70),
      done('au3', 'Port GitHub OAuth', 70, 110),
      done('au4', 'Session schema migration', 110, 150),
      done('au5', 'Second opinion review (Codex)', 150, 175),
      step('au6', 'Backfill existing sessions', {
        status: 'blocked',
        addedAt: at(s, 140),
        startedAt: at(s, 230),
        addedBy: 'claude',
        note: 'Waiting for approval to run a migration',
      }),
      done('au7', 'Delete legacy auth module', 180, 205),
    ],
    activity: [
      {
        at: s,
        who: 'you',
        kind: 'message',
        text: 'Move us to Better Auth. Keep sessions alive.',
      },
      {
        at: at(s, 150),
        who: 'harness',
        kind: 'event',
        text: 'Sent diff to Codex for a second opinion',
      },
      {
        at: at(s, 174),
        who: 'codex',
        kind: 'message',
        text: 'Review: cookie name changed, which logs everyone out. Keep `latitude.sid` or the backfill is pointless.',
      },
      {
        at: at(s, 176),
        who: 'claude',
        kind: 'message',
        text: 'Good catch, kept the old cookie name and added a test.',
      },
      {
        at: at(s, 231),
        who: 'claude',
        kind: 'message',
        text: 'Ready to run the session backfill against local Postgres. Needs your approval.',
      },
    ],
    prs: [
      { number: 479, state: 'merged', title: 'Better Auth core' },
      {
        number: 482,
        state: 'open',
        title: 'Session backfill + legacy removal',
      },
      {
        number: 484,
        state: 'open',
        title: 'Keep the latitude.sid cookie name',
      },
      { number: 485, state: 'draft', title: 'Passkeys on the login page' },
      { number: 487, state: 'open', title: 'Docs: migrating to Better Auth' },
    ],
    sources: [
      {
        kind: 'link',
        label: 'better-auth.com/docs/concepts/session-management',
      },
      { kind: 'file', label: 'apps/api/legacy-auth/' },
    ],
    context: { used: 168_000, max: 200_000 },
  };
}

function onboardingEmails(): Thread {
  const s = 300;
  return {
    id: 'onb',
    spaceId: 'latitude',
    repo: { project: 'latitude', branch: 'feat/onboarding-emails' },
    title: 'Onboarding emails',
    goal: 'New workspaces get a 3-email onboarding sequence.',
    providers: ['claude'],
    status: 'settled',
    line: 5,
    startedAt: s,
    revisions: [{ n: 1, at: s, label: 'Goal set', by: 'you' }],
    steps: [
      step('o1', 'Email templates', {
        status: 'done',
        addedAt: s,
        startedAt: s,
        doneAt: at(s, 40),
        addedBy: 'claude',
      }),
      step('o2', 'Schedule sequence', {
        status: 'done',
        addedAt: s,
        startedAt: at(s, 40),
        doneAt: at(s, 90),
        addedBy: 'claude',
      }),
    ],
    activity: [],
    prs: [{ number: 471, state: 'merged', title: 'Onboarding sequence' }],
    sources: [],
    context: { used: 52_000, max: 200_000 },
  };
}

function simpleThread(
  id: string,
  spaceId: string,
  project: string | null,
  title: string,
  provider: Provider,
  line: LineSlot,
  s: number,
  titles: string[],
  doneCount: number,
  slot?: number,
): Thread {
  return {
    id,
    spaceId,
    repo: project ? { project, branch: `feat/${id}` } : null,
    title,
    goal: title,
    providers: [provider],
    status: 'running',
    line,
    startedAt: s,
    orbitSlot: slot,
    revisions: [{ n: 1, at: s, label: 'Goal set', by: 'you' }],
    steps: titles.map((t, i) => {
      const base = step(`${id}${i}`, t, { addedAt: s, addedBy: provider });
      if (i < doneCount)
        return {
          ...base,
          status: 'done',
          startedAt: s + i * 30,
          doneAt: s + (i + 1) * 30,
        };
      if (i === doneCount)
        return { ...base, status: 'running', startedAt: s + i * 30 };
      return base;
    }),
    activity: [{ at: s, who: 'you', kind: 'message', text: title }],
    prs: [],
    sources: [],
    context: { used: 30_000, max: 200_000 },
  };
}

export function seedThreads(): Thread[] {
  return [
    rateLimiting(),
    claudeLimitThread(),
    adminDashboard(),
    flakyCheckout(),
    authMigration(),
    onboardingEmails(),
    vizGalleryThread(),
    simpleThread(
      'lobby',
      'personal',
      'map-veto',
      'Realtime veto lobby',
      'claude',
      1,
      700,
      [
        'Presence channel',
        'Lobby state machine',
        'Veto turn timer',
        'Reconnect handling',
      ],
      2,
      1,
    ),
    codexLimitThread(),
    simpleThread(
      'timer',
      'personal',
      'focus-mode',
      'Sync timer across devices',
      'codex',
      2,
      760,
      ['CRDT timer state', 'Sync over relay', 'Conflict UI'],
      1,
    ),
    simpleThread(
      'queues',
      'personal',
      null,
      'Compare Postgres job queues',
      'claude',
      3,
      790,
      ['Collect the options', 'Compare tradeoffs'],
      1,
    ),
    simpleThread(
      'cfg',
      'liane',
      'liane',
      'Per-space config dirs',
      'claude',
      1,
      720,
      [
        'Materialize CODEX_HOME per space',
        'Materialize CLAUDE_CONFIG_DIR per space',
        'Stop global writes',
        'Migration for existing users',
      ],
      1,
      1,
    ),
    simpleThread(
      'tele',
      'liane',
      'liane',
      'Skill telemetry',
      'codex',
      2,
      800,
      ['Log skill loads per thread', 'Dead skill report'],
      0,
    ),
    ...[longThreadFromUrl()].filter((t) => !!t),
  ];
}

export function seedQueue(): QueueItem[] {
  return [
    {
      id: 'q-approve',
      kind: 'approval',
      threadId: 'auth',
      title: 'Run the session backfill',
      detail:
        'Claude wants to run a script that rewrites 18,204 rows in the local sessions table.',
      code: 'pnpm tsx scripts/backfill-sessions.ts --db local',
      blocks: { steps: 1, threads: 1 },
      createdAt: NOW0 - 9,
    },
    {
      id: 'q-question',
      kind: 'question',
      threadId: 'e2e',
      title: 'Answer 2 questions',
      detail:
        'The flake is the webhook landing after the success page asserts. Stubbing is faster; recorded fixtures catch payload changes.',
      questions: [
        {
          text: 'Stub Stripe webhooks or record fixtures?',
          options: ['Stub webhooks', 'Record fixtures'],
          multiSelect: false,
        },
        {
          text: 'Which checkout flows should the e2e suite cover?',
          options: ['One-time payment', 'Subscription', 'Refund', '3-D Secure'],
          multiSelect: true,
        },
      ],
      blocks: { steps: 2, threads: 1 },
      createdAt: NOW0 - 17,
    },
    {
      id: 'q-review',
      kind: 'review',
      threadId: 'auth',
      title: 'Review PR #482',
      detail:
        'Session backfill and legacy removal. 14 files, +612 −389. Codex already reviewed it once.',
      blocks: { steps: 0, threads: 1 },
      createdAt: NOW0 - 30,
    },
  ];
}

export const FAKE_TOOLS: Record<string, string[]> = {
  rl5: [
    'Search ioredis cluster evalsha NOSCRIPT retry',
    'Run pnpm --filter cache add ioredis',
    'Search upstash ratelimit sliding window vs token bucket',
    'Read packages/cache/index.ts',
    'Read src/logo.svg',
    'Run REDIS_URL=redis://localhost:6379/0 RATE_LIMIT_TIERS=free:60,pro:600,enterprise:custom pnpm --filter @acme/api exec vitest run apps/api/middleware/__tests__/ratelimit.integration.test.ts apps/api/middleware/__tests__/ratelimit.overrides.test.ts --reporter=verbose --coverage.enabled --coverage.include=apps/api/middleware/ratelimit.ts',
    'Search redis token bucket rate limiter lua script atomic',
    'Edit packages/cache/redis.ts  +12 −2',
    'Fetch https://redis.io/docs/latest/develop/interact/programmability/eval-intro/',
    'Run pnpm --filter cache test',
    'Read packages/cache/index.ts',
    'Edit packages/cache/index.ts  +4 −0',
  ],
  rl6: [
    'Write apps/api/middleware/ratelimit.ts',
    'Edit apps/api/gateway.ts  +6 −1',
    'Run pnpm --filter api test ratelimit',
  ],
  rl7: [
    'Edit packages/db/schema/limits.ts  +14 −0',
    'Edit apps/api/middleware/ratelimit.ts  +22 −3',
  ],
  rl8: [
    'Write scripts/load/ratelimit.k6.js',
    'Run k6 run scripts/load/ratelimit.k6.js',
  ],
  ad2: [
    'Search upstash ratelimit sliding window vs token bucket',
    'Edit apps/web/routes/admin/usage.tsx  +48 −10',
    'Search ioredis cluster evalsha NOSCRIPT retry',
    'Read apps/api/routes/admin/usage.ts',
    'Run pnpm --filter web typecheck',
  ],
  ad3: [
    'Write apps/api/routes/admin/usage.csv.ts',
    'Run pnpm --filter api test usage',
  ],
  ad4: ['Edit apps/web/routes/admin/usage.tsx  +30 −2'],
};

/** What the demo's web searches and fetches return, keyed by the tool line. Worst case on purpose: long titles, a domain with no favicon, a dozen hits. */
export const DEMO_LINKS: Record<string, WebLink[]> = {
  'Search redis token bucket rate limiter lua script atomic': [
    {
      url: 'https://redis.io/glossary/rate-limiting/',
      title:
        'Rate Limiting with Redis: token bucket, sliding window and fixed window algorithms explained with examples',
    },
    {
      url: 'https://github.com/redis/redis/issues/8114',
      title:
        'EVALSHA with a token bucket script returns stale counts under MULTI',
    },
    {
      url: 'https://stackoverflow.com/questions/13175050/how-to-implement-rate-limiting-using-redis',
      title: 'How to implement rate limiting using Redis',
    },
    {
      url: 'https://blog.cloudflare.com/counting-things-a-lot-of-different-things/',
      title:
        'How we built rate limiting capable of scaling to millions of domains',
    },
    {
      url: 'https://stripe.com/blog/rate-limiters',
      title: 'Scaling your API with rate limiters',
    },
    {
      url: 'https://upstash.com/docs/redis/sdks/ratelimit-ts/algorithms',
      title: 'Ratelimiting algorithms',
    },
    {
      url: 'https://engineering.example-internal-wiki.invalid/limits',
      title: 'Internal: per-tier limits (no favicon here)',
    },
    {
      url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429',
      title: '429 Too Many Requests - HTTP | MDN',
    },
    { url: 'https://www.npmjs.com/package/rate-limiter-flexible' },
    {
      url: 'https://news.ycombinator.com/item?id=21378232',
      title: 'Ask HN: How do you rate limit an API at scale?',
    },
    {
      url: 'https://aws.amazon.com/builders-library/fairness-in-multi-tenant-systems/',
      title: 'Fairness in multi-tenant systems',
    },
    {
      url: 'https://en.wikipedia.org/wiki/Token_bucket',
      title: 'Token bucket - Wikipedia',
    },
  ],
  'Search stream large CSV export node fastify backpressure': [
    {
      url: 'https://nodejs.org/en/learn/modules/backpressuring-in-streams',
      title: 'Backpressuring in Streams | Node.js',
    },
    {
      url: 'https://github.com/fastify/fastify/issues/3360',
      title: 'Streaming a large CSV response with reply.send(stream)',
    },
    {
      url: 'https://www.npmjs.com/package/csv-stringify',
      title: 'csv-stringify',
    },
    {
      url: 'https://stackoverflow.com/questions/38788721/stream-csv-from-postgres',
      title: 'Stream CSV from Postgres to the client in Node',
    },
    {
      url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Disposition',
      title: 'Content-Disposition - HTTP | MDN',
    },
  ],
  'Search ioredis cluster evalsha NOSCRIPT retry': [
    {
      url: 'https://github.com/redis/ioredis/issues/536',
      title: 'Cluster: NOSCRIPT after failover, defineCommand does not reload',
    },
    {
      url: 'https://redis.io/docs/latest/commands/evalsha/',
      title: 'EVALSHA | Docs',
    },
    {
      url: 'https://stackoverflow.com/questions/36468713/redis-evalsha-noscript-in-cluster',
      title: 'Redis EVALSHA NOSCRIPT in cluster mode',
    },
    { url: 'https://www.npmjs.com/package/ioredis', title: 'ioredis' },
  ],
  'Search upstash ratelimit sliding window vs token bucket': [
    {
      url: 'https://upstash.com/blog/rate-limiting',
      title: 'Rate limiting your serverless applications',
    },
    {
      url: 'https://blog.bytebytego.com/p/rate-limiting-fundamentals',
      title: 'Rate limiting fundamentals',
    },
    {
      url: 'https://konghq.com/blog/engineering/how-to-design-a-scalable-rate-limiting-algorithm',
      title: 'How to design a scalable rate limiting algorithm',
    },
    {
      url: 'https://en.wikipedia.org/wiki/Token_bucket',
      title: 'Token bucket - Wikipedia',
    },
    {
      url: 'https://cloud.google.com/architecture/rate-limiting-strategies-techniques',
      title: 'Rate-limiting strategies and techniques',
    },
  ],
  'Fetch https://redis.io/docs/latest/develop/interact/programmability/eval-intro/':
    [
      {
        url: 'https://redis.io/docs/latest/develop/interact/programmability/eval-intro/',
        title: 'Scripting with Lua',
      },
    ],
};

export function genericTools(stepTitle: string) {
  return [`Read files for "${stepTitle}"`, 'Edit 2 files  +40 −6', 'Run tests'];
}
