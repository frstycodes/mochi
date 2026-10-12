import type { AgentEvent } from '../host/types/agent.ts';
import { NOW0, seedThreads, type ActivityEntry, type LineSlot, type Provider, type Step, type Thread } from '../model.ts';
import { stepTitleFrom, type DriftKind } from '../drift.ts';
import { applyDraft, type GoalDraft } from '../goals/edit.ts';
import { progressAt } from '../progress.ts';
import { reorderThreads } from '../reorder.ts';
import { applyAgentEvent, applyAgentEvents } from '../runtime/apply.ts';
import { demoEvents, overlapEvents } from '../runtime/demo.ts';
import { recordCheckpoints, rewind, rewindToMessage, seedCheckpoints, undoRewind, type Checkpoint, type RewindUndo } from '../rewind/checkpoints.ts';
import { forkThread, keepFork, type Fork, type ForkPoint } from '../rewind/fork.ts';
import { handoff } from '../rewind/handoff.ts';
import type { Action, Snapshot, State } from './index.tsx';

export type OverlapMode = 'link' | 'extract' | 'race' | 'related';

export interface ThreadsState {
  now: number;
  threads: Thread[];
  seq: number;
  checkpoints: Record<string, Checkpoint[]>;
  checkpointSeq: number;
  rewindUndo: RewindUndo | null;
  /** Fork thread id → where it was forked from. */
  forks: Record<string, Fork>;
}

export type ThreadsAction =
  | { type: 'tick' }
  | { type: 'agent'; event: AgentEvent }
  | { type: 'overlap'; queueId: string; mode: OverlapMode }
  | { type: 'trigger-overlap' }
  | { type: 'settle'; threadId: string }
  | { type: 'unsettle'; threadId: string }
  | { type: 'create'; title: string; provider: Provider; project: string | null; dependOn?: { threadId: string; stepId: string }; branchFrom?: string }
  | { type: 'send'; threadId: string; text: string; drift: DriftKind; reason: string }
  | { type: 'drift-new-thread'; threadId: string; prompt: string; branchFrom: 'current' | 'base' }
  | { type: 'drift-settings'; threadId: string; threshold: number; isMuted: boolean }
  | { type: 'edit-goal'; threadId: string; draft: GoalDraft }
  | { type: 'reorder'; pinned: string[]; unpinned: string[] }
  | { type: 'say'; threadId: string; entry: Omit<ActivityEntry, 'at'> }
  | { type: 'restore'; snapshot: Snapshot }
  | { type: 'rewind'; threadId: string; n: number }
  | { type: 'rewind-message'; threadId: string; index: number }
  | { type: 'rewind-undo' }
  | { type: 'checkpoint-ref'; threadId: string; n: number; ref: string | null }
  | { type: 'fork'; threadId: string; point: ForkPoint }
  | { type: 'fork-keep'; keepId: string; dropId: string }
  | { type: 'handoff'; threadId: string; stepId?: string; to: Provider; summary: string };

export function initialThreads(): ThreadsState {
  const threads = seedThreads();
  let checkpointSeq = 0;
  const checkpoints = Object.fromEntries(
    threads.map((t) => {
      const list = seedCheckpoints(t, checkpointSeq);
      checkpointSeq += list.length;
      return [t.id, list];
    }),
  );
  return { now: NOW0, threads, seq: 1, checkpoints, checkpointSeq, rewindUndo: null, forks: {} };
}

export function threadsReducer(state: State, action: Action): State {
  const next = reduce(state, action);
  return next === state ? state : recordCheckpoints(state, next);
}

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'tick':
      return tick(state);
    case 'overlap':
      return resolveOverlap(state, action.queueId, action.mode);
    case 'agent':
      return applyAgentEvent(state, action.event);
    case 'trigger-overlap':
      return triggerOverlap(state);
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
    case 'rewind':
      return rewind(state, action.threadId, action.n);
    case 'rewind-message':
      return rewindToMessage(state, action.threadId, action.index);
    case 'rewind-undo':
      return undoRewind(state);
    case 'checkpoint-ref':
      return {
        ...state,
        checkpoints: { ...state.checkpoints, [action.threadId]: (state.checkpoints[action.threadId] ?? []).map((c) => (c.n === action.n ? { ...c, ref: action.ref ?? undefined, wantsFiles: false } : c)) },
      };
    case 'fork':
      return forkThread(state, action.threadId, action.point);
    case 'fork-keep':
      return keepFork(state, action.keepId, action.dropId);
    case 'handoff':
      return handoff(state, action.threadId, action.stepId, action.to, action.summary);
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

/** One simulated minute: the clock moves and every demo thread (no live session) reports what it did. */
function tick(state: State): State {
  let next: State = { ...state, now: state.now + 1 };
  for (const { id } of state.threads) {
    const thread = next.threads.find((t) => t.id === id);
    // GAP: a thread counts as demo until a real adapter reports a session; R1 decides which threads start a real agent.
    if (thread && !thread.session) next = applyAgentEvents(next, demoEvents(thread, next.now));
  }
  return next;
}

export function completeStep(threads: Thread[], threadId: string, stepId: string, now: number): Thread[] {
  const source = threads.find((t) => t.id === threadId)!;
  const step = source.steps.find((s) => s.id === stepId)!;
  let next = mapThread(threads, threadId, (t) =>
    checkAcceptance(
      log(
        mapStep(t, stepId, (s) => ({ ...s, status: 'done', progress: 1, doneAt: now })),
        { at: now, who: step.owner ?? t.providers[0], kind: 'event', text: `Finished "${step.title}"` },
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
  const adm = state.threads.find((t) => t.id === 'adm');
  if (!adm || adm.steps.some((s) => s.title === 'Add Redis client')) return state;
  return applyAgentEvents(state, overlapEvents(adm));
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

export function freeLine(threads: Thread[]): LineSlot {
  const used = new Set(threads.filter((t) => t.status !== 'settled').map((t) => t.line));
  return ([1, 2, 3, 4, 5] as const).find((l) => !used.has(l)) ?? 5;
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
