import type { AgentQuestion, SubagentStatus } from './host/types/agent.ts';
import type { Mention } from './chat/mentions.ts';
import type { ThreadControls } from './runtime/controls.ts';
import type { Review } from './secondOpinion/verdict.ts';
import type { VizLanguage } from './viz/fence.ts';
import { vizGalleryThread } from './viz/fixtures.ts';
export type Provider = 'claude' | 'codex';
export type Author = Provider | 'you' | 'harness';
export type Size = 1 | 2 | 3;
export type StepStatus = 'done' | 'running' | 'ready' | 'waiting' | 'blocked' | 'dropped';
export type ThreadStatus = 'running' | 'needs-you' | 'review' | 'settled';
export type LineSlot = 1 | 2 | 3 | 4 | 5;

export type StepLink =
  | { mode: 'provided-by'; threadId: string; stepId: string }
  | { mode: 'provides-for'; threadIds: string[] }
  | { mode: 'race'; threadId: string; stepId: string }
  | { mode: 'related'; threadId: string; stepId: string };

export interface Step {
  id: string;
  title: string;
  size: Size;
  status: StepStatus;
  progress: number;
  footprint: string[];
  addedAt: number;
  addedBy: Author;
  revision: number;
  startedAt?: number;
  doneAt?: number;
  droppedAt?: number;
  note?: string;
  link?: StepLink;
  sharedKey?: string;
  gate?: boolean;
  acceptance?: { text: string; command?: string };
  owner?: Provider;
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
  /** Events only: a Mochi widget asked here (`src/runtime/tools.ts`). Open, the queue item `id` renders in its place; closed, `text` is its one-line record. */
  card?: { id: string; isOpen: boolean };
  links?: WebLink[];
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
}

export interface McpCall {
  server: string;
  tool: string;
}

export interface WebLink {
  url: string;
  title?: string;
}

export function authorName(who: Author) {
  return { you: 'You', claude: 'Claude', codex: 'Codex', harness: 'Mochi' }[who];
}

export interface Source {
  kind: 'link' | 'mcp' | 'file';
  label: string;
}

/** What the agent reports about its session: what it can reach, not what it used. Fields can arrive separately (Codex lists them after start), so each is optional. */
export interface AgentInfo {
  model?: string;
  cwd?: string;
  /** In the agent's own terms: Claude's permission mode, Codex's approval policy and sandbox. */
  permissionMode?: string;
  version?: string;
  tools?: string[];
  mcpServers?: McpServer[];
  skills?: string[];
  plugins?: { name: string; version?: string }[];
  slashCommands?: string[];
  /** Skills and custom or plugin commands `/name` runs, with what they say about themselves; the harness's built-ins left out. */
  commands?: AgentCommand[];
}

export interface AgentCommand {
  name: string;
  description: string;
  /** `<file> [--fix]`: what the command takes after its name. */
  argumentHint?: string;
  /** Codex: the skill's SKILL.md, which a turn names to run it. */
  path?: string;
}

export interface McpServer {
  name: string;
  status: 'connected' | 'pending' | 'needs-auth' | 'failed' | 'disabled';
  toolCount?: number;
}

export interface PullRequest {
  number: number;
  state: 'open' | 'merged' | 'draft';
  title: string;
  /** Live PRs from `gh`; the demo fixtures have none, so their rows don't open anything. */
  url?: string;
}

/**
 * `project` is the folder's name; `path` its absolute path, unset for the web build's fixture projects. A thread works in its own
 * worktree unless `mode` is `folder` (the project's own checkout, on `branch`). `base`: the branch a new worktree starts from and
 * the Changes tab diffs against, the default branch when unset. `isExisting`: `branch` is used as it is, checked out in the
 * worktree or switched to in the folder, instead of created.
 */
export interface Repo {
  project: string;
  branch: string;
  path?: string;
  mode?: 'folder';
  base?: string;
  isExisting?: boolean;
}

