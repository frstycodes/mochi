import type { Thread } from '../model.ts';
import { DEMO_FIVE_HOUR_RESET, DEMO_CODEX_RESET } from './demoLimits.ts';

/** The usage limit demos are the only demo threads with a `live` run (their limit lives there); they start fresh like the rest. */
export const LIMIT_DEMO_IDS = ['limit', 'limit-codex'];

/** Demo: Claude Code hit its 5-hour limit mid-turn and holds the turn until the reset, with a message queued behind it. */
export function claudeLimitThread(): Thread {
  const s = 14 * 60 - 40;
  return {
    id: 'limit',
    spaceId: 'latitude',
    repo: { project: 'latitude', branch: 'feat/usage-export' },
    title: 'Usage export to CSV',
    providers: ['claude'],
    status: 'running',
    line: 2,
    startedAt: s,
    steps: [],
    activity: [
      {
        at: s,
        who: 'you',
        kind: 'message',
        text: 'Add a CSV export of monthly API usage per key to the admin usage page.',
      },
      {
        at: s + 1,
        who: 'claude',
        kind: 'message',
        text: 'I will add a streaming CSV route next to the usage API, then a button on the admin page.',
      },
      {
        at: s + 2,
        who: 'claude',
        kind: 'tool',
        text: 'Read apps/api/routes/admin/usage.ts',
      },
      {
        at: s + 4,
        who: 'claude',
        kind: 'tool',
        text: 'Write apps/api/routes/admin/usage.csv.ts',
      },
      {
        at: s + 31,
        who: 'harness',
        kind: 'event',
        text: "Claude's 5-hour limit is 92% used",
      },
      {
        at: s + 33,
        who: 'claude',
        kind: 'tool',
        text: 'Edit apps/web/routes/admin/usage.tsx  +18 −2',
      },
      {
        at: s + 38,
        who: 'claude',
        kind: 'tool',
        text: 'Run pnpm --filter api test usage',
      },
      {
        at: s + 40,
        who: 'claude',
        kind: 'message',
        text: 'The CSV route streams rows and its tests pass. Left:\n\n- Wire the Export button to the route\n- Add a month picker\n- Document the CSV columns',
      },
      {
        at: s + 41,
        who: 'harness',
        kind: 'event',
        isLimit: true,
        text: 'Claude hit the 5-hour usage limit',
      },
    ],
    queued: [
      {
        id: 'm-limit-demo',
        draft: 'Then add the month picker.',
        mentions: [],
        isCommand: false,
        typedSkills: [],
      },
    ],
    live: {
      isWorking: true,
      limit: {
        resetsAt: DEMO_FIVE_HOUR_RESET,
        label: '5-hour',
        isTurnHeld: true,
      },
    },
    prs: [],
    sources: [],
    context: { used: 118_000, max: 200_000 },
  };
}

/** Demo: Codex ended its turn on a usage limit; the thread waits for you until the weekly reset. */
export function codexLimitThread(): Thread {
  const s = 14 * 60 - 25;
  return {
    id: 'limit-codex',
    spaceId: 'personal',
    repo: { project: 'focus-mode', branch: 'feat/streaks' },
    title: 'Focus streaks',
    providers: ['codex'],
    status: 'needs-you',
    line: 4,
    startedAt: s,
    steps: [],
    activity: [
      {
        at: s,
        who: 'you',
        kind: 'message',
        text: 'Track focus streaks: consecutive days with at least one session.',
      },
      {
        at: s + 2,
        who: 'codex',
        kind: 'tool',
        text: 'Read src/sessions/store.ts',
      },
      {
        at: s + 5,
        who: 'codex',
        kind: 'tool',
        text: 'Edit src/sessions/streak.ts  +41 −0',
      },
      {
        at: s + 6,
        who: 'harness',
        kind: 'event',
        isLimit: true,
        text: 'Codex hit the weekly usage limit',
      },
    ],
    live: {
      isWorking: false,
      isDetached: true,
      limit: { resetsAt: DEMO_CODEX_RESET, label: 'Weekly' },
    },
    prs: [],
    sources: [],
    context: { used: 64_000, max: 272_000 },
  };
}
