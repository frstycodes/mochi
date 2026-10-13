import { parseDiff } from '../../git/parse.ts';
import { refKey, type RefState } from '../../chat/refs.ts';
import type { GitHost } from '../types/git.ts';

// Fixture paths match the `adm` thread's step footprints, so the per-step filter has something to show.
const STAGED = [
  'diff --git a/apps/api/routes/admin/usage.ts b/apps/api/routes/admin/usage.ts',
  'new file mode 100644',
  'index 0000000..8f3c2a1',
  '--- /dev/null',
  '+++ b/apps/api/routes/admin/usage.ts',
  '@@ -0,0 +1,14 @@',
  "+import { db } from '@latitude/db';",
  "+import { cursorPage } from '../../lib/pagination';",
  '+',
  '+export async function usage(req: AdminRequest) {',
  '+  const { cursor, days = 14 } = req.query;',
  '+  return cursorPage(',
  '+    db.apiUsageDaily',
  "+      .where('day', '>=', daysAgo(days))",
  "+      .groupBy(['key_id', 'day'])",
  "+      .orderBy(['key_id', 'day']),",
  '+    cursor,',
  '+    500,',
  '+  );',
  '+}',
  '',
].join('\n');

const UNSTAGED = [
  'diff --git a/apps/web/routes/admin/usage.tsx b/apps/web/routes/admin/usage.tsx',
  'index 2b7e9d0..c41a7f3 100644',
  '--- a/apps/web/routes/admin/usage.tsx',
  '+++ b/apps/web/routes/admin/usage.tsx',
  '@@ -1,8 +1,10 @@',
  "-import { Chart } from '../../components/Chart';",
  "+import { BarChart } from '../../components/charts/BarChart';",
  "+import { DateRangePicker } from '../../components/DateRangePicker';",
  " import { useUsage } from '../../api/usage';",
  ' ',
  ' export function UsagePage() {',
  '-  const { data } = useUsage();',
  '+  const [range, setRange] = useState(last14Days);',
  '+  const { data } = useUsage({ range });',
  '   if (!data) return <UsageSkeleton />;',
  ' ',
  '   return (',
  '@@ -20,8 +22,10 @@ export function UsagePage() {',
  '       <header className="flex items-center gap-2">',
  '         <h1>API usage</h1>',
  '-        <span>Last 14 days</span>',
  '+        <DateRangePicker value={range} onChange={setRange} />',
  '       </header>',
  '-      <Chart data={data.byDay} />',
  '+      <BarChart data={data.byDay} x="day" y="requests" />',
  '+      <KeyTable rows={data.byKey} />',
  '+      <ExportButton range={range} />',
  '     </section>',
  '   );',
  ' }',
  'diff --git a/apps/web/components/Chart.tsx b/apps/web/components/Chart.tsx',
  'deleted file mode 100644',
  'index 9a1b2c3..0000000',
  '--- a/apps/web/components/Chart.tsx',
  '+++ /dev/null',
  '@@ -1,4 +0,0 @@',
  "-import { LineChart } from 'recharts';",
  '-export function Chart({ data }: { data: unknown[] }) {',
  '-  return <LineChart data={data} />;',
  '-}',
  '',
].join('\n');

const FORK = [
  'diff --git a/apps/web/routes/admin/usage.tsx b/apps/web/routes/admin/usage.tsx',
  'index 2b7e9d0..77d1e04 100644',
  '--- a/apps/web/routes/admin/usage.tsx',
  '+++ b/apps/web/routes/admin/usage.tsx',
  '@@ -20,8 +20,7 @@ export function UsagePage() {',
  '       <header className="flex items-center gap-2">',
  '         <h1>API usage</h1>',
  '         <span>Last 14 days</span>',
  '       </header>',
  '-      <Chart data={data.byDay} />',
  '+      <UsageTable rows={data.byKey} virtualized />',
  '     </section>',
  '   );',
  ' }',
  '',
].join('\n');

