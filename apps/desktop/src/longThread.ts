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
    providers: ['claude'],
    status: 'running',
    line: 3,
    startedAt: s,
    pinOrder: 3,
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
      ...(i % 3 === 0 && { images: [card(`Screenshot ${i}`, i)] }),
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

Tests pass (2 of 2).${i % 5 === 0 ? `\n\n![Latency after step ${i}](${card(`p95 after step ${i}`, i + 7)})` : ''}`;
}

/** A small labelled picture, so the photo viewer has a thread's worth of distinct images to page through. */
function card(label: string, seed: number) {
  const hue = (seed * 47) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="hsl(${hue} 45% 55%)"/><text x="320" y="210" font-family="system-ui" font-size="40" fill="white" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