export interface Thread {
  id: string;
  spaceId: string;
  /** null: a chat with no folder, so no files, branch or PRs. */
  repo: Repo | null;
  title: string;
  goal: string;
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
  settledAt?: number;
  /** `keeps`: drift suggestions you answered with Keep here; at `KEEPS_TO_MUTE` the guard mutes itself for the thread. */
  drift?: { isMuted: boolean; keeps?: number };
  session?: { provider: Provider; id: string; usage?: { input: number; output: number; cached?: number; costUsd?: number } };
  controls?: ThreadControls;
  /** From the live agent's session start; reset each time a session (re)starts. */
  agent?: AgentInfo;
  /** Set when a real agent runs the thread (desktop); the demo adapter leaves it alone. */
  live?: LiveRun;
  /** Second opinions from the other provider, oldest first. */
  reviews?: Review[];
  /** Agents this thread's agent started, oldest first. */
  subagents?: Subagent[];
  /** Messages you wrote while the agent worked, sent one per turn end, first first (`src/chat/outbox.ts`). */
  queued?: QueuedMessage[];
  /** Why the queue stopped sending; cleared by your next send or Resume. */
  queuePause?: QueuePause;
}

/** A message as you wrote it; references, skills and the drift verdict resolve when it's sent, not when it's queued. */
export interface QueuedMessage {
  id: string;
  /** The text as typed: what the transcript shows, and what Edit puts back in the composer. */
  draft: string;
  files: number;
  mentions: Mention[];
  /** The text starts with a `/` command, so mention tags go after it. */
  isCommand: boolean;
}

export type QueuePause = 'failed' | 'interrupted' | 'limit' | 'restart';

/** A subagent of a thread: the harness's own (Claude Agent tool, Codex spawn) or a Mochi background agent (`start_background_agent`). */
export interface Subagent {
  id: string;
  /** `mochi`: a background agent Mochi runs as a session of its own (`sessionId`), reporting back into this thread. */
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
  /** Mochi launched this agent and it hasn't reported anything yet. */
  starting?: Provider;
  /** The folder the agent first started in; restarts reuse it, since Claude Code files a session's transcript under its folder. Unset for a folderless chat. */
  cwd?: string;
  /** The account hit its usage limit; the thread waits for you to resume, continue on an API key, or hand off. */
  limit?: { resetsAt?: string };
  /** Restored after Mochi restarted: no agent process holds it, so the next message starts one with `resume`. */
  isDetached?: boolean;
  /** You chose to continue on your API key after a limit; it stays on the key until handed off. */
  isOnApiKey?: boolean;
  /** Background agents' reports, sent to the agent ahead of your next message. */
  notes?: string[];
  /** Send now interrupted the turn for a queued message: the interrupted turn's end isn't the agent stopping, since it goes on with that message. */
  isReplacingTurn?: boolean;
}

/** `run`: a scheduled or background run finished (`src/schedule`). */
export type QueueKind = 'approval' | 'question' | 'review' | 'ci' | 'overlap' | 'setting' | 'run';

export interface QueueItem {
  id: string;
  kind: QueueKind;
  threadId: string;
  title: string;
  detail: string;
  code?: string;
  blocks: { steps: number; threads: number };
  questions?: AgentQuestion[];
  overlap?: { threadId: string; stepId: string; otherThreadId: string; otherStepId: string; sharedFiles: string[] };
  requestId?: string;
  /** A Mochi tool call waiting on this widget (`src/runtime/tools.ts`); `options` are checkboxes, all off by default. */
  tool?: ToolWidget;
  /** A `setting` card: the setting an agent (or a blocked Mochi call) put in front of you. */
  setting?: { id: string; suggested?: string };
  /** A `ci` card: the PR and the first failed check, whose log "Send failing log to agent" fetches. */
  ci?: { pr: number; url: string; check?: { name: string; link?: string } };
  createdAt: number;
}

/** What a Mochi widget asks: a setting change (current → `value`), a delete naming exactly what goes, or a browser escalation. */
export interface ToolWidget {
  callId: string;
  options?: { id: string; label: string }[];
  setting?: { id: string; value: string };
  isDestructive?: boolean;
}

/** Mochi's own widgets render inline in the thread where the agent asked, not in the composer tray. */
export const isMochiCard = (item: QueueItem) => !!item.tool || item.kind === 'setting';

/** The options of a lone single-choice question, the only kind a number key can answer. */
export function singleChoice(item: QueueItem) {
  const [question, ...rest] = item.questions ?? [];
  return question && !rest.length && !question.multiSelect && question.options.length ? question.options : null;
}

export function answerText(answers: string[][]) {
  return answers.filter((a) => a.length).map((a) => a.join(', ')).join(' · ');
}

