import type { AgentDecision, AgentEvent, AgentPlanItem } from '../host/types/agent.ts';
import { noteCollisions } from './collisions.ts';
import type { ActivityEntry, AgentInfo, Provider, QueueItem, Step, Thread } from '../model.ts';
import { pauseQueue } from '../chat/outbox.ts';
import { similarity } from '../progress.ts';
import type { Action, State } from '../store/index.tsx';
import { completeStep, hasOpenWork, log, mapStep, mapThread } from '../store/threads.ts';
import { hitLimit, isLimitEnd, warnLimit } from './limits.ts';
import { applySubagent, fromBackground } from './subagents.ts';

/** Folds one agent event into the store. The harness goal stays canonical: plans are reconciled onto it, never replace it. */
export function applyAgentEvent(state: State, event: AgentEvent): State {
  // Any word from the agent means it's up; its folder being made and set up is main's, not the agent's.
  if (event.type !== 'worktree' && event.type !== 'setup' && state.threads.find((t) => t.id === event.threadId)?.live?.starting) {
    state = { ...state, threads: mapThread(state.threads, event.threadId, (t) => ({ ...t, live: { ...t.live!, starting: undefined } })) };
  }
  const thread = state.threads.find((t) => t.id === event.threadId);
  if (!thread) return fromBackground(state, event, applyAgentEvent) ?? state;
  const now = state.now;
  const who = actor(thread);
  const update = (fn: (t: Thread) => Thread): State => ({ ...state, threads: mapThread(state.threads, thread.id, fn) });

  switch (event.type) {
    case 'worktree':
      return update((t) => ({ ...t, live: t.live && { ...t.live, cwd: event.path } }));
    case 'setup':
      // A failed step waits on you like an approval does; Retry or Skip setup puts it back to running.
      return update((t) => ({ ...t, setup: event.setup, status: event.setup.status === 'failed' ? 'needs-you' : t.setup?.status === 'failed' && t.status === 'needs-you' ? 'running' : t.status }));
    case 'branch':
      return update((t) => ({ ...t, repo: t.repo && { ...t.repo, branch: event.branch } }));
    case 'session':
      return update((t) => ({ ...t, session: { ...t.session, provider: event.provider, id: event.sessionId }, agent: {} }));
    case 'info':
      return update((t) => ({ ...t, agent: mergeInfo(t.agent, event.info) }));
    case 'message':
      return update((t) => {
        // A delta continues the block the agent is streaming, even when your message (a steer) or an event landed after it.
        const i = event.isDelta ? t.activity.findLastIndex((e) => e.kind === 'message' && e.who === who) : -1;
        if (i < 0) return log(t, { at: now, who, kind: 'message', text: event.text });
        return { ...t, activity: t.activity.map((e, j) => (j === i ? { ...e, text: e.text + event.text } : e)) };
      });
    case 'reasoning':
      return update((t) => log(t, { at: now, who, kind: 'reasoning', text: event.text }));
    case 'tool':
      if (event.phase === 'start') return update((t) => log(t, { at: now, who, kind: 'tool', text: event.text, toolId: event.id, ...(event.description && { description: event.description }), ...(event.links && { links: event.links }), ...(event.skill && { skill: event.skill }), ...(event.mcp && { mcp: event.mcp }) }));
      state = update((t) => ({ ...t, activity: t.activity.map((e) => (e.toolId === event.id ? { ...e, ...toolEnd(event) } : e)) }));
      if (!event.files?.length) return state;
      if (event.patch) state = noteCollisions(state, thread.id);
      return update((t) => ({ ...t, steps: t.steps.map((s) => (s.status === 'running' ? { ...s, footprint: [...new Set([...s.footprint, ...event.files!])] } : s)) }));
    case 'plan':
      return applyPlan(state, thread, event.items);
    case 'subagent':
      return applySubagent(state, thread, event, who);
    case 'approval':
      return waitOnYou(state, thread, { id: `q-${event.requestId}`, kind: 'approval', title: event.title, detail: event.detail, code: event.code, requestId: event.requestId }, 'Paused for your approval');
    case 'question': {
      const { questions } = event;
      if (!questions.length) return state;
      const title = questions.length === 1 ? questions[0].text : `Answer ${questions.length} questions`;
      return waitOnYou(state, thread, { id: `q-${event.requestId}`, kind: 'question', title, detail: '', questions, requestId: event.requestId }, 'Waiting on your answer');
    }
    case 'resolved':
      return withdraw(state, thread, `q-${event.requestId}`);
    case 'usage':
      return update((t) => ({
        ...t,
        context: { used: event.contextUsed ?? t.context.used, max: event.contextMax ?? t.context.max },
        session: t.session && event.inputTokens + event.outputTokens > 0 ? { ...t.session, usage: addUsage(t.session.usage, event) } : t.session,
      }));
    case 'limit-warning':
      return update((t) => warnLimit(t, event.window, now, who));
    case 'limit':
      return update((t) => hitLimit(t, event, now));
    case 'turn-end': {
      if (event.status === 'interrupted' && thread.live?.isReplacingTurn) return update((t) => log({ ...t, live: { ...t.live!, isReplacingTurn: undefined } }, { at: now, who: 'harness', kind: 'event', text: 'Turn interrupted for your queued message' }));
      const ended = thread.live ? update((t) => ({ ...t, live: { ...t.live!, isWorking: false, isWrappingUp: undefined } })) : state;
      if (isLimitEnd(thread)) return ended;
      return endTurn(event.status === 'done' ? ended : { ...ended, threads: mapThread(ended.threads, thread.id, (t) => pauseQueue(t, event.status === 'failed' ? 'failed' : 'interrupted')) }, thread, event);
    }
  }
}

