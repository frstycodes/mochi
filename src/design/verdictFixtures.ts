import type { Criterion, GoalProposal, IdleCheck, Thread } from '../model';

/** Every idle verdict the end-of-turn card and sidebar row can show, on the `rl` demo thread, worst case last. */
export function verdictFixtures(rl: Thread): { label: string; thread: Thread }[] {
  const at = rl.activity.at(-1)?.at ?? 0;
  const idle = (patch: Partial<IdleCheck> = {}): IdleCheck => ({ at, accepted: [], uncommitted: 0, audit: { unverified: [] }, ...patch });
  const passed = (id: string, text: string, command?: string): Criterion => ({ id, text, command, check: { status: 'passed', at, ms: 41_000 } });
  const failed = (id: string, text: string, command: string): Criterion => ({ id, text, command, check: { status: 'failed', at, ms: 52_000, output: '✖ src/rewind/git.test.ts\n✖ electron/git/setup.test.ts\nℹ tests 714\nℹ pass 709\nℹ fail 5' } });
  const open = (id: string, text: string): Criterion => ({ id, text });
  const met = [passed('c1', 'Every 429 carries Retry-After'), passed('c2', 'pnpm test passes', 'pnpm test'), passed('c3', 'Types and lint pass', 'vp check')];
  const base = { ...rl, live: { isWorking: false }, status: 'running' as const, report: undefined, prs: [], criteria: met, idle: idle() };
  const pr = (state: 'open' | 'merged') => [{ number: 133, state, title: 'Rate limit the public API' }];
  const admissions = [
    { text: 'Not checked in the running app', quote: "I haven't checked it in the app" },
    { text: 'Root cause of the #133 chip not confirmed', quote: "I haven't confirmed it's what broke your #133 chip" },
  ];
  const said = "Opened #135. The chip now falls back to the home folder when the worktree is gone. I haven't confirmed it's what broke your #133 chip, and I haven't checked it in the app.";
  const replied = [...rl.activity, { at, who: 'claude' as const, kind: 'message' as const, text: said }];
  return [
    { label: 'Gaps · 1 critical, 2 unverified', thread: { ...base, title: 'Debugging Electron git IPC failure', activity: replied, criteria: [met[0], met[2], failed('c2', 'pnpm test passes', 'pnpm test')], prs: pr('open'), idle: idle({ audit: { unverified: admissions } }) } },
    { label: 'Gaps · one accepted, one left', thread: { ...base, title: 'Pane slide-in motion', activity: replied, idle: idle({ audit: { unverified: admissions }, accepted: ['unverified-0-Not checked in the running app'] }) } },
    { label: 'Done · no PR yet', thread: { ...base, title: 'Keep the session cookie name' } },
    { label: 'Done · in review', thread: { ...base, title: 'Add context window usage progress bar', prs: pr('open') } },
    { label: 'Done · merged', thread: { ...base, title: 'Admin usage dashboard', prs: pr('merged') } },
    { label: 'Needs you · asked in prose', thread: { ...base, title: 'Fix flaky checkout e2e', criteria: [met[0], open('c2', 'e2e passes 20 runs in a row'), open('c3', 'No retries added')], idle: idle({ uncommitted: 2, audit: { question: 'The test fails 1 in 20 runs on CI only. Retry it, or quarantine it and open an issue?', unverified: [] } }) } },
    { label: 'Needs you · goal to accept', thread: { ...base, title: 'fix this', proposal: proposalFixture(at, 'waiting') } },
    { label: 'Stalled · usage limit', thread: { ...base, title: 'Usage export to CSV', live: { isWorking: false, limit: { label: 'Weekly', resetsAt: new Date(Date.now() + 4 * 3_600_000).toISOString() } }, criteria: [met[0], met[1], open('c3', 'CSV opens in Numbers'), open('c4', 'Large exports stream')], idle: idle({ uncommitted: 5, audit: undefined }) } },
    { label: 'Stalled · the agent exited', thread: { ...base, title: 'Migrate auth to Better Auth', queuePause: 'failed', activity: [...rl.activity, { at, who: 'harness' as const, kind: 'event' as const, text: 'Turn failed: Claude Code exited with code 1' }], idle: idle({ uncommitted: 3, audit: undefined }) } },
    { label: 'Stalled · stopped mid-plan', thread: { ...base, title: 'Devices section in settings', criteria: [met[0], met[1], open('c3', 'Devices list reads the registry'), open('c4', 'Offline devices show their age'), open('c5', 'Both themes checked')] } },
    {
      label: 'Worst case · 12 gaps, long everything',
      thread: {
        ...base,
        title: 'A thread title long enough that it has to truncate on one line and then keep going',
        repo: { project: 'harness', branch: 'feat/an-extremely-long-branch-name-that-keeps-going' },
        criteria: ['pnpm test', 'vp check', 'tsc -b', 'pnpm e2e --project=chromium --grep @checkout', 'pnpm build'].map((c, i) => failed(`w${i}`, `Criterion ${i + 1} with a long sentence that wraps onto a second line in the card`, c)),
        prs: pr('open'),
        idle: idle({ uncommitted: 128, audit: { unverified: Array.from({ length: 7 }, (_, i) => ({ text: `Unverified thing number ${i + 1} the agent admitted to`, quote: `I didn't check thing ${i + 1}` })) } }),
        activity: [...rl.activity, { at, who: 'claude' as const, kind: 'message' as const, text: Array.from({ length: 7 }, (_, i) => `I didn't check thing ${i + 1}.`).join(' ') }],
      },
    },
  ];
}

/** The agent's goal for a "fix this" thread, as `propose_goal` leaves it. */
export function proposalFixture(at: number, state: GoalProposal['state']): GoalProposal {
  return {
    goal: "PR chips in a deleted worktree show live GitHub state, not “GitHub couldn't be read”",
    basis: 'From your screenshot: chip #133 in a settled thread whose worktree was removed. refStates runs gh in that folder.',
    criteria: [
      { text: 'A thread with no folder reads PR state from home', command: 'pnpm test' },
      { text: 'Types and lint pass', command: 'vp check' },
      { text: 'Chip #133 shows its state in the rebuilt app' },
    ],
    at,
    by: 'claude',
    state,
    before: { goal: 'The issue user raised is fixed in harness repo', criteria: [] },
  };
}