export const PANE_TAB_KINDS = ['browser', 'changes', 'terminal', 'files', 'simulator', 'ports', 'sidechat', 'agents', 'visual', 'new'] as const;
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

export interface Pane {
  threadId: string;
  isOpen: boolean;
  tabs: PaneTab[];
  activeTab: string;
  /** The browser tab the thread's agent last drove; it floats while the agent works and the tab is off screen. */
  drivenTab?: string;
}

export function seedPanes(): Pane[] {
  return [
    {
      threadId: 'adm',
      isOpen: true,
      activeTab: 'adm-browser',
      drivenTab: 'adm-browser',
      tabs: [
        { id: 'adm-browser', kind: 'browser', title: 'API usage', url: 'localhost:3000/admin/usage' },
        { id: 'adm-changes', kind: 'changes' },
      ],
    },
  ];
}

export const SPACE_ICON_NAMES = ['work', 'home', 'layers', 'code', 'book', 'rocket', 'coffee', 'star'] as const;
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
  /** Saving instructions writes the same text to the Claude account's CLAUDE.md and the Codex account's AGENTS.md. */
  syncInstructions?: boolean;
}

// Orbit's outer ring keeps slots 0, 4 and 6 for Queue, Board and New thread; pinned threads take the rest, in order.
export const PIN_SLOTS = [1, 2, 3, 5, 7];

export const NOW0 = 14 * 60 + 20;

/** The profiles a fresh install starts with; `src/profiles.ts` holds the live list. */
export const DEFAULT_SPACES: Space[] = [
  { id: 'latitude', name: 'Latitude', icon: 'work', plans: { claude: 'Team', codex: 'Business' }, github: '' },
  { id: 'personal', name: 'Personal', icon: 'home', plans: { claude: 'Max', codex: 'Plus' }, github: '' },
  { id: 'liane', name: 'Liane', icon: 'layers', plans: { claude: 'Max', codex: 'Plus' }, github: '' },
];