/** What a tool call's end adds to the entry its start logged. */
function toolEnd(event: Extract<AgentEvent, { type: 'tool' }>): Partial<ActivityEntry> {
  const { text, links, output, exitCode, patch } = event;
  return { ...(links && { text, links }), ...(output !== undefined && { output }), ...(exitCode !== undefined && { exitCode }), ...(patch && { patch }) };
}

export function applyAgentEvents(state: State, events: AgentEvent[]): State {
  return events.reduce(applyAgentEvent, state);
}

/** What answering a queue item tells the agent that asked. Demo threads have no session and resolve in the store alone. */
export function resolution(state: State, action: Action): { requestId: string; decision: AgentDecision } | null {
  if (action.type !== 'answer') return null;
  const item = state.queue.find((q) => q.id === action.queueId);
  if (!item?.requestId) return null;
  if (!state.threads.find((t) => t.id === item.threadId)?.session) return null;
  if (item.kind !== 'question') return { requestId: item.requestId, decision: { kind: 'allow' } };
  return { requestId: item.requestId, decision: { kind: 'answer', answers: action.answers ?? [] } };
}

const MATCH = 0.6;
const OVERLAP = 0.8;

function applyPlan(state: State, thread: Thread, items: AgentPlanItem[]): State {
  const now = state.now;
  const provider = actor(thread);
  const claimed = new Set<string>();
  const matches = items.map((item) => {
    const open = thread.steps.filter((s) => s.status !== 'dropped' && !claimed.has(s.id));
    const step = open.find((s) => s.title === item.title) ?? bestMatch(open, item.title);
    if (step) claimed.add(step.id);
    return step;
  });

  let threads = state.threads;
  items.forEach((item, i) => {
    const step = matches[i];
    if (!step || item.status === 'pending') return;
    if (item.status === 'done') {
      if (step.status !== 'done') threads = completeStep(threads, thread.id, step.id, now);
      return;
    }
    if (step.status !== 'ready' && step.status !== 'running') return;
    threads = mapThread(threads, thread.id, (t) => ({
      ...mapStep(t, step.id, (s) => ({ ...s, status: 'running', startedAt: s.startedAt ?? now, progress: item.progress ?? s.progress })),
      status: t.status === 'needs-you' ? t.status : 'running',
    }));
  });

  const dropped = thread.steps.filter((s) => !claimed.has(s.id) && s.addedBy === provider && !s.link && s.status !== 'done' && s.status !== 'dropped');
  for (const step of dropped) {
    threads = mapThread(threads, thread.id, (t) =>
      log(mapStep(t, step.id, (s) => ({ ...s, status: 'dropped', droppedAt: now, note: `Dropped by ${NAMES[provider]}` })), { at: now, who: 'harness', kind: 'event', text: `${NAMES[provider]} dropped "${step.title}"` }),
    );
  }

  const added = items.flatMap((item, i) => (matches[i] ? [] : [{ item, after: matches.slice(0, i).findLast(Boolean) }]));
  const next = { ...state, threads };
  return added.length ? addScope(next, thread.id, provider, added) : next;
}

