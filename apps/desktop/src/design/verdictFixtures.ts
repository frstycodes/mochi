import type { Thread } from '../model';

/** Every idle verdict the end-of-turn card and sidebar row can show, on the `rl` demo thread, worst case last. */
export function verdictFixtures(
  rl: Thread,
): { label: string; thread: Thread }[] {
  const at = rl.activity.at(-1)?.at ?? 0;
  const base = {
    ...rl,
    live: { isWorking: false },
    status: 'running' as const,
    report: undefined,
    prs: [],
    idle: { at },
  };
  const pr = (state: 'open' | 'merged') => [
    { number: 133, state, title: 'Rate limit the public API' },
  ];
  return [
    {
      label: 'Idle · no PR yet',
      thread: { ...base, title: 'Keep the session cookie name' },
    },
    {
      label: 'Idle · in review',
      thread: {
        ...base,
        title: 'Add context window usage progress bar',
        prs: pr('open'),
      },
    },
    {
      label: 'Idle · merged',
      thread: { ...base, title: 'Admin usage dashboard', prs: pr('merged') },
    },
    {
      label: 'Needs you · asked in its report',
      thread: {
        ...base,
        title: 'Fix flaky checkout e2e',
        report: {
          at,
          by: 'claude',
          decisions: [],
          left: [],
          question:
            'The test fails 1 in 20 runs on CI only. Retry it, or quarantine it and open an issue?',
        },
      },
    },
    {
      label: 'Needs you · approval',
      thread: {
        ...base,
        title: 'Backfill existing sessions',
        status: 'needs-you',
        steps: [
          ...rl.steps,
          {
            id: 'approval',
            title: 'Run the session migration',
            status: 'blocked',
            addedAt: at,
            addedBy: 'claude',
          },
        ],
      },
    },
    {
      label: 'Stalled · usage limit',
      thread: {
        ...base,
        title: 'Usage export to CSV',
        live: {
          isWorking: false,
          limit: {
            label: 'Weekly',
            resetsAt: new Date(Date.now() + 4 * 3_600_000).toISOString(),
          },
        },
      },
    },
    {
      label: 'Stalled · the agent exited',
      thread: {
        ...base,
        title: 'Migrate auth to Better Auth',
        queuePause: 'failed',
        activity: [
          ...rl.activity,
          {
            at,
            who: 'harness' as const,
            kind: 'event' as const,
            text: 'Turn failed: Claude Code exited with code 1',
          },
        ],
      },
    },
    {
      label: 'Worst case · long everything',
      thread: {
        ...base,
        title:
          'A thread title long enough that it has to truncate on one line and then keep going',
        repo: {
          project: 'harness',
          branch: 'feat/an-extremely-long-branch-name-that-keeps-going',
        },
        prs: pr('open'),
        report: {
          at,
          by: 'claude',
          decisions: [],
          left: [],
          question:
            'Two of the provider sandboxes were down, so their paths are only covered by mocks: rerun them once they are back up before opening the pull request, or open it now and list them in its description?',
        },
      },
    },
  ];
}