function step(id: string, title: string, size: Size, footprint: string[], rest: Partial<Step> = {}): Step {
  return { id, title, size, status: 'ready', progress: 0, footprint, addedAt: 0, addedBy: 'harness', revision: 1, ...rest };
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
      step('rl1', 'Agree limit tiers per plan', 1, ['docs/api/limits.md'], { status: 'done', progress: 1, addedAt: s, startedAt: s, doneAt: at(s, 20), addedBy: 'claude' }),
      step('rl2', 'Design limits schema', 2, ['packages/db/schema/limits.ts'], { status: 'done', progress: 1, addedAt: s, startedAt: at(s, 20), doneAt: at(s, 58), addedBy: 'claude' }),
      step('rl3', 'Rate limit by IP address', 1, ['apps/api/middleware/ip.ts'], { status: 'dropped', addedAt: s, droppedAt: at(s, 64), addedBy: 'claude', note: 'Dropped: tiers decision limits API keys only' }),
      step('rl4', 'Wire limits into gateway config', 1, ['apps/api/gateway.ts'], { status: 'done', progress: 1, addedAt: s, startedAt: at(s, 58), doneAt: at(s, 84), addedBy: 'claude' }),
      step('rl5', 'Add Redis client', 2, ['packages/cache/redis.ts', 'packages/cache/index.ts'], { status: 'running', progress: 0.12, addedAt: s, startedAt: at(s, 96), addedBy: 'claude' }),
      step('rl6', 'Token bucket middleware', 3, ['apps/api/middleware/ratelimit.ts'], { addedAt: s, addedBy: 'claude' }),
      step('rl7', 'Per-key overrides', 2, ['packages/db/schema/limits.ts', 'apps/api/middleware/ratelimit.ts'], { addedAt: at(s, 92), addedBy: 'you', revision: 2 }),
      step('rl8', 'Load test at 2k req/s', 2, ['scripts/load/ratelimit.k6.js'], { addedAt: s, addedBy: 'claude' }),
      step('rl9', 'Document 429 responses', 1, ['docs/api/errors.md'], { addedAt: s, addedBy: 'claude' }),
    ],
    activity: [
      { at: s, who: 'you', kind: 'message', text: 'Rate limit the public API by plan tier. Free 60/min, Pro 600/min, Enterprise custom.' },
      { at: at(s, 1), who: 'claude', kind: 'reasoning', seconds: 11, text: 'Every public route already requires an API key, so limiting by key is stricter than by IP and avoids punishing shared NAT addresses. A token bucket in Redis keeps limits consistent across the 4 API instances; an in-memory limiter would let each instance allow the full rate.' },
      { at: at(s, 2), who: 'claude', kind: 'message', text: 'Plan: tiers doc, schema, gateway wiring, Redis-backed token bucket, load test, docs. I will rate limit by API key, not IP, since every public route needs a key.' },
      { at: at(s, 92), who: 'you', kind: 'message', text: 'Also add per-key overrides, sales wants to raise limits for a few customers.' },
      { at: at(s, 93), who: 'harness', kind: 'event', text: 'Goal v2: +1 step "Per-key overrides"' },
      { at: at(s, 94), who: 'claude', kind: 'tool', text: 'Skill sizing-the-change', skill: 'sizing-the-change' },
      { at: at(s, 94), who: 'claude', kind: 'tool', text: 'Mcp linear: get_issue', mcp: { server: 'linear', tool: 'get_issue' } },
      { at: at(s, 95), who: 'claude', kind: 'tool', text: 'Search redis token bucket rate limiter lua script atomic', links: DEMO_LINKS['Search redis token bucket rate limiter lua script atomic'] },
      { at: at(s, 95), who: 'claude', kind: 'tool', text: 'Fetch https://redis.io/docs/latest/develop/interact/programmability/eval-intro/', links: DEMO_LINKS['Fetch https://redis.io/docs/latest/develop/interact/programmability/eval-intro/'] },
      { at: at(s, 96), who: 'claude', kind: 'tool', text: 'Run REDIS_URL=redis://localhost:6379/0 RATE_LIMIT_TIERS=free:60,pro:600,enterprise:custom pnpm --filter @acme/api exec vitest run apps/api/middleware/__tests__/ratelimit.integration.test.ts apps/api/middleware/__tests__/ratelimit.overrides.test.ts --reporter=verbose --coverage.enabled --coverage.include=apps/api/middleware/ratelimit.ts' },
      { at: at(s, 96), who: 'claude', kind: 'tool', text: 'Run node -e "\\\n  const lua = require(\'fs\').readFileSync(\'packages/cache/bucket.lua\', \'utf8\');\\\n  console.log(lua.length)"' },
      { at: at(s, 96), who: 'claude', kind: 'tool', text: 'Read packages/cache/index.ts' },
      { at: at(s, 96), who: 'claude', kind: 'tool', text: 'Read src/logo.svg' },
      { at: at(s, 101), who: 'claude', kind: 'tool', text: 'Edit packages/cache/redis.ts  +38 −0' },
      { at: at(s, 104), who: 'claude', kind: 'tool', text: 'Run pnpm --filter cache test' },
      { at: at(s, 105), who: 'claude', kind: 'tool', text: 'Skill code-review', skill: 'code-review' },
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
        { name: 'linear', status: 'connected', toolCount: 23 },
        { name: 'github', status: 'needs-auth' },
      ],
    },
  };
}

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
      step('ad1', 'Usage query endpoint', 2, ['apps/api/routes/admin/usage.ts'], { status: 'done', progress: 1, addedAt: s, startedAt: s, doneAt: at(s, 38), addedBy: 'codex' }),
      step('ad2', 'Charts page', 3, ['apps/web/routes/admin/usage.tsx'], { status: 'running', progress: 0.7, addedAt: s, startedAt: at(s, 40), addedBy: 'codex' }),
      step('ad3', 'Export CSV', 1, ['apps/api/routes/admin/usage.csv.ts'], { addedAt: s, addedBy: 'codex' }),
      step('ad4', 'Empty and loading states', 1, ['apps/web/routes/admin/usage.tsx'], { addedAt: s, addedBy: 'codex' }),
    ],
    activity: [
      { at: s, who: 'you', kind: 'message', text: 'Build the admin usage dashboard. Per key, per day, exportable. It has to stay fast at 10k keys.' },
      { at: at(s, 1), who: 'codex', kind: 'tool', text: 'Skill ui', skill: 'ui' },
      { at: at(s, 1), who: 'codex', kind: 'tool', text: 'Mcp linear: get_issue', mcp: { server: 'linear', tool: 'get_issue' } },
      { at: at(s, 1), who: 'codex', kind: 'tool', text: 'Read packages/db/schema/usage.ts' },
      { at: at(s, 1), who: 'codex', kind: 'tool', text: 'Read apps/web/components/charts/BarChart.tsx' },
      { at: at(s, 2), who: 'codex', kind: 'reasoning', seconds: 14, text: 'api_usage_daily is append-only and partitioned by day, so grouping by key and day is cheap if the query filters on the partition first. Offset pagination would drift while new rows land; a (key_id, day) cursor stays stable at 10k keys.' },
      { at: at(s, 2), who: 'codex', kind: 'message', text: 'Plan:\n1. Usage endpoint that aggregates api_usage_daily by key and day\n2. Charts page with a key filter and a 14-day range\n3. CSV export streaming from the same query\n4. Empty and loading states\n\nI will reuse BarChart and the date range picker from settings instead of adding a chart library.' },
      { at: at(s, 9), who: 'you', kind: 'message', text: 'Good. Keep the endpoint paginated, some customers have thousands of keys.' },
      { at: at(s, 10), who: 'codex', kind: 'tool', text: 'Write apps/api/routes/admin/usage.ts  +18 −0' },
      { at: at(s, 24), who: 'codex', kind: 'tool', text: 'Run pnpm --filter api test usage' },
      { at: at(s, 38), who: 'codex', kind: 'message', text: 'Endpoint is done and paginated by cursor. p95 is 140ms on the 10k-key seed database. Setup notes are in `README.md`, the page mounts from `src/App.tsx` and the scripts live in `package.json`. Moving on to the charts page.' },
      { at: at(s, 39), who: 'codex', kind: 'message', text: 'Related work: #45 is open, #49 is still a draft, #47 merged and #30 was closed. #46 has conflicts with main and #48 is failing CI. Issues: #12 is open, #9 was fixed, #8 closed as not planned, and #999 is one gh cannot read. Upstream there is vercel/streamdown#120 and https://github.com/frstycodes/mochi/pull/45. The header lives in src/App.tsx:3 and styles in [the stylesheet](src/index.css); src/missing.ts stays plain, and this is our #1 priority. On GitHub: frstycodes/mochi#45, frstycodes/mochi#47, frstycodes/mochi#7 and frstycodes/mochi#50.' },
      { at: at(s, 40), who: 'harness', kind: 'event', text: 'Finished "Usage query endpoint"' },
      { at: at(s, 41), who: 'codex', kind: 'tool', text: 'Skill dataviz', skill: 'dataviz' },
      { at: at(s, 41), who: 'codex', kind: 'tool', text: 'Skill ui', skill: 'ui' },
      { at: at(s, 42), who: 'codex', kind: 'tool', text: 'Mcp figma: get_design_context', mcp: { server: 'figma', tool: 'get_design_context' } },
      { at: at(s, 42), who: 'codex', kind: 'tool', text: 'Mcp figma: get_screenshot', mcp: { server: 'figma', tool: 'get_screenshot' } },
      { at: at(s, 44), who: 'codex', kind: 'tool', text: 'Edit apps/web/routes/admin/usage.tsx  +120 −4' },
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
      step('e1', 'Reproduce in CI', 1, ['.github/workflows/e2e.yml'], { status: 'done', progress: 1, addedAt: s, startedAt: s, doneAt: at(s, 22), addedBy: 'codex' }),
      step('e2', 'Isolate the flaky assertion', 2, ['e2e/checkout.spec.ts'], { status: 'done', progress: 1, addedAt: s, startedAt: at(s, 22), doneAt: at(s, 48), addedBy: 'codex' }),
      step('e3', 'Stabilize Stripe webhook timing', 2, ['e2e/fixtures/stripe.ts'], { status: 'blocked', progress: 0.1, addedAt: s, startedAt: at(s, 48), addedBy: 'codex', note: 'Waiting on your answer' }),
      step('e4', 'Run 20× in CI', 1, ['.github/workflows/e2e.yml'], { addedAt: s, addedBy: 'codex' }),
    ],
    activity: [
      { at: s, who: 'you', kind: 'message', text: 'checkout.spec fails about 1 in 6 runs on CI only. Find out why and fix it.' },
      { at: at(s, 2), who: 'codex', kind: 'tool', text: 'Read e2e/checkout.spec.ts' },
      { at: at(s, 3), who: 'codex', kind: 'tool', text: 'Read e2e/fixtures/stripe.ts' },
      { at: at(s, 4), who: 'codex', kind: 'tool', text: 'Skill run', skill: 'run' },
      { at: at(s, 5), who: 'codex', kind: 'tool', text: 'Run pnpm e2e checkout.spec --repeat-each 6' },
      { at: at(s, 47), who: 'codex', kind: 'message', text: 'The flake is the Stripe webhook arriving after the success page asserts. I can either stub webhooks in e2e, or record real fixtures and replay them. Which do you prefer?' },
    ],
    prs: [],
    sources: [{ kind: 'link', label: 'github.com/latitude-media/latitude/actions/runs/1182' }],
    context: { used: 46_000, max: 272_000 },
  };
}

