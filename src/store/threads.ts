import { FAKE_TOOLS, genericTools, NOW0, seedThreads, type ActivityEntry, type LineSlot, type Provider, type QueueItem, type Step, type Thread } from '../model.ts';
import { stepTitleFrom, type DriftKind } from '../drift.ts';
import { applyDraft, type GoalDraft } from '../goals/edit.ts';
import { progressAt } from '../progress.ts';
import { reorderThreads } from '../reorder.ts';
import type { Action, Snapshot, State } from './index.tsx';

export type OverlapMode = 'link' | 'extract' | 'race' | 'related';

export interface ThreadsState {
  now: number;
  threads: Thread[];
  fired: { overlap: boolean; scope: boolean };
  seq: number;
}

export type ThreadsAction =
  | { type: 'tick' }
  | { type: 'overlap'; queueId: string; mode: OverlapMode }
  | { type: 'trigger-overlap' }
  | { type: 'add-scope'; threadId: string }
  | { type: 'settle'; threadId: string }
  | { type: 'unsettle'; threadId: string }
  | { type: 'create'; title: string; provider: Provider; project: string | null; dependOn?: { threadId: string; stepId: string }; branchFrom?: string }
  | { type: 'send'; threadId: string; text: string; drift: DriftKind; reason: string }
  | { type: 'drift-new-thread'; threadId: string; prompt: string; branchFrom: 'current' | 'base' }
  | { type: 'drift-settings'; threadId: string; threshold: number; isMuted: boolean }
  | { type: 'edit-goal'; threadId: string; draft: GoalDraft }
  | { type: 'reorder'; pinned: string[]; unpinned: string[] }
  | { type: 'say'; threadId: string; entry: Omit<ActivityEntry, 'at'> }
  | { type: 'restore'; snapshot: Snapshot };

export function initialThreads(): ThreadsState {
  return { now: NOW0, threads: seedThreads(), fired: { overlap: false, scope: false }, seq: 1 };
}

export function threadsReducer(state: State, action: Action): State {
  switch (action.type) {
    case 'tick':
      return tick(state);
    case 'overlap':
      return resolveOverlap(state, action.queueId, action.mode);
    case 'trigger-overlap':
      return triggerOverlap(state);
    case 'add-scope':
      return addScope(state, action.threadId);
    case 'settle':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) => ({ ...t, status: 'settled', settledAt: state.now })),
        queue: state.queue.filter((q) => q.threadId !== action.threadId),
      };
    case 'unsettle':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => ({ ...t, status: hasOpenWork(t) ? 'running' : 'review' })) };
    case 'create':
      return create(state, action);
    case 'send':
      return send(state, action);
    case 'drift-new-thread':
      return driftNewThread(state, action);
    case 'drift-settings':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => ({ ...t, drift: { threshold: action.threshold, isMuted: action.isMuted } })) };
    case 'edit-goal':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => applyDraft(t, action.draft, state.now)) };
    case 'reorder':
      return { ...state, threads: reorderThreads(state.threads, action.pinned, action.unpinned) };
    case 'say':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => log(t, { ...action.entry, at: state.now })) };
    case 'restore':
      return { ...state, ...action.snapshot };
    default:
      return state;
  }
}

export function mapThread(threads: Thread[], id: string, fn: (t: Thread) => Thread) {
  return threads.map((t) => (t.id === id ? fn(t) : t));
}

export function mapStep(thread: Thread, id: string, fn: (s: Step) => Step): Thread {
  return { ...thread, steps: thread.steps.map((s) => (s.id === id ? fn(s) : s)) };
}

export function log(thread: Thread, entry: ActivityEntry): Thread {
  return { ...thread, activity: [...thread.activity, entry] };
}

export function hasOpenWork(t: Thread) {
  return t.steps.some((s) => s.status !== 'done' && s.status !== 'dropped');
}

const SCRIPT = { overlapAt: NOW0 + 6, scopeAt: NOW0 + 40 };
const SPEED = 40;
const TOKENS_PER_TOOL = 900;
const CONTEXT_CEILING = 0.97;

