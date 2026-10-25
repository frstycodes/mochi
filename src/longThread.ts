import type { ActivityEntry, Thread } from './model.ts';

/**
 * GAP: dev-only perf fixture. `?long=2000` in the web build pins a generated thread with that many activity entries (prompts, reasoning,
 * tool groups with diffs and command output, markdown replies), so mount cost, memory and scroll FPS can be measured on a worst case.
 */
export function longThreadFromUrl(): Thread | undefined {
  if (typeof location === 'undefined') return undefined;
  const n = Number(new URLSearchParams(location.search).get('long'));
  return n > 0 ? longThread(n) : undefined;
}

export function longThread(count: number): Thread {
  const s = 600;
  const activity: ActivityEntry[] = [];
  for (let i = 0; activity.length < count; i++)
    activity.push(...turn(i, s + i));
  return {
    id: 'long',
    spaceId: 'latitude',
    repo: { project: 'latitude', branch: 'perf/long-thread' },
    title: `Long thread (${count} entries)`,
    goal: 'Stress the transcript.',
    providers: ['claude'],
    status: 'running',
    line: 3,
    startedAt: s,
    orbitSlot: 3,
    revisions: [{ n: 1, at: s, label: 'Goal set', by: 'you' }],
    steps: [],
    activity: activity.slice(0, count),
    prs: [],
    sources: [],
    context: { used: 120_000, max: 200_000 },
  };
}

function turn(i: number, at: number): ActivityEntry[] {
  const file = `apps/api/module${i % 17}/handler${i}.ts`;
  return [
    {
      at,
      who: 'you',
      kind: 'message',
      text: `Step ${i}: tighten the handler in \`${file}\` and keep the tests green.`,
    },
    {
      at,
      who: 'claude',
      kind: 'reasoning',
      seconds: 4,
      text: `The handler at ${file} reads the request twice; folding that into one parse keeps the hot path allocation free.`,
    },
    { at, who: 'claude', kind: 'tool', text: `Read ${file}` },
    {
      at,
      who: 'claude',
      kind: 'tool',
      text: `Edit ${file}  +6 −3`,
      patch: patch(file, i),
    },
    {
      at,
      who: 'claude',
      kind: 'tool',
      text: `Run pnpm --filter api test -- handler${i}`,
      description: `Run the handler ${i} tests`,
      output: `✓ handler${i} parses once (3 ms)\n✓ handler${i} rejects bad input (1 ms)\n\nTests: 2 passed`,
      exitCode: 0,
    },
    { at, who: 'claude', kind: 'message', text: reply(i, file) },
  ];
}

function patch(file: string, i: number) {
  return `--- a/${file}
+++ b/${file}
@@ -1,6 +1,9 @@
 import { parse } from './parse';
-export async function handler${i}(req: Request) {
-  const body = await req.json();
-  const again = await req.clone().json();
+export async function handler${i}(req: Request) {
+  const body = parse(await req.json());
+  if (!body.ok) return new Response('Bad input', { status: 400 });
+  const value = body.value;
+  return Response.json({ id: value.id, step: ${i} });
+}
`;
}

function reply(i: number, file: string) {
  return `Done with step ${i}. The handler now parses once:

- \`${file}\` validates before it touches the store
- bad input gets a **400** instead of a thrown error

\`\`\`ts
const body = parse(await req.json());
if (!body.ok) return new Response('Bad input', { status: 400 });
\`\`\`

Tests pass (2 of 2).`;
}