function authMigration(): Thread {
  const s = 560;
  const done = (id: string, title: string, size: Size, a: number, b: number, fp: string[]) =>
    step(id, title, size, fp, { status: 'done', progress: 1, addedAt: s, startedAt: at(s, a), doneAt: at(s, b), addedBy: 'claude' });
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
      done('au1', 'Install and configure Better Auth', 1, 0, 25, ['apps/api/auth.ts']),
      done('au2', 'Port email + password sign-in', 2, 25, 70, ['apps/api/auth.ts', 'apps/web/routes/login.tsx']),
      done('au3', 'Port GitHub OAuth', 2, 70, 110, ['apps/api/auth.ts']),
      done('au4', 'Session schema migration', 2, 110, 150, ['packages/db/migrations/0042_sessions.sql']),
      done('au5', 'Second opinion review (Codex)', 1, 150, 175, []),
      step('au6', 'Backfill existing sessions', 2, ['scripts/backfill-sessions.ts'], { status: 'blocked', progress: 0.2, addedAt: at(s, 140), revision: 2, startedAt: at(s, 230), addedBy: 'claude', note: 'Waiting for approval to run a migration' }),
      done('au7', 'Delete legacy auth module', 1, 180, 205, ['apps/api/legacy-auth/']),
    ],
    activity: [
      { at: s, who: 'you', kind: 'message', text: 'Move us to Better Auth. Keep sessions alive.' },
      { at: at(s, 150), who: 'harness', kind: 'event', text: 'Sent diff to Codex for a second opinion' },
      { at: at(s, 174), who: 'codex', kind: 'message', text: 'Review: cookie name changed, which logs everyone out. Keep `latitude.sid` or the backfill is pointless.' },
      { at: at(s, 176), who: 'claude', kind: 'message', text: 'Good catch, kept the old cookie name and added a test.' },
      { at: at(s, 231), who: 'claude', kind: 'message', text: 'Ready to run the session backfill against local Postgres. Needs your approval.' },
    ],
    prs: [
      { number: 479, state: 'merged', title: 'Better Auth core' },
      { number: 482, state: 'open', title: 'Session backfill + legacy removal' },
    ],
    sources: [
      { kind: 'link', label: 'better-auth.com/docs/concepts/session-management' },
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
      step('o1', 'Email templates', 2, ['emails/'], { status: 'done', progress: 1, addedAt: s, startedAt: s, doneAt: at(s, 40), addedBy: 'claude' }),
      step('o2', 'Schedule sequence', 2, ['apps/worker/onboarding.ts'], { status: 'done', progress: 1, addedAt: s, startedAt: at(s, 40), doneAt: at(s, 90), addedBy: 'claude' }),
    ],
    activity: [],
    prs: [{ number: 471, state: 'merged', title: 'Onboarding sequence' }],
    sources: [],
    context: { used: 52_000, max: 200_000 },
  };
}

