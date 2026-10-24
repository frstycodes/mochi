// Records saved-thread files the way the desktop app writes them today (`splitSaved`), from the app's own demo threads plus
// one live thread carrying the fields demo threads leave unset. Never from a real save on disk.
// Run from the repo root: `node --import ./scripts/test-env.ts packages/schema/scripts/record-saved.ts`.
// Outside the package's tsconfig on purpose: it reaches into `src/`, which the package must not depend on.
import { writeFileSync } from 'node:fs';
import { seedQueue, seedThreads, type Thread } from '../../../src/model.ts';
import type { Checkpoint } from '../../../src/rewind/checkpoints.ts';
import { splitSaved, toSaved } from '../../../src/store/saved.ts';

const demo = seedThreads();
const base = demo[0];

const steer = { id: 'q2', draft: 'also cover the retry path', mentions: [{ kind: 'file', id: 'f1', title: 'retry.ts', path: 'src/retry.ts', isDir: false }], isCommand: false, typedSkills: [] };

/** A desktop thread mid-run: what a live agent, its subagents and your queued messages leave on a thread. */
const live: Thread = {
  ...base,
  id: 'live',
  title: 'Live thread',
  repo: { project: 'mochi', branch: 'feat/x', path: '/repo', base: 'main', autoBranch: 'mochi/abc', isExisting: false },
  isTitleGenerated: true,
  criteria: [{ id: 'c1', text: 'Tests pass', command: 'pnpm test', claim: { evidence: 'ran it', at: 900, by: 'claude' }, check: { status: 'passed', at: 901, ms: 1200, output: 'ok' } }],
  similar: [{ threadId: 'cfg', relation: 'related' }],
  parent: { threadId: 'timer', criterionId: 'c9', handedBackAt: 950 },
  report: { at: 910, turn: 2, by: 'claude', decisions: ['kept the API'], left: [], question: 'Ship it?', summary: 'Added retries', next: 'Commit?', options: [{ label: 'Commit', reply: 'Commit it', isDraft: true }], isSuperseded: true },
  idle: { at: 911, turn: 2, uncommitted: 3, audit: { question: 'Which env?', unverified: [{ text: 'deploy works', quote: 'should deploy' }] }, accepted: ['g1'], isConfirmed: true, isMoveAnswered: true },
  turn: { start: 4, isAgentDriven: true },
  proposal: { goal: 'Retries', criteria: [{ text: 'Retries 3 times', command: 'pnpm t' }], basis: 'issue #4', at: 905, by: 'codex', state: 'waiting', before: { goal: '', criteria: [] } },
  drift: { isMuted: false, keeps: 1 },
  session: { provider: 'claude', id: 'sess-1', usage: { input: 1000, output: 40, cached: 200, costUsd: 0.02 } },
  controls: { model: 'claude-opus-5-5', effort: 'high', speed: 'fast', access: 'Full access' },
  agent: { model: 'claude-opus-5-5', cwd: '/repo', mcpServers: [{ name: 'mochi', status: 'connected', toolCount: 12, url: 'http://127.0.0.1' }], plugins: [{ name: 'p', version: '1' }], commands: [{ name: 'review', description: 'Review', argumentHint: '<pr>' }] },
  live: { isWorking: true, turnEnd: 'done', starting: 'claude', cwd: '/repo', limit: { resetsAt: '2026-10-22T12:00:00Z', label: '5-hour', isTurnHeld: true, autoResume: false }, isDetached: false, eventSeq: 42, isOnApiKey: false, notes: ['note'], restart: { forkAt: 'u-1' } },
  setup: { status: 'ready', startedAt: 1, endedAt: 2, steps: [{ id: 's1', label: 'Install dependencies with pnpm', command: 'pnpm i', status: 'done', startedAt: 1, endedAt: 2, output: 'ok', exitCode: 0 }] },
  reviews: [{ id: 'r1', provider: 'codex', afterIndex: 3, startedAt: 5, status: 'done', steps: ['Read src/a.ts'], result: { verdict: 'concerns', summary: 's', findings: [{ file: 'a.ts', line: 3, severity: 'high', text: 't' }, { file: 'b.ts', severity: 'low', text: 'u' }] }, isAgentAsked: true }],
  subagents: [{ id: 'a1', origin: 'mochi', provider: 'codex', name: 'Explore', prompt: 'find x', model: 'gpt', toolId: 't1', isBackground: true, status: 'done', startedAt: 1, endedAt: 2, tokens: 300, steps: [{ id: 'st', text: 'Read', isDone: true, files: ['a.ts'], exitCode: 0, output: 'o', patch: 'p', description: 'd' }], result: 'found', sessionId: 'live--a1', cwd: '/wt', hasOwnWorktree: true, isReportDue: true }],
  backgroundTasks: [{ id: 'b1', kind: 'shell', provider: 'claude', title: 'dev server', command: 'pnpm dev', status: 'running', startedAt: 3, outputFile: '/tmp/o' }],
  queued: [{ id: 'q1', draft: '/review now', images: [{ mediaType: 'image/png', data: 'AAAA', thumb: 'data:image/png;base64,AAAA', original: '/tmp/a.png' }], mentions: [{ kind: 'skill', id: 'review', title: 'review', description: 'Review' }], isCommand: true, typedSkills: ['review'], isSentNow: true }],
  queuePause: 'interrupted',
  steering: [{ message: steer, entry: { at: 912, who: 'you', kind: 'message', text: 'also cover the retry path' }, reason: 'on goal', hasReportBefore: true, sendNow: 'pending' }],
  isInterruptedToSend: true,
  seenActivity: 3,
  activity: [
    ...base.activity,
    {
      at: 913,
      who: 'claude',
      kind: 'tool',
      text: 'Ran tests',
      toolId: 't9',
      description: 'Run tests',
      output: 'ok',
      exitCode: 0,
      patch: '--- a',
      links: [{ url: 'https://example.com', title: 'Example' }],
      skill: 'review',
      mcp: { server: 'gh', tool: 'pr', account: 'work' },
      images: ['/tmp/s.png'],
      generated: { status: 'done', prompt: 'logo', src: '/tmp/l.png', aspect: 1 },
      widget: { server: 's', uri: 'ui://x', input: { a: 1 }, result: { content: [{ type: 'text', text: 'r' }], structuredContent: { b: 2 } } },
      sent: { threadId: 'cfg', title: 'Per-space config dirs', text: 'hi' },
      ms: 1_700_000_000_000,
    },
    { at: 914, who: 'harness', kind: 'event', text: 'Compacted', compaction: { trigger: 'auto', status: 'done', pins: 2, hasGoal: true, preTokens: 100, postTokens: 10 }, glyph: 'browse', site: 'example.com', card: { id: 'w1', isOpen: false }, isLimit: true },
    { at: 915, who: 'harness', kind: 'event', text: 'Handed off', handoff: { from: 'claude', to: 'codex', status: 'started', prompt: 'p', fallback: 'timeout' }, turnUndo: { start: 2, isUndone: true }, nextMove: { question: 'Commit?', answer: 'Commit' } },
    {
      at: 916,
      who: 'claude',
      kind: 'event',
      text: 'Side work',
      proposals: [{ id: 'p1', initiation: 'own_initiative', title: 'Docs', brief: 'Write docs', state: 'pending', create: { provider: 'claude', project: '/repo', workspace: { mode: 'worktree', branch: 'docs', base: 'main' }, controls: { model: '', effort: 'high', speed: '', access: 'Auto' }, isLive: true, parent: { threadId: 'live' } } }],
    },
    { at: 917, who: 'you', kind: 'message', text: 'Fixed CI', from: { title: 'Other' }, autofix: { kind: 'ci', pr: 4, title: 'CI failed' }, wasQueued: true, isSeen: true, secondOpinion: { reviewId: 'r1', provider: 'codex' }, simplified: { text: 's', rulesKey: 'k', isShown: true }, drift: 'scope-add', seconds: 3 },
    { at: 918, who: 'harness', kind: 'event', text: 'Back', subThread: { threadId: 'timer', title: 'Timer', text: 'done' }, subagentId: 'a1', detail: 'why' },
  ],
} as Thread;

