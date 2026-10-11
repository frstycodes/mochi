import { createContext, useContext, useEffect, useReducer, type Dispatch, type ReactNode } from 'react';
import {
  FAKE_TOOLS,
  genericTools,
  NOW0,
  SPACES,
  seedQueue,
  seedPanes,
  seedThreads,
  type ActivityEntry,
  type Pane,
  type PaneTabKind,
  type LineSlot,
  type Provider,
  type QueueItem,
  type Step,
  type Thread,
} from './model';
import { reorderThreads } from './reorder';

export type View = { kind: 'queue' } | { kind: 'board' } | { kind: 'new' } | { kind: 'thread'; id: string };
export type OverlapMode = 'link' | 'extract' | 'race' | 'related';

export interface Snapshot {
  threads: Thread[];
  queue: QueueItem[];
}

export interface State extends Snapshot {
  now: number;
  panes: Pane[];
  spaceId: string;
  views: Record<string, View>;
  paused: boolean;
  fired: { overlap: boolean; scope: boolean };
  seq: number;
}

export type Action =
  | { type: 'tick' }
  | { type: 'go'; view: View }
  | { type: 'space'; id: string }
  | { type: 'answer'; queueId: string; choice?: string }
  | { type: 'overlap'; queueId: string; mode: OverlapMode }
  | { type: 'trigger-overlap' }
  | { type: 'add-scope'; threadId: string }
  | { type: 'settle'; threadId: string }
  | { type: 'unsettle'; threadId: string }
  | { type: 'create'; title: string; provider: Provider; project: string | null; dependOn?: { threadId: string; stepId: string } }
  | { type: 'reorder'; pinned: string[]; unpinned: string[] }
  | { type: 'say'; threadId: string; entry: Omit<ActivityEntry, 'at'> }
  | { type: 'restore'; snapshot: Snapshot }
  | { type: 'pane-toggle'; threadId: string }
  | { type: 'pane-open-tab'; threadId: string; kind: PaneTabKind }
  | { type: 'pane-select-tab'; threadId: string; tabId: string }
  | { type: 'pane-close-tab'; threadId: string; tabId: string }
  | { type: 'pane-pop'; threadId: string; tabId: string; isPopped: boolean }
  | { type: 'pause' }
  | { type: 'reset' };

function initialState(): State {
  return {
    now: NOW0,
    spaceId: 'latitude',
    views: { latitude: { kind: 'thread', id: 'adm' }, personal: { kind: 'thread', id: 'lobby' }, liane: { kind: 'board' } },
    panes: seedPanes(),
    threads: seedThreads(),
    queue: seedQueue(),
    paused: false,
    fired: { overlap: false, scope: false },
    seq: 1,
  };
}

const HarnessContext = createContext<{ state: State; dispatch: Dispatch<Action> } | null>(null);

export function HarnessProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  useEffect(() => {
    if (state.paused) return;
    const id = setInterval(() => dispatch({ type: 'tick' }), 1000);
    return () => clearInterval(id);
  }, [state.paused]);
  return <HarnessContext.Provider value={{ state, dispatch }}>{children}</HarnessContext.Provider>;
}

export function useHarness() {
  const ctx = useContext(HarnessContext);
  if (!ctx) throw new Error('useHarness must be used inside HarnessProvider');
  return ctx;
}

export function useSpace() {
  const { state } = useHarness();
  return SPACES.find((s) => s.id === state.spaceId)!;
}

export function useView(spaceId?: string) {
  const { state } = useHarness();
  return state.views[spaceId ?? state.spaceId];
}

export function useThread(id: string) {
  const { state } = useHarness();
  return state.threads.find((t) => t.id === id);
}

export function useSpaceThreads(spaceId?: string) {
  const { state } = useHarness();
  const id = spaceId ?? state.spaceId;
  return state.threads.filter((t) => t.spaceId === id);
}

export function useSpaceQueue(spaceId?: string) {
  const { state } = useHarness();
  const id = spaceId ?? state.spaceId;
  const ids = new Set(state.threads.filter((t) => t.spaceId === id).map((t) => t.id));
  return rankQueue(state.queue.filter((q) => ids.has(q.threadId)));
}

export function rankQueue(items: QueueItem[]) {
  const weight = (q: QueueItem) => q.blocks.steps * 2 + q.blocks.threads * 3 + (q.kind === 'overlap' ? 4 : 0);
  return [...items].sort((a, b) => weight(b) - weight(a) || a.createdAt - b.createdAt);
}

