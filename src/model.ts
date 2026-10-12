import type { AgentQuestion } from './host/types/agent.ts';
import type { ThreadControls } from './runtime/controls.ts';
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
  kind: 'message' | 'tool' | 'event' | 'reasoning';
  text: string;
  seconds?: number;
  drift?: 'on-goal' | 'scope-add' | 'off-goal';
}

export function authorName(who: Author) {
  return { you: 'You', claude: 'Claude', codex: 'Codex', harness: 'Mochi' }[who];
}

export interface SkillUse {
  name: string;
  uses: number;
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
}

export interface Thread {
  id: string;
  spaceId: string;
  /** null: a chat with no folder, so no files, branch or PRs. `project` is the folder's name; `path` its absolute path, unset for the web build's fixture projects. */
  repo: { project: string; branch: string; path?: string } | null;
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
  skills: SkillUse[];
  sources: Source[];
  context: { used: number; max: number };
  orbitSlot?: number;
  settledAt?: number;
  drift?: { threshold: number; isMuted: boolean };
  session?: { provider: Provider; id: string; usage?: { input: number; output: number; costUsd?: number } };
  controls?: ThreadControls;
  /** From the live agent's session start; reset each time a session (re)starts. */
  agent?: AgentInfo;
  /** Set when a real agent runs the thread (desktop); the demo adapter leaves it alone. */
  live?: LiveRun;
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
  /** Reported tokens per usage event, for the plan window. */
  usage: { at: number; provider: Provider; tokens: number }[];
}

export type QueueKind = 'approval' | 'question' | 'review' | 'ci' | 'overlap' | 'setting';

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
  /** A consequential Mochi tool call waiting on this card (`src/runtime/tools.ts`); `options` are checkboxes, all off by default. */
  tool?: { callId: string; options?: { id: string; label: string }[] };
  /** A `setting` card: the setting an agent (or a blocked Mochi call) put in front of you. */
  setting?: { id: string; suggested?: string };
  createdAt: number;
}

/** The options of a lone single-choice question, the only kind a number key can answer. */
export function singleChoice(item: QueueItem) {
  const [question, ...rest] = item.questions ?? [];
  return question && !rest.length && !question.multiSelect && question.options.length ? question.options : null;
}

export function answerText(answers: string[][]) {
  return answers.filter((a) => a.length).map((a) => a.join(', ')).join(' · ');
}

export const PANE_TAB_KINDS = ['browser', 'changes', 'terminal', 'files', 'simulator', 'ports', 'sidechat', 'new'] as const;
export type PaneTabKind = (typeof PANE_TAB_KINDS)[number];

export interface PaneTab {
  id: string;
  kind: PaneTabKind;
  title?: string;
  url?: string;
  file?: { path: string; line?: number };
  isPopped?: boolean;
}

export interface Pane {
  threadId: string;
  isOpen: boolean;
  tabs: PaneTab[];
  activeTab: string;
  driver?: Provider;
}