function tick(state: State): State {
  const now = state.now + 1;
  let threads = state.threads;
  let queue = state.queue;

  for (const thread of state.threads) {
    if (thread.status === 'settled') continue;
    for (const s of thread.steps) {
      if (s.status !== 'running') continue;
      const progress = Math.min(1, s.progress + 1 / (s.size * SPEED));
      if (progress < 1) {
        threads = mapThread(threads, thread.id, (t) => withTool(mapStep(t, s.id, (x) => ({ ...x, progress })), s, now));
        continue;
      }
      threads = completeStep(threads, thread.id, s.id, now);
    }
  }

  threads = threads.map((t) => {
    if (t.status === 'settled' || t.status === 'needs-you') return t;
    const running = t.steps.some((s) => s.status === 'running');
    if (running) return t;
    const next = t.steps.find((s) => s.status === 'ready');
    if (next?.gate) {
      queue = [...queue, gateItem(t, next.id, next.title, now)];
      return log(mapStep({ ...t, status: 'needs-you' }, next.id, (s) => ({ ...s, status: 'blocked', note: 'Paused before this step for your approval' })), { at: now, who: 'harness', kind: 'event', text: `Paused before "${next.title}"` });
    }
    if (next) return mapStep({ ...t, status: 'running' }, next.id, (s) => ({ ...s, status: 'running', startedAt: now }));
    if (hasOpenWork(t) || t.status === 'review') return t;
    if (queue.some((q) => q.kind === 'review' && q.threadId === t.id)) return { ...t, status: 'review' };
    queue = [...queue, { id: `q-review-${t.id}`, kind: 'review', threadId: t.id, title: `Review "${t.title}"`, detail: 'Every step is done. Look over the diff and open a PR.', blocks: { steps: 0, threads: 1 }, createdAt: now }];
    return { ...t, status: 'review' };
  });

  let next: State = { ...state, now, threads, queue };
  if (!state.fired.overlap && now >= SCRIPT.overlapAt) next = triggerOverlap(next);
  if (!state.fired.scope && now >= SCRIPT.scopeAt) next = addScope({ ...next, fired: { ...next.fired, scope: true } }, 'rl');
  return next;
}

function withTool(thread: Thread, s: Step, now: number) {
  if (now % 4 !== 0) return thread;
  const tools = FAKE_TOOLS[s.id] ?? genericTools(s.title);
  const used = thread.activity.filter((a) => a.kind === 'tool' && a.at >= (s.startedAt ?? 0)).length;
  const context = { ...thread.context, used: Math.min(Math.round(thread.context.max * CONTEXT_CEILING), thread.context.used + TOKENS_PER_TOOL) };
  return log({ ...thread, context }, { at: now, who: thread.providers[0], kind: 'tool', text: tools[used % tools.length] });
}

function completeStep(threads: Thread[], threadId: string, stepId: string, now: number): Thread[] {
  const source = threads.find((t) => t.id === threadId)!;
  const step = source.steps.find((s) => s.id === stepId)!;
  let next = mapThread(threads, threadId, (t) =>
    checkAcceptance(
      log(
        mapStep(t, stepId, (s) => ({ ...s, status: 'done', progress: 1, doneAt: now })),
        { at: now, who: t.providers[0], kind: 'event', text: `Finished "${step.title}"` },
      ),
      step,
      now,
    ),
  );

  for (const t of next) {
    for (const s of t.steps) {
      const link = s.link;
      if (!link || s.status === 'done' || s.status === 'dropped') continue;
      if (link.mode === 'provided-by' && link.threadId === threadId && link.stepId === stepId) {
        next = mapThread(next, t.id, (x) =>
          log(
            mapStep(x, s.id, (y) => ({ ...y, status: 'done', progress: 1, startedAt: y.startedAt ?? now, doneAt: now, note: `Brought in from "${source.title}", 2 commits cherry-picked` })),
            { at: now, who: 'harness', kind: 'event', text: `"${s.title}" arrived from "${source.title}"` },
          ),
        );
      }
      if (link.mode === 'race' && link.threadId === threadId && link.stepId === stepId) {
        next = mapThread(next, t.id, (x) =>
          log(
            mapStep(x, s.id, (y) => ({ ...y, status: 'dropped', droppedAt: now, note: `Superseded: "${source.title}" finished first` })),
            { at: now, who: 'harness', kind: 'event', text: `Race lost to "${source.title}", its version was brought in` },
          ),
        );
      }
    }
  }
  return next;
}