export function snapshot(state: State): Snapshot {
  return { threads: state.threads, queue: state.queue };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'tick':
      return tick(state);
    case 'go': {
      const view = action.view;
      const spaceId = view.kind === 'thread' ? (state.threads.find((t) => t.id === view.id)?.spaceId ?? state.spaceId) : state.spaceId;
      return { ...state, spaceId, views: { ...state.views, [spaceId]: action.view } };
    }
    case 'space':
      return { ...state, spaceId: action.id };
    case 'answer':
      return answer(state, action.queueId, action.choice);
    case 'overlap':
      return resolveOverlap(state, action.queueId, action.mode);
    case 'trigger-overlap':
      return triggerOverlap(state);
    case 'add-scope':
      return addScope(state, action.threadId);
    case 'settle':
      return {
        ...state,
        threads: mapThread(state.threads, action.threadId, (t) => ({ ...t, status: 'settled' })),
        queue: state.queue.filter((q) => q.threadId !== action.threadId),
      };
    case 'unsettle':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => ({ ...t, status: hasOpenWork(t) ? 'running' : 'review' })) };
    case 'create':
      return create(state, action);
    case 'reorder':
      return { ...state, threads: reorderThreads(state.threads, action.pinned, action.unpinned) };
    case 'say':
      return { ...state, threads: mapThread(state.threads, action.threadId, (t) => log(t, { ...action.entry, at: state.now })) };
    case 'restore':
      return { ...state, ...action.snapshot };
    case 'pane-toggle': {
      const pane = state.panes.find((p) => p.threadId === action.threadId);
      if (pane) return { ...state, panes: mapPane(state.panes, action.threadId, (p) => ({ ...p, isOpen: !p.isOpen })) };
      return { ...state, panes: [...state.panes, newPane(action.threadId, state.seq)], seq: state.seq + 1 };
    }
    case 'pane-open-tab': {
      const thread = state.threads.find((t) => t.id === action.threadId);
      const tab = { id: `tab-${state.seq}`, kind: action.kind, title: TAB_TITLES[action.kind], url: action.kind === 'browser' ? `localhost:3000/${thread?.repo?.branch.split('/')[1] ?? ''}` : undefined };
      const existing = state.panes.find((p) => p.threadId === action.threadId) ?? newPane(action.threadId, state.seq);
      const pane = { ...existing, isOpen: true, tabs: [...existing.tabs.filter((t) => t.kind !== 'new'), tab], activeTab: tab.id };
      return { ...state, panes: [...state.panes.filter((p) => p.threadId !== action.threadId), pane], seq: state.seq + 1 };
    }
    case 'pane-select-tab':
      return { ...state, panes: mapPane(state.panes, action.threadId, (p) => ({ ...p, activeTab: action.tabId })) };
    case 'pane-pop':
      return {
        ...state,
        panes: mapPane(state.panes, action.threadId, (p) => {
          const tabs = p.tabs.map((t) => (t.id === action.tabId ? { ...t, isPopped: action.isPopped } : t));
          const docked = tabs.filter((t) => !t.isPopped);
          const activeTab = action.isPopped ? (p.activeTab === action.tabId ? (docked[docked.length - 1]?.id ?? '') : p.activeTab) : action.tabId;
          return { ...p, isOpen: action.isPopped ? p.isOpen : true, tabs, activeTab };
        }),
      };
    case 'pane-close-tab':
      return {
        ...state,
        panes: mapPane(state.panes, action.threadId, (p) => {
          const tabs = p.tabs.filter((t) => t.id !== action.tabId);
          if (tabs.length === 0) return { ...p, isOpen: false, tabs: [], activeTab: '' };
          return { ...p, tabs, activeTab: p.activeTab === action.tabId ? tabs[tabs.length - 1].id : p.activeTab };
        }),
      };
    case 'pause':
      return { ...state, paused: !state.paused };
    case 'reset':
      return initialState();
  }
}

const TAB_TITLES = { browser: 'Preview', changes: 'Changes', terminal: 'Terminal', new: 'New tab' } satisfies Record<PaneTabKind, string>;

function newPane(threadId: string, seq: number): Pane {
  return { threadId, isOpen: true, tabs: [{ id: `tab-${seq}`, kind: 'new', title: TAB_TITLES.new }], activeTab: `tab-${seq}` };
}

function mapPane(panes: Pane[], threadId: string, fn: (p: Pane) => Pane) {
  return panes.map((p) => (p.threadId === threadId ? fn(p) : p));
}

function mapThread(threads: Thread[], id: string, fn: (t: Thread) => Thread) {
  return threads.map((t) => (t.id === id ? fn(t) : t));
}

function mapStep(thread: Thread, id: string, fn: (s: Step) => Step): Thread {
  return { ...thread, steps: thread.steps.map((s) => (s.id === id ? fn(s) : s)) };
}

function log(thread: Thread, entry: ActivityEntry): Thread {
  return { ...thread, activity: [...thread.activity, entry] };
}

function hasOpenWork(t: Thread) {
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
    log(
      mapStep(t, stepId, (s) => ({ ...s, status: 'done', progress: 1, doneAt: now })),
      { at: now, who: t.providers[0], kind: 'event', text: `Finished "${step.title}"` },
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

function answer(state: State, queueId: string, choice?: string): State {
  const item = state.queue.find((q) => q.id === queueId);
  if (!item) return state;
  const now = state.now;
  const queue = state.queue.filter((q) => q.id !== queueId);
  const label = item.choices?.find((c) => c.id === choice)?.label;

  const threads = mapThread(state.threads, item.threadId, (t) => {
    if (item.kind === 'review') {
      const prs = t.prs.map((p) => (p.state === 'open' ? { ...p, state: 'merged' as const } : p));
      const done = !hasOpenWork(t);
      return log({ ...t, prs, status: done ? 'settled' : t.status }, { at: now, who: 'you', kind: 'event', text: done ? 'Approved and merged. Every PR is merged, thread settled.' : 'Approved and merged' });
    }
    const blocked = t.steps.find((s) => s.status === 'blocked');
    const unblocked = blocked ? mapStep(t, blocked.id, (s) => ({ ...s, status: 'running', note: undefined })) : t;
    const text = item.kind === 'approval' ? `Approved: ${item.code ?? item.title}` : (label ?? 'Answered');
    return log({ ...unblocked, status: 'running' }, { at: now, who: 'you', kind: item.kind === 'approval' ? 'event' : 'message', text });
  });
  return { ...state, threads, queue };
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
    activity: [{ at: now, who: 'you', kind: 'message', text: action.title }],
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