function simpleThread(id: string, spaceId: string, project: string | null, title: string, provider: Provider, line: LineSlot, s: number, titles: string[], doneCount: number, slot?: number): Thread {
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
      const base = step(`${id}${i}`, t, 2, [], { addedAt: s, addedBy: provider });
      if (i < doneCount) return { ...base, status: 'done', progress: 1, startedAt: s + i * 30, doneAt: s + (i + 1) * 30 };
      if (i === doneCount) return { ...base, status: 'running', progress: 0.3, startedAt: s + i * 30 };
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
    adminDashboard(),
    flakyCheckout(),
    authMigration(),
    onboardingEmails(),
    vizGalleryThread(),
    simpleThread('lobby', 'personal', 'map-veto', 'Realtime veto lobby', 'claude', 1, 700, ['Presence channel', 'Lobby state machine', 'Veto turn timer', 'Reconnect handling'], 2, 1),
    simpleThread('timer', 'personal', 'focus-mode', 'Sync timer across devices', 'codex', 2, 760, ['CRDT timer state', 'Sync over relay', 'Conflict UI'], 1),
    simpleThread('queues', 'personal', null, 'Compare Postgres job queues', 'claude', 3, 790, ['Collect the options', 'Compare tradeoffs'], 1),
    simpleThread('cfg', 'liane', 'liane', 'Per-space config dirs', 'claude', 1, 720, ['Materialize CODEX_HOME per space', 'Materialize CLAUDE_CONFIG_DIR per space', 'Stop global writes', 'Migration for existing users'], 1, 1),
    simpleThread('tele', 'liane', 'liane', 'Skill telemetry', 'codex', 2, 800, ['Log skill loads per thread', 'Dead skill report'], 0),
  ];
}