function triggerOverlap(state: State): State {
  if (state.threads.some((t) => t.steps.some((s) => s.id === 'ad5'))) return { ...state, fired: { ...state.fired, overlap: true } };
  const now = state.now;
  const other = state.threads.find((t) => t.id === 'rl')!;
  const otherStep = other.steps.find((s) => s.id === 'rl5')!;
  const otherBusy = otherStep.status === 'running';
  const threads = mapThread(state.threads, 'adm', (t) => {
    const revision = t.revisions.length + 1;
    const step: Step = {
      id: 'ad5',
      title: 'Add Redis client',
      size: 2,
      status: 'waiting',
      progress: 0,
      footprint: ['packages/cache/redis.ts', 'apps/web/server/cache.ts'],
      addedAt: now,
      addedBy: 'codex',
      revision,
      note: 'Held until you choose how to share it',
    };
    const withStep = { ...t, revisions: [...t.revisions, { n: revision, at: now, label: 'Codex added Redis caching', by: 'codex' as const }], steps: [...t.steps.slice(0, 2), step, ...t.steps.slice(2)] };
    return log(
      log(withStep, { at: now, who: 'codex', kind: 'message', text: 'Usage queries take 1.8s at 10k keys. I will add a Redis client and cache them.' }),
      { at: now, who: 'harness', kind: 'event', text: `Overlap with "${other.title}" sent to your queue` },
    );
  });
  const item: QueueItem = {
    id: `q-overlap-${state.seq}`,
    kind: 'overlap',
    threadId: 'adm',
    title: 'Two threads want to add a Redis client',
    detail: otherBusy
      ? `Codex just planned it here. Claude is already ${Math.round(otherStep.progress * 100)}% through the same step in "${other.title}".`
      : `Codex just planned it here. "${other.title}" has the same step.`,
    blocks: { steps: 1, threads: 2 },
    overlap: { threadId: 'adm', stepId: 'ad5', otherThreadId: 'rl', otherStepId: 'rl5', sharedFiles: ['packages/cache/redis.ts'] },
    createdAt: now,
  };
  return { ...state, threads, queue: [...state.queue, item], fired: { ...state.fired, overlap: true }, seq: state.seq + 1 };
}

