import type { Thread } from '../model.ts';
import { DEMO_FIVE_HOUR_RESET } from './demoLimits.ts';

export const LIMIT_DEMO_ID = 'limit';

/** Demo: a Claude thread that warned, wrapped up and paused on its 5-hour limit, with a message waiting for the reset. */
export function limitPausedThread(): Thread {
  const s = 14 * 60 - 40;
  return {
    id: LIMIT_DEMO_ID,
    spaceId: 'latitude',
    repo: { project: 'latitude', branch: 'feat/usage-export' },
    title: 'Usage export to CSV',
    goal: 'Admins can export a month of API usage per key as CSV.',
    providers: ['claude'],
    status: 'needs-you',
    line: 2,
    startedAt: s,
    revisions: [{ n: 1, at: s, label: 'Goal set', by: 'you' }],
    steps: [],
    activity: [
      { at: s, who: 'you', kind: 'message', text: 'Add a CSV export of monthly API usage per key to the admin usage page.' },
      { at: s + 1, who: 'claude', kind: 'message', text: 'I will add a streaming CSV route next to the usage API, then a button on the admin page.' },
      { at: s + 2, who: 'claude', kind: 'tool', text: 'Read apps/api/routes/admin/usage.ts' },
      { at: s + 4, who: 'claude', kind: 'tool', text: 'Write apps/api/routes/admin/usage.csv.ts' },
      { at: s + 31, who: 'harness', kind: 'event', text: "Claude's 5-hour limit is 91% used", detail: 'Turns still run; Mochi pauses the thread when the limit hits.' },
      { at: s + 33, who: 'claude', kind: 'tool', text: 'Edit apps/web/routes/admin/usage.tsx  +18 −2' },
      { at: s + 36, who: 'harness', kind: 'event', text: 'Wrapping up before the 5-hour limit', detail: 'Claude Code checkpoints the current step on its own.' },
      { at: s + 38, who: 'claude', kind: 'tool', text: 'Run pnpm --filter api test usage' },
      {
        at: s + 40,
        who: 'claude',
        kind: 'message',
        text: 'Checkpoint before the usage limit: the CSV route streams rows and its tests pass. Left:\n\n- Wire the Export button to the route\n- Add a month picker\n- Document the CSV columns',
      },
      { at: s + 41, who: 'harness', kind: 'event', isLimit: true, text: 'Claude hit the 5-hour usage limit' },
    ],
    queued: [{ id: 'm-limit-demo', draft: 'Then add the month picker.', files: 0, mentions: [], isCommand: false, typedSkills: [] }],
    queuePause: 'limit',
    live: { isWorking: false, isDetached: true, limit: { resetsAt: DEMO_FIVE_HOUR_RESET, label: '5-hour' } },
    prs: [],
    sources: [],
    context: { used: 118_000, max: 200_000 },
  };
}
