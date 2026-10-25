// GAP: fake tool output for the prototype. The real app reads patches and command output from the agent's event stream.

export interface RunResult {
  exitCode: number;
  /** Known for the demo's scripted runs; live agents don't report it. */
  ms?: number;
  lines: { tone: 'plain' | 'dim' | 'pass' | 'fail'; text: string }[];
}

export const PATCHES: Record<string, string> = {
  'packages/cache/redis.ts': `--- /dev/null
+++ b/packages/cache/redis.ts
@@ -0,0 +1,16 @@
+import { createClient } from 'redis';
+import { env } from '@latitude/env';
+
+export type Redis = ReturnType<typeof createClient>;
+
+let client: Redis | undefined;
+
+export async function redis(): Promise<Redis> {
+  if (client?.isOpen) return client;
+  client = createClient({ url: env.REDIS_URL, socket: { reconnectStrategy: (n) => Math.min(n * 50, 2000) } });
+  client.on('error', (err) => console.error('[redis]', err));
+  await client.connect();
+  return client;
+}
+
+export { tokenBucket } from './token-bucket';
`,
  'apps/api/routes/admin/usage.ts': `--- /dev/null
+++ b/apps/api/routes/admin/usage.ts
@@ -0,0 +1,17 @@
+import { z } from 'zod';
+import { db, sql } from '@latitude/db';
+
+const Query = z.object({ cursor: z.string().optional(), days: z.number().int().max(90).default(14) });
+
+export async function usageByKey(input: z.infer<typeof Query>) {
+  const { cursor, days } = Query.parse(input);
+  const rows = await db.execute(sql\`
+    select key_id, day, sum(calls) as calls
+    from api_usage_daily
+    where day >= current_date - \${days}::int
+      and (\${cursor}::text is null or (key_id, day) > split_cursor(\${cursor}))
+    group by key_id, day
+    order by key_id, day
+    limit 500\`);
+  return { rows, next: rows.length === 500 ? encodeCursor(rows.at(-1)) : null };
+}
`,
  'apps/web/routes/admin/usage.tsx': `--- a/apps/web/routes/admin/usage.tsx
+++ b/apps/web/routes/admin/usage.tsx
@@ -1,7 +1,19 @@
-import { Placeholder } from '~/components/placeholder';
+import { BarChart } from '~/components/charts/BarChart';
+import { DateRangePicker } from '~/components/settings/DateRangePicker';
+import { KeyFilter } from './key-filter';
+import { useUsage } from './use-usage';
 
 export default function AdminUsage() {
-  return <Placeholder title="API usage" />;
+  const [range, setRange] = useRange({ days: 14 });
+  const usage = useUsage({ range });
+
+  return (
+    <Page title="API usage" actions={<DateRangePicker value={range} onChange={setRange} />}>
+      <BarChart data={usage.daily} x="day" y="calls" />
+      <KeyFilter keys={usage.keys} />
+      <UsageTable rows={usage.rows} onLoadMore={usage.next} />
+    </Page>
+  );
 }
-
-export const handle = { title: 'Usage' };
+
+export const handle = { title: 'API usage', breadcrumb: 'Admin' };
`,
};

export const RUNS: Record<string, RunResult> = {
  'pnpm --filter api test usage': {
    exitCode: 0,
    ms: 2380,
    lines: [
      { tone: 'dim', text: ' RUN  v3.2.4 apps/api' },
      { tone: 'pass', text: ' ✓ routes/admin/usage.test.ts (6 tests) 412ms' },
      { tone: 'plain', text: '' },
      { tone: 'plain', text: ' Test Files  1 passed (1)' },
      { tone: 'plain', text: '      Tests  6 passed (6)' },
      { tone: 'dim', text: '   Duration  2.38s' },
    ],
  },
  'pnpm --filter cache test': {
    exitCode: 0,
    ms: 1140,
    lines: [
      { tone: 'dim', text: ' RUN  v3.2.4 packages/cache' },
      { tone: 'pass', text: ' ✓ redis.test.ts (3 tests) 96ms' },
      { tone: 'plain', text: '      Tests  3 passed (3)' },
    ],
  },
  'pnpm e2e checkout.spec --repeat-each 6': {
    exitCode: 1,
    ms: 94_200,
    lines: [
      { tone: 'dim', text: 'Running 6 tests using 3 workers' },
      {
        tone: 'pass',
        text: '  ✓ checkout.spec.ts:14 › pays with a saved card (12.1s)',
      },
      {
        tone: 'fail',
        text: '  ✘ checkout.spec.ts:14 › pays with a saved card (15.0s)',
      },
      {
        tone: 'fail',
        text: '    Error: expect(locator).toHaveText("Payment received")',
      },
      { tone: 'dim', text: '    Received: "Processing payment…"' },
      { tone: 'plain', text: '' },
      { tone: 'fail', text: '  1 failed' },
      { tone: 'pass', text: '  5 passed (1.6m)' },
    ],
  },
};