const checkpoint: Checkpoint = { n: 1, at: 900, label: 'Before tests', stepId: base.steps[0]?.id, thread: base, ref: 'refs/mochi/1', wantsFiles: true, before: 2 };

const queue = [
  ...seedQueue(),
  {
    id: 'qt',
    kind: 'setting',
    threadId: 'live',
    title: 'Change model',
    detail: '',
    blocks: { steps: 0, threads: 0 },
    tool: { callId: 'c1', options: [{ id: 'o', label: 'O' }], pick: 'one', isDestructive: true, isHandoff: false, edits: [{ path: '.mcp.json', before: '', after: '{}' }], notes: ['n'] },
    settings: { by: 'claude', reason: 'r', changes: [{ key: 'model', value: 'x', profileId: 'personal' }], addServer: { profileId: 'personal', provider: 'claude', server: { name: 'gh', type: 'stdio', command: 'gh', args: ['mcp'], env: { A: 'b' } } }, before: { model: 'y' } },
    ci: { pr: 4, url: 'https://github.com/o/r/pull/4', check: { name: 'test', link: 'https://x' } },
    createdAt: 919,
    isSeen: true,
  },
] as ReturnType<typeof seedQueue>;

const threads = [...demo, live];
const state = { now: 920, seq: 7, threads: threads.map((t) => ({ ...t, live: t.live ?? { isWorking: false } })), queue, checkpoints: { live: [checkpoint] }, checkpointSeq: 1, forks: { live: { parentId: 'rate', at: 900, label: 'Fork', checkpoint: 1 } } };
// toSaved keeps only live (desktop) threads; every recorded one counts.
const saved = toSaved(state as never);
const { index, threads: files } = splitSaved(saved);

// A pre-split `threads.json` from before checkpoints and forks, holding values today's restore still reads: a step an overlap
// held (`waiting`), a controls block from before `speed` with a pre-rename access name, and an overlap card.
const old = structuredClone(saved.threads[0]);
old.steps = old.steps.map((s, i) => (i === 0 ? { ...s, status: 'waiting' as never } : s));
old.controls = { model: '', effort: 'high', access: 'Ask first' } as never;
const legacy = { version: 1, now: 1, seq: 1, threads: [old], queue: [{ ...seedQueue()[0], kind: 'overlap' }] };

const recorded = { index: JSON.parse(index), threads: Object.values(files).map((json) => JSON.parse(json)), legacy };
writeFileSync(new URL('../fixtures/saved.json', import.meta.url), `${JSON.stringify(recorded, null, 1)}\n`);
console.log(`${recorded.threads.length} thread files, ${recorded.index.queue.length} queue items`);