export function seedQueue(): QueueItem[] {
  return [
    {
      id: 'q-approve',
      kind: 'approval',
      threadId: 'auth',
      title: 'Run the session backfill',
      detail: 'Claude wants to run a script that rewrites 18,204 rows in the local sessions table.',
      code: 'pnpm tsx scripts/backfill-sessions.ts --db local',
      blocks: { steps: 1, threads: 1 },
      createdAt: NOW0 - 9,
    },
    {
      id: 'q-question',
      kind: 'question',
      threadId: 'e2e',
      title: 'Answer 2 questions',
      detail: 'The flake is the webhook landing after the success page asserts. Stubbing is faster; recorded fixtures catch payload changes.',
      questions: [
        { text: 'Stub Stripe webhooks or record fixtures?', options: ['Stub webhooks', 'Record fixtures'], multiSelect: false },
        { text: 'Which checkout flows should the e2e suite cover?', options: ['One-time payment', 'Subscription', 'Refund', '3-D Secure'], multiSelect: true },
      ],
      blocks: { steps: 2, threads: 1 },
      createdAt: NOW0 - 17,
    },
    {
      id: 'q-review',
      kind: 'review',
      threadId: 'auth',
      title: 'Review PR #482',
      detail: 'Session backfill and legacy removal. 14 files, +612 −389. Codex already reviewed it once.',
      blocks: { steps: 0, threads: 1 },
      createdAt: NOW0 - 30,
    },
  ];
}

export const FAKE_TOOLS: Record<string, string[]> = {
  rl5: ['Search ioredis cluster evalsha NOSCRIPT retry', 'Run pnpm --filter cache add ioredis', 'Search upstash ratelimit sliding window vs token bucket', 'Read packages/cache/index.ts', 'Read src/logo.svg', 'Run REDIS_URL=redis://localhost:6379/0 RATE_LIMIT_TIERS=free:60,pro:600,enterprise:custom pnpm --filter @acme/api exec vitest run apps/api/middleware/__tests__/ratelimit.integration.test.ts apps/api/middleware/__tests__/ratelimit.overrides.test.ts --reporter=verbose --coverage.enabled --coverage.include=apps/api/middleware/ratelimit.ts', 'Search redis token bucket rate limiter lua script atomic', 'Edit packages/cache/redis.ts  +12 −2', 'Fetch https://redis.io/docs/latest/develop/interact/programmability/eval-intro/', 'Run pnpm --filter cache test', 'Read packages/cache/index.ts', 'Edit packages/cache/index.ts  +4 −0'],
  rl6: ['Write apps/api/middleware/ratelimit.ts', 'Edit apps/api/gateway.ts  +6 −1', 'Run pnpm --filter api test ratelimit'],
  rl7: ['Edit packages/db/schema/limits.ts  +14 −0', 'Edit apps/api/middleware/ratelimit.ts  +22 −3'],
  rl8: ['Write scripts/load/ratelimit.k6.js', 'Run k6 run scripts/load/ratelimit.k6.js'],
  ad2: ['Search upstash ratelimit sliding window vs token bucket', 'Edit apps/web/routes/admin/usage.tsx  +48 −10', 'Search ioredis cluster evalsha NOSCRIPT retry', 'Read apps/api/routes/admin/usage.ts', 'Run pnpm --filter web typecheck'],
  ad3: ['Write apps/api/routes/admin/usage.csv.ts', 'Run pnpm --filter api test usage'],
  ad4: ['Edit apps/web/routes/admin/usage.tsx  +30 −2'],
};