function resolveOverlap(state: State, queueId: string, mode: OverlapMode): State {
  const item = state.queue.find((q) => q.id === queueId);
  if (!item?.overlap) return state;
  const { threadId, stepId, otherThreadId, otherStepId } = item.overlap;
  const now = state.now;
  const owner = state.threads.find((t) => t.id === otherThreadId)!;
  const ownerStep = owner.steps.find((s) => s.id === otherStepId)!;
  const asker = state.threads.find((t) => t.id === threadId)!;
  const queue = state.queue.filter((q) => q.id !== queueId);
  const key = `shared-${otherStepId}`;
  let threads = state.threads;

  if (ownerStep.status === 'done' && (mode === 'link' || mode === 'extract')) {
    threads = mapThread(threads, threadId, (t) =>
      log(mapStep(t, stepId, (s) => ({ ...s, status: 'done', progress: 1, startedAt: now, doneAt: now, sharedKey: key, note: `Brought in from "${owner.title}", 2 commits cherry-picked`, link: { mode: 'provided-by', threadId: otherThreadId, stepId: otherStepId } })), {
        at: now,
        who: 'harness',
        kind: 'event',
        text: `"${ownerStep.title}" already landed in "${owner.title}", brought it in`,
      }),
    );
    threads = mapThread(threads, otherThreadId, (t) => mapStep(t, otherStepId, (s) => ({ ...s, sharedKey: key, link: { mode: 'provides-for', threadIds: [threadId] } })));
    return { ...state, threads, queue, seq: state.seq + 1 };
  }

  if (mode === 'link') {
    threads = mapThread(threads, threadId, (t) =>
      log(mapStep(t, stepId, (s) => ({ ...s, status: 'waiting', sharedKey: key, note: `Provided by "${owner.title}"`, link: { mode: 'provided-by', threadId: otherThreadId, stepId: otherStepId } })), {
        at: now,
        who: 'harness',
        kind: 'event',
        text: `Linked: waits on "${ownerStep.title}" from "${owner.title}" and keeps working on other steps`,
      }),
    );
    threads = mapThread(threads, otherThreadId, (t) =>
      log(mapStep(t, otherStepId, (s) => ({ ...s, sharedKey: key, link: { mode: 'provides-for', threadIds: [threadId] } })), { at: now, who: 'harness', kind: 'event', text: `"${asker.title}" now depends on this step` }),
    );
  }

  if (mode === 'extract') {
    const shared: Thread = {
      id: `shared-${state.seq}`,
      spaceId: owner.spaceId,
      repo: owner.repo && { project: owner.repo.project, branch: 'feat/cache-redis-client' },
      title: 'Redis client (shared)',
      goal: `One Redis client both "${owner.title}" and "${asker.title}" build on.`,
      providers: ['claude'],
      status: 'running',
      line: freeLine(state.threads.filter((t) => t.spaceId === owner.spaceId)),
      startedAt: now,
      revisions: [{ n: 1, at: now, label: 'Extracted from 2 threads', by: 'harness' }],
      skills: [],
      sources: owner.sources.filter((src) => src.kind === 'link'),
      context: { used: 12_000, max: 200_000 },
      steps: [{ ...ownerStep, id: `${ownerStep.id}-x`, addedAt: now, startedAt: now, addedBy: 'harness', revision: 1, sharedKey: key, link: { mode: 'provides-for', threadIds: [otherThreadId, threadId] }, note: undefined }],
      activity: [
        { at: now, who: 'harness', kind: 'event', text: `Extracted from "${owner.title}" and "${asker.title}". Kept ${Math.round(ownerStep.progress * 100)}% of Claude's work.` },
      ],
      prs: [],
    };
    const providedBy = { mode: 'provided-by' as const, threadId: shared.id, stepId: shared.steps[0].id };
    threads = mapThread(threads, otherThreadId, (t) => mapStep(t, otherStepId, (s) => ({ ...s, status: 'waiting', sharedKey: key, link: providedBy, note: 'Moved to "Redis client (shared)"' })));
    threads = mapThread(threads, threadId, (t) => mapStep(t, stepId, (s) => ({ ...s, status: 'waiting', sharedKey: key, link: providedBy, note: 'Provided by "Redis client (shared)"' })));
    const ownerIndex = threads.findIndex((t) => t.id === otherThreadId);
    threads = [...threads.slice(0, ownerIndex + 1), shared, ...threads.slice(ownerIndex + 1)];
  }

  if (mode === 'race') {
    threads = mapThread(threads, threadId, (t) => mapStep(t, stepId, (s) => ({ ...s, status: 'running', startedAt: now, sharedKey: key, note: `Racing "${owner.title}"`, link: { mode: 'race', threadId: otherThreadId, stepId: otherStepId } })));
    threads = mapThread(threads, otherThreadId, (t) => mapStep(t, otherStepId, (s) => ({ ...s, sharedKey: key, link: { mode: 'race', threadId, stepId } })));
  }

  if (mode === 'related') {
    threads = mapThread(threads, threadId, (t) => mapStep(t, stepId, (s) => ({ ...s, status: 'ready', note: `Related to "${owner.title}"`, link: { mode: 'related', threadId: otherThreadId, stepId: otherStepId } })));
    threads = mapThread(threads, otherThreadId, (t) => mapStep(t, otherStepId, (s) => ({ ...s, link: { mode: 'related', threadId, stepId } })));
  }

  return { ...state, threads, queue, seq: state.seq + 1 };
}