export function seedPanes(): Pane[] {
  return [
    {
      threadId: 'adm',
      isOpen: true,
      activeTab: 'adm-browser',
      driver: 'codex',
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
      { at: at(s, 96), who: 'claude', kind: 'tool', text: 'Read packages/cache/index.ts' },
      { at: at(s, 101), who: 'claude', kind: 'tool', text: 'Edit packages/cache/redis.ts  +38 −0' },
      { at: at(s, 104), who: 'claude', kind: 'tool', text: 'Run pnpm --filter cache test' },
    ],
    prs: [],
    skills: [
      { name: 'sizing-the-change', uses: 1 },
      { name: 'code-review', uses: 1 },
    ],
    sources: [
      { kind: 'mcp', label: 'Linear · LAT-198 Rate limits' },
      { kind: 'file', label: 'docs/api/limits.md' },
      { kind: 'link', label: 'redis.io/docs/latest/develop/use/patterns' },
    ],
    context: { used: 84_000, max: 200_000 },
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
      { at: at(s, 1), who: 'codex', kind: 'tool', text: 'Read packages/db/schema/usage.ts' },
      { at: at(s, 1), who: 'codex', kind: 'tool', text: 'Read apps/web/components/charts/BarChart.tsx' },
      { at: at(s, 2), who: 'codex', kind: 'reasoning', seconds: 14, text: 'api_usage_daily is append-only and partitioned by day, so grouping by key and day is cheap if the query filters on the partition first. Offset pagination would drift while new rows land; a (key_id, day) cursor stays stable at 10k keys.' },
      { at: at(s, 2), who: 'codex', kind: 'message', text: 'Plan:\n1. Usage endpoint that aggregates api_usage_daily by key and day\n2. Charts page with a key filter and a 14-day range\n3. CSV export streaming from the same query\n4. Empty and loading states\n\nI will reuse BarChart and the date range picker from settings instead of adding a chart library.' },
      { at: at(s, 9), who: 'you', kind: 'message', text: 'Good. Keep the endpoint paginated, some customers have thousands of keys.' },
      { at: at(s, 10), who: 'codex', kind: 'tool', text: 'Write apps/api/routes/admin/usage.ts  +18 −0' },
      { at: at(s, 24), who: 'codex', kind: 'tool', text: 'Run pnpm --filter api test usage' },
      { at: at(s, 38), who: 'codex', kind: 'message', text: 'Endpoint is done and paginated by cursor. p95 is 140ms on the 10k-key seed database. Setup notes are in `README.md`, the page mounts from `src/App.tsx` and the scripts live in `package.json`. Moving on to the charts page.' },
      { at: at(s, 40), who: 'harness', kind: 'event', text: 'Finished "Usage query endpoint"' },
      { at: at(s, 44), who: 'codex', kind: 'tool', text: 'Edit apps/web/routes/admin/usage.tsx  +120 −4' },
    ],
    prs: [],
    skills: [
      { name: 'ui', uses: 3 },
      { name: 'dataviz', uses: 2 },
      { name: 'shadcn', uses: 1 },
    ],
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
      { at: at(s, 5), who: 'codex', kind: 'tool', text: 'Run pnpm e2e checkout.spec --repeat-each 6' },
      { at: at(s, 47), who: 'codex', kind: 'message', text: 'The flake is the Stripe webhook arriving after the success page asserts. I can either stub webhooks in e2e, or record real fixtures and replay them. Which do you prefer?' },
    ],
    prs: [],
    skills: [{ name: 'run', uses: 2 }],
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
    skills: [
      { name: 'security-review', uses: 1 },
      { name: 'code-review', uses: 2 },
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
    skills: [],
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
    skills: [],
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
  rl5: ['Edit packages/cache/redis.ts  +12 −2', 'Run pnpm --filter cache test', 'Read packages/cache/index.ts', 'Edit packages/cache/index.ts  +4 −0'],
  rl6: ['Write apps/api/middleware/ratelimit.ts', 'Edit apps/api/gateway.ts  +6 −1', 'Run pnpm --filter api test ratelimit'],
  rl7: ['Edit packages/db/schema/limits.ts  +14 −0', 'Edit apps/api/middleware/ratelimit.ts  +22 −3'],
  rl8: ['Write scripts/load/ratelimit.k6.js', 'Run k6 run scripts/load/ratelimit.k6.js'],
  ad2: ['Edit apps/web/routes/admin/usage.tsx  +48 −10', 'Read apps/api/routes/admin/usage.ts', 'Run pnpm --filter web typecheck'],
  ad3: ['Write apps/api/routes/admin/usage.csv.ts', 'Run pnpm --filter api test usage'],
  ad4: ['Edit apps/web/routes/admin/usage.tsx  +30 −2'],
};

export function genericTools(stepTitle: string) {
  return [`Read files for "${stepTitle}"`, 'Edit 2 files  +40 −6', 'Run tests'];
}