/** What the demo's web searches and fetches return, keyed by the tool line. Worst case on purpose: long titles, a domain with no favicon, a dozen hits. */
export const DEMO_LINKS: Record<string, WebLink[]> = {
  'Search redis token bucket rate limiter lua script atomic': [
    { url: 'https://redis.io/glossary/rate-limiting/', title: 'Rate Limiting with Redis: token bucket, sliding window and fixed window algorithms explained with examples' },
    { url: 'https://github.com/redis/redis/issues/8114', title: 'EVALSHA with a token bucket script returns stale counts under MULTI' },
    { url: 'https://stackoverflow.com/questions/13175050/how-to-implement-rate-limiting-using-redis', title: 'How to implement rate limiting using Redis' },
    { url: 'https://blog.cloudflare.com/counting-things-a-lot-of-different-things/', title: 'How we built rate limiting capable of scaling to millions of domains' },
    { url: 'https://stripe.com/blog/rate-limiters', title: 'Scaling your API with rate limiters' },
    { url: 'https://upstash.com/docs/redis/sdks/ratelimit-ts/algorithms', title: 'Ratelimiting algorithms' },
    { url: 'https://engineering.example-internal-wiki.invalid/limits', title: 'Internal: per-tier limits (no favicon here)' },
    { url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429', title: '429 Too Many Requests - HTTP | MDN' },
    { url: 'https://www.npmjs.com/package/rate-limiter-flexible' },
    { url: 'https://news.ycombinator.com/item?id=21378232', title: 'Ask HN: How do you rate limit an API at scale?' },
    { url: 'https://aws.amazon.com/builders-library/fairness-in-multi-tenant-systems/', title: 'Fairness in multi-tenant systems' },
    { url: 'https://en.wikipedia.org/wiki/Token_bucket', title: 'Token bucket - Wikipedia' },
  ],
  'Search stream large CSV export node fastify backpressure': [
    { url: 'https://nodejs.org/en/learn/modules/backpressuring-in-streams', title: 'Backpressuring in Streams | Node.js' },
    { url: 'https://github.com/fastify/fastify/issues/3360', title: 'Streaming a large CSV response with reply.send(stream)' },
    { url: 'https://www.npmjs.com/package/csv-stringify', title: 'csv-stringify' },
    { url: 'https://stackoverflow.com/questions/38788721/stream-csv-from-postgres', title: 'Stream CSV from Postgres to the client in Node' },
    { url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Disposition', title: 'Content-Disposition - HTTP | MDN' },
  ],
  'Search ioredis cluster evalsha NOSCRIPT retry': [
    { url: 'https://github.com/redis/ioredis/issues/536', title: 'Cluster: NOSCRIPT after failover, defineCommand does not reload' },
    { url: 'https://redis.io/docs/latest/commands/evalsha/', title: 'EVALSHA | Docs' },
    { url: 'https://stackoverflow.com/questions/36468713/redis-evalsha-noscript-in-cluster', title: 'Redis EVALSHA NOSCRIPT in cluster mode' },
    { url: 'https://www.npmjs.com/package/ioredis', title: 'ioredis' },
  ],
  'Search upstash ratelimit sliding window vs token bucket': [
    { url: 'https://upstash.com/blog/rate-limiting', title: 'Rate limiting your serverless applications' },
    { url: 'https://blog.bytebytego.com/p/rate-limiting-fundamentals', title: 'Rate limiting fundamentals' },
    { url: 'https://konghq.com/blog/engineering/how-to-design-a-scalable-rate-limiting-algorithm', title: 'How to design a scalable rate limiting algorithm' },
    { url: 'https://en.wikipedia.org/wiki/Token_bucket', title: 'Token bucket - Wikipedia' },
    { url: 'https://cloud.google.com/architecture/rate-limiting-strategies-techniques', title: 'Rate-limiting strategies and techniques' },
  ],
  'Fetch https://redis.io/docs/latest/develop/interact/programmability/eval-intro/': [{ url: 'https://redis.io/docs/latest/develop/interact/programmability/eval-intro/', title: 'Scripting with Lua' }],
};

export function genericTools(stepTitle: string) {
  return [`Read files for "${stepTitle}"`, 'Edit 2 files  +40 −6', 'Run tests'];
}