const DAY = 86_400_000;
const FIXTURE_BRANCHES = [
  ['main', 0],
  ['feat/admin-usage', 0.2],
  ['feat/api-rate-limits', 0.5],
  ['fix/checkout-e2e', 1.5],
  ['feat/better-auth-session-rotation-and-device-trust-for-enterprise-sso', 3],
  ['origin/release/2026-10', 4],
  ['origin/feat/onboarding-emails', 9],
] as const;
// Same rule as `git check-ref-format --branch` for what people actually type.
const BAD_REF = /(^[-/.])|([/.]$)|\.\.|\/\/|@\{|[\s~^:?*[\\\x00-\x1f\x7f]|\.lock(\/|$)|^@$/;

export const git: GitHost = {
  async status() {
    return {
      branch: 'feat/admin-usage',
      files: [
        { path: 'apps/api/routes/admin/usage.ts', status: 'added' },
        { path: 'apps/web/routes/admin/usage.tsx', status: 'modified' },
        { path: 'apps/web/components/Chart.tsx', status: 'deleted' },
      ],
    };
  },
  async diff(cwd, scope) {
    const staged = parseDiff(STAGED, scope === 'uncommitted');
    const files = [...staged, ...parseDiff(UNSTAGED, false)];
    // A forked worktree took another approach, so the fork comparison has two different sides to show.
    if (cwd.includes('/fork-')) return { branch: 'feat/admin-usage-fork', base: 'origin/main', files: [...files.slice(0, 1), ...parseDiff(FORK, false)] };
    return { branch: 'feat/admin-usage', base: 'origin/main', files };
  },
  async stage() {},
  async unstage() {},
  async revert() {},
  async commit() {
    return '0000000';
  },
  async push() {},
  async createPr() {
    return 'https://github.com/latitude-dev/latitude/pull/490';
  },
  async ciLog() {
    return 'Error: lint failed\n  src/index.ts:12:3  no-unused-vars';
  },
  async ghAccounts() {
    return [];
  },
  async repoSlug() {
    return { owner: 'frstycodes', repo: 'mochi' };
  },
  async refStates(_cwd, refs) {
    return Object.fromEntries(refs.flatMap((ref) => (DEMO_REFS[ref.number] ? [[refKey(ref), DEMO_REFS[ref.number]]] : [])));
  },
  async pr() {
    return {
      number: 490,
      url: 'https://github.com/latitude-dev/latitude/pull/490',
      title: 'Rate limits for the public API',
      state: 'OPEN',
      checks: [
        { name: 'typecheck', state: 'pass' },
        { name: 'unit', state: 'pass' },
        { name: 'e2e', state: 'pending' },
        { name: 'lint', state: 'fail' },
      ],
    };
  },
  async sync() {
    return { base: 'origin/main', conflicts: [] };
  },
  async branches(root) {
    // One fixture project has uncommitted changes, so the project folder warning and the refused switch can be seen.
    const isDirty = root.endsWith('latitude');
    const now = Date.now();
    return {
      current: 'main',
      defaultBranch: 'main',
      isDirty,
      branches: FIXTURE_BRANCHES.map(([name, days]) => ({ name, isRemote: name.startsWith('origin/'), committedAt: now - days * DAY, worktree: name === 'main' ? root : name === 'feat/admin-usage' ? '~/.harness/worktrees/latitude/adm' : undefined })),
    };
  },
  async branchNameError(_root, name) {
    if (!name.trim()) return 'Name the branch';
    if (BAD_REF.test(name)) return `"${name}" isn't a valid branch name`;
    return FIXTURE_BRANCHES.some(([b]) => b === name) ? `A branch named ${name} already exists` : null;
  },
  async addWorktree(_root, threadId) {
    return `~/.harness/worktrees/demo/${threadId}`;
  },
  async worktrees() {
    return [];
  },
  async removeWorktree() {},
  async diskUsage() {
    return 48_200_000;
  },
  async checkpoint(_cwd, threadId, n) {
    return `${threadId}${n}`.padEnd(40, '0');
  },
  async restoreCheckpoint() {},
  async forkWorktree(_cwd, threadId) {
    return `~/.harness/worktrees/demo/${threadId}`;
  },
};

// One of every chip state, by number on any repo; other numbers stay unknown, as without gh.
const demoRef = (kind: RefState['kind'], status: RefState['status'], number: number, title: string, extra: Partial<RefState> = {}): RefState => ({
  kind,
  status,
  title,
  url: `https://github.com/frstycodes/mochi/${kind === 'pr' ? 'pull' : 'issues'}/${number}`,
  hasConflicts: false,
  isFailing: false,
  isNotPlanned: false,
  ...extra,
});

const DEMO_REFS: Record<number, RefState> = {
  45: demoRef('pr', 'open', 45, 'fix(header): restore the side pane and sidebar toggles'),
  46: demoRef('pr', 'open', 46, 'feat(composer): slash anywhere, @ skills and MCP servers', { hasConflicts: true }),
  48: demoRef('pr', 'open', 48, 'Interleave work groups with prose', { isFailing: true }),
  49: demoRef('pr', 'draft', 49, 'feat(chat): PR and file links'),
  47: demoRef('pr', 'merged', 47, 'fix: replace prototype stubs with working actions'),
  30: demoRef('pr', 'closed', 30, 'feat: experimental orbit gestures'),
  7: demoRef('pr', 'closed', 7, 'An early PR that was closed'),
  50: demoRef('pr', 'open', 50, 'A PR that conflicts with main', { hasConflicts: true }),
  12: demoRef('issue', 'open', 12, 'Sidebar loses scroll position on space switch'),
  9: demoRef('issue', 'closed', 9, 'Composer drops pasted images'),
  8: demoRef('issue', 'closed', 8, 'Support Windows titlebar', { isNotPlanned: true }),
};