function bestMatch(steps: Step[], title: string) {
  let best: Step | undefined;
  let score = MATCH;
  for (const s of steps) {
    const value = similarity(title, s.title);
    if (value < score) continue;
    best = s;
    score = value;
  }
  return best;
}

/** Steps the agent planned that the goal doesn't have yet: plan changes, logged, never a goal revision. */
function addScope(state: State, threadId: string, provider: Provider, added: { item: AgentPlanItem; after?: Step }[]): State {
  const now = state.now;
  const thread = state.threads.find((t) => t.id === threadId)!;
  const revision = thread.revisions.at(-1)?.n ?? 1;
  let steps = thread.steps;
  const created: Step[] = [];
  added.forEach(({ item, after }, k) => {
    const step: Step = {
      id: `${thread.id}-s${steps.length}`,
      title: item.title,
      size: item.size ?? 1,
      status: item.status === 'pending' ? 'ready' : item.status,
      progress: item.status === 'done' ? 1 : (item.progress ?? 0),
      footprint: item.files ?? [],
      addedAt: now,
      addedBy: provider,
      revision,
      ...(item.status !== 'pending' && { startedAt: now }),
      ...(item.status === 'done' && { doneAt: now }),
    };
    const anchor = k > 0 && added[k - 1].after === after ? created.at(-1) : after;
    const at = anchor ? steps.findIndex((s) => s.id === anchor.id) + 1 : 0;
    steps = [...steps.slice(0, at), step, ...steps.slice(at)];
    created.push(step);
  });
  const label = created.length === 1 ? `${NAMES[provider]} added "${created[0].title}"` : `${NAMES[provider]} found ${created.length} more steps`;
  let next: State = {
    ...state,
    threads: mapThread(state.threads, threadId, (t) =>
      log({ ...t, steps }, { at: now, who: 'harness', kind: 'event', text: `Plan: ${label}` }),
    ),
  };
  for (const step of created) next = holdOverlap(next, threadId, step);
  return next;
}

/** A step another thread already has goes on hold, and the choice of how to share it goes to the queue. */
function holdOverlap(state: State, threadId: string, step: Step): State {
  const thread = state.threads.find((t) => t.id === threadId)!;
  const other = state.threads
    .filter((t) => t.id !== threadId && t.spaceId === thread.spaceId && t.status !== 'settled')
    .flatMap((t) => t.steps.filter((s) => s.status !== 'dropped' && !s.link && similarity(step.title, s.title) >= OVERLAP).map((s) => ({ thread: t, step: s })))[0];
  if (!other || step.status === 'done') return state;
  const now = state.now;
  const shared = other.step.footprint.filter((f) => step.footprint.includes(f));
  const isBusy = other.step.status === 'running';
  const item: QueueItem = {
    id: `q-overlap-${state.seq}`,
    kind: 'overlap',
    threadId,
    title: `Two threads want to ${step.title.charAt(0).toLowerCase()}${step.title.slice(1)}`,
    detail: isBusy
      ? `${NAMES[step.addedBy as Provider] ?? 'The agent'} just planned it here. ${NAMES[actor(other.thread)]} is already ${Math.round(other.step.progress * 100)}% through the same step in "${other.thread.title}".`
      : `${NAMES[step.addedBy as Provider] ?? 'The agent'} just planned it here. "${other.thread.title}" has the same step.`,
    blocks: { steps: 1, threads: 2 },
    overlap: { threadId, stepId: step.id, otherThreadId: other.thread.id, otherStepId: other.step.id, sharedFiles: shared.length ? shared : other.step.footprint },
    createdAt: now,
  };
  return {
    ...state,
    seq: state.seq + 1,
    queue: [...state.queue, item],
    threads: mapThread(state.threads, threadId, (t) =>
      log(mapStep(t, step.id, (s) => ({ ...s, status: 'waiting', startedAt: undefined, note: 'Held until you choose how to share it' })), { at: now, who: 'harness', kind: 'event', text: `Overlap with "${other.thread.title}" sent to your queue` }),
    ),
  };
}