function freeLine(threads: Thread[]): LineSlot {
  const used = new Set(threads.filter((t) => t.status !== 'settled').map((t) => t.line));
  return ([1, 2, 3, 4, 5] as const).find((l) => !used.has(l)) ?? 5;
}

function addScope(state: State, threadId: string): State {
  const now = state.now;
  return {
    ...state,
    threads: mapThread(state.threads, threadId, (t) => {
      const revision = t.revisions.length + 1;
      const n = t.steps.length;
      const added: Step[] = [
        { id: `${t.id}-s${n}`, title: 'Return RateLimit-* headers', size: 1, status: 'ready', progress: 0, footprint: ['apps/api/middleware/ratelimit.ts'], addedAt: now, addedBy: t.providers[0], revision },
        { id: `${t.id}-s${n + 1}`, title: 'Stricter limits for /search', size: 2, status: 'ready', progress: 0, footprint: ['apps/api/routes/search.ts'], addedAt: now, addedBy: t.providers[0], revision },
      ];
      const withSteps = { ...t, steps: [...t.steps, ...added], revisions: [...t.revisions, { n: revision, at: now, label: `${t.providers[0] === 'claude' ? 'Claude' : 'Codex'} found 2 more steps`, by: t.providers[0] }] };
      return log(withSteps, { at: now, who: 'harness', kind: 'event', text: `Goal v${revision}: +2 steps` });
    }),
  };
}

function create(state: State, action: Extract<Action, { type: 'create' }>): State {
  const now = state.now;
  const id = `new-${state.seq}`;
  const dep = action.dependOn && state.threads.find((t) => t.id === action.dependOn!.threadId);
  const depStep = dep?.steps.find((s) => s.id === action.dependOn!.stepId);
  const base = (sid: string, title: string, size: 1 | 2 | 3): Step => ({ id: sid, title, size, status: 'ready', progress: 0, footprint: [], addedAt: now, addedBy: action.provider, revision: 1 });
  const steps: Step[] = [
    ...(dep && depStep
      ? [{ ...base(`${id}-dep`, depStep.title, depStep.size), status: 'waiting' as const, sharedKey: `shared-${depStep.id}`, note: `Provided by "${dep.title}"`, link: { mode: 'provided-by' as const, threadId: dep.id, stepId: depStep.id } }]
      : []),
    base(`${id}-1`, 'Read the code involved', 1),
    base(`${id}-2`, 'Make the change', 2),
    base(`${id}-3`, 'Add tests', 1),
  ];
  const thread: Thread = {
    id,
    spaceId: state.spaceId,
    repo: action.project ? { project: action.project, branch: `feat/${id}` } : null,
    title: action.title.length > 48 ? `${action.title.slice(0, 47)}…` : action.title,
    goal: action.title,
    providers: [action.provider],
    status: 'running',
    line: freeLine(state.threads.filter((t) => t.spaceId === state.spaceId)),
    startedAt: now,
    revisions: [{ n: 1, at: now, label: 'Goal set', by: 'you' }],
    steps,
    activity: [
      ...(action.branchFrom ? [{ at: now, who: 'harness' as const, kind: 'event' as const, text: `Branched off ${action.branchFrom}` }] : []),
      { at: now, who: 'you', kind: 'message', text: action.title },
    ],
    prs: [],
    skills: [],
    sources: [],
    context: { used: 4_000, max: action.provider === 'codex' ? 272_000 : 200_000 },
  };
  let threads = [...state.threads, thread];
  if (dep && depStep) {
    threads = mapThread(threads, dep.id, (t) =>
      mapStep(t, depStep.id, (s) => ({ ...s, sharedKey: `shared-${depStep.id}`, link: { mode: 'provides-for', threadIds: [...(s.link?.mode === 'provides-for' ? s.link.threadIds : []), id] } })),
    );
  }
  return { ...state, threads, seq: state.seq + 1, views: { ...state.views, [state.spaceId]: { kind: 'thread', id } } };
}

function gateItem(thread: Thread, stepId: string, title: string, now: number): QueueItem {
  const after = thread.steps.filter((s) => s.status === 'ready' && s.id !== stepId).length;
  return {
    id: `q-gate-${stepId}`,
    kind: 'approval',
    threadId: thread.id,
    title: `Start "${title}"`,
    detail: `You asked to approve this step before it runs. Steps after it: ${after}.`,
    blocks: { steps: after + 1, threads: 1 },
    createdAt: now,
  };
}

// GAP: simulated. The real agent runs the command in the thread's worktree and fails the step on a non-zero exit.
function checkAcceptance(thread: Thread, step: Step, now: number) {
  if (!step.acceptance) return thread;
  const what = step.acceptance.command ? `\`${step.acceptance.command}\` passed` : `"${step.acceptance.text}" met`;
  return log(thread, { at: now, who: thread.providers[0], kind: 'event', text: `Checked "${step.title}": ${what}` });
}

function send(state: State, action: Extract<Action, { type: 'send' }>): State {
  const now = state.now;
  return {
    ...state,
    threads: mapThread(state.threads, action.threadId, (t) => {
      const said = log(t, { at: now, who: 'you', kind: 'message', text: action.text, drift: action.drift });
      if (action.drift === 'off-goal') return log(said, { at: now, who: 'harness', kind: 'event', text: `Drift guard: sent off-goal, not counted toward the goal (${action.reason})` });
      if (action.drift === 'on-goal') return said;
      const n = t.revisions.length + 1;
      const title = stepTitleFrom(action.text);
      const added: Step = { id: `${t.id}-d${n}`, title, size: 1, status: 'ready', progress: 0, footprint: [], addedAt: now, addedBy: 'you', revision: n };
      const withStep = { ...said, steps: [...said.steps, added], revisions: [...said.revisions, { n, at: now, label: 'Scope from your message', by: 'you' as const, diff: [`+ ${title}`] }] };
      return log(withStep, { at: now, who: 'harness', kind: 'event', text: `Goal v${n}: +1 step "${title}" (${action.reason})` });
    }),
  };
}

/** Off-goal prompt to a new thread. A finished goal is settled first: its review stays queued while a PR is open, otherwise it resolves. */
function driftNewThread(state: State, action: Extract<Action, { type: 'drift-new-thread' }>): State {
  const source = state.threads.find((t) => t.id === action.threadId);
  if (!source) return state;
  const now = state.now;
  const isGoalDone = source.status === 'review' || progressAt(source, now, true).pct >= 1;
  const hasOpenPr = source.prs.some((p) => p.state === 'open');
  const short = action.prompt.length > 40 ? `${action.prompt.slice(0, 39)}…` : action.prompt;
  let next: State = state;
  if (isGoalDone) {
    const outcome = hasOpenPr ? 'its PR review stays in your queue' : 'review resolved';
    next = {
      ...next,
      threads: mapThread(next.threads, source.id, (t) => log({ ...t, status: 'settled', settledAt: now }, { at: now, who: 'harness', kind: 'event', text: `Goal done, settled to start a new thread; ${outcome}` })),
      queue: next.queue.filter((q) => q.threadId !== source.id || (hasOpenPr && q.kind === 'review')),
    };
  }
  next = { ...next, threads: mapThread(next.threads, source.id, (t) => log(t, { at: now, who: 'harness', kind: 'event', text: `Drift guard: moved "${short}" to a new thread` })) };
  const branchFrom = action.branchFrom === 'current' ? source.repo?.branch : 'the base branch';
  return create(next, { type: 'create', title: action.prompt, provider: source.providers[0], project: source.repo?.project ?? null, branchFrom: source.repo ? branchFrom : undefined });
}