function waitOnYou(state: State, thread: Thread, item: Omit<QueueItem, 'threadId' | 'blocks' | 'createdAt'>, note: string): State {
  if (state.queue.some((q) => q.id === item.id)) return state;
  const now = state.now;
  const ready = thread.steps.filter((s) => s.status === 'ready').length;
  return {
    ...state,
    queue: [...state.queue, { ...item, threadId: thread.id, blocks: { steps: ready + 1, threads: 1 }, createdAt: now }],
    threads: mapThread(state.threads, thread.id, (t) =>
      log({ ...t, status: 'needs-you', steps: t.steps.map((s) => (s.status === 'running' ? { ...s, status: 'blocked', note } : s)) }, { at: now, who: 'harness', kind: 'event', text: `Waiting on you: ${item.title}` }),
    ),
  };
}

/** The agent took a request back; the step it blocked resumes, as when you answer it. */
function withdraw(state: State, thread: Thread, queueId: string): State {
  const item = state.queue.find((q) => q.id === queueId);
  if (!item) return state;
  const now = state.now;
  const isWaiting = state.queue.some((q) => q.id !== queueId && q.threadId === thread.id && (q.kind === 'approval' || q.kind === 'question'));
  return {
    ...state,
    queue: state.queue.filter((q) => q.id !== queueId),
    threads: mapThread(state.threads, thread.id, (t) =>
      log(
        isWaiting ? t : { ...t, status: 'running', steps: t.steps.map((s) => (s.status === 'blocked' ? { ...s, status: 'running', note: undefined } : s)) },
        { at: now, who: 'harness', kind: 'event', text: `Withdrawn by the agent: ${item.title}` },
      ),
    ),
  };
}

function endTurn(state: State, thread: Thread, event: Extract<AgentEvent, { type: 'turn-end' }>): State {
  const now = state.now;
  const update = (fn: (t: Thread) => Thread): State => ({ ...state, threads: mapThread(state.threads, thread.id, fn) });
  if (event.status === 'interrupted') return update((t) => log(t, { at: now, who: 'harness', kind: 'event', text: 'Turn interrupted' }));
  if (event.status === 'failed') return update((t) => log({ ...t, status: 'needs-you' }, { at: now, who: 'harness', kind: 'event', text: `Turn failed${event.error ? `: ${event.error}` : ''}` }));
  // A turn with no plan (a plain question) has nothing to review.
  if (hasOpenWork(thread) || thread.status === 'review' || thread.status === 'settled' || !thread.steps.length) return state;
  if (state.queue.some((q) => q.kind === 'review' && q.threadId === thread.id)) return update((t) => ({ ...t, status: 'review' }));
  const review: QueueItem = { id: `q-review-${thread.id}`, kind: 'review', threadId: thread.id, title: `Review "${thread.title}"`, detail: 'Every step is done. Look over the diff and open a PR.', blocks: { steps: 0, threads: 1 }, createdAt: now };
  return { ...update((t) => ({ ...t, status: 'review' })), queue: [...state.queue, review] };
}

/** Who speaks for a thread right now: its live session, else the owner of the step in flight, else its first provider. */
function actor(thread: Thread): Provider {
  return thread.session?.provider ?? thread.steps.find((s) => s.status === 'running')?.owner ?? thread.providers[0];
}

function mergeInfo(info: AgentInfo = {}, update: AgentInfo): AgentInfo {
  if (!update.mcpServers) return { ...info, ...update };
  const servers = new Map((info.mcpServers ?? []).map((s) => [s.name, s]));
  for (const s of update.mcpServers) servers.set(s.name, { ...servers.get(s.name), ...s });
  return { ...info, ...update, mcpServers: [...servers.values()] };
}

const NAMES = { claude: 'Claude', codex: 'Codex' } satisfies Record<Provider, string>;

function addUsage(usage: { input: number; output: number; cached?: number; costUsd?: number } | undefined, event: Extract<AgentEvent, { type: 'usage' }>) {
  const costUsd = usage?.costUsd === undefined && event.costUsd === undefined ? undefined : (usage?.costUsd ?? 0) + (event.costUsd ?? 0);
  const cached = usage?.cached === undefined && event.cachedTokens === undefined ? undefined : (usage?.cached ?? 0) + (event.cachedTokens ?? 0);
  return { input: (usage?.input ?? 0) + event.inputTokens, output: (usage?.output ?? 0) + event.outputTokens, cached, costUsd };
}
