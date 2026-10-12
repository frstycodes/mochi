import type { AgentDecision, AgentEvent, AgentPlanItem } from '../host/types/agent.ts';
import type { Provider, QueueItem, Step, Thread } from '../model.ts';
import { similarity } from '../progress.ts';
import { getPrefs } from '../settings/prefs.ts';
import type { Action, State } from '../store/index.tsx';
import { completeStep, hasOpenWork, log, mapStep, mapThread } from '../store/threads.ts';

/** Folds one agent event into the store. The harness goal stays canonical: plans are reconciled onto it, never replace it. */
export function applyAgentEvent(state: State, event: AgentEvent): State {
  const thread = state.threads.find((t) => t.id === event.threadId);
  if (!thread) return state;
  const now = state.now;
  const who = actor(thread);
  const update = (fn: (t: Thread) => Thread): State => ({ ...state, threads: mapThread(state.threads, thread.id, fn) });

  switch (event.type) {
    case 'session':
      return update((t) => ({ ...t, session: { ...t.session, provider: event.provider, id: event.sessionId } }));
    case 'message':
      return update((t) => {
        const last = t.activity.at(-1);
        if (!event.isDelta || last?.kind !== 'message' || last.who !== who) return log(t, { at: now, who, kind: 'message', text: event.text });
        return { ...t, activity: [...t.activity.slice(0, -1), { ...last, text: last.text + event.text }] };
      });
    case 'reasoning':
      return update((t) => log(t, { at: now, who, kind: 'reasoning', text: event.text }));
    case 'tool':
      if (event.phase === 'start') return update((t) => log(t, { at: now, who, kind: 'tool', text: event.text }));
      if (!event.files?.length) return state;
      return update((t) => ({ ...t, steps: t.steps.map((s) => (s.status === 'running' ? { ...s, footprint: [...new Set([...s.footprint, ...event.files!])] } : s)) }));
    case 'plan':
      return applyPlan(state, thread, event.items);
    case 'approval':
      return waitOnYou(state, thread, { id: `q-${event.requestId}`, kind: 'approval', title: event.title, detail: event.detail, code: event.code, requestId: event.requestId }, 'Paused for your approval');
    case 'question': {
      // GAP: a queue item holds one choice list, so only the first question shows; the rest wait for a multi-question card.
      const [first] = event.questions;
      const more = event.questions.length - 1;
      return waitOnYou(
        state,
        thread,
        { id: `q-${event.requestId}`, kind: 'question', title: first.text, detail: more ? `${more} more question${more === 1 ? '' : 's'} after this one.` : '', choices: first.options.map((label, i) => ({ id: String(i), label })), requestId: event.requestId },
        'Waiting on your answer',
      );
    }
    case 'resolved':
      return withdraw(state, thread, `q-${event.requestId}`);
    case 'usage':
      return update((t) => ({
        ...t,
        context: { used: event.contextUsed ?? t.context.used, max: event.contextMax ?? t.context.max },
        session: t.session && event.inputTokens + event.outputTokens > 0 ? { ...t.session, usage: addUsage(t.session.usage, event) } : t.session,
      }));
    case 'limit':
      return update((t) => log({ ...t, status: 'needs-you' }, { at: now, who: 'harness', kind: 'event', text: `Usage limit reached${event.resetsAt ? `, resumes after ${new Date(event.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}` }));
    case 'turn-end':
      return endTurn(state, thread, event);
  }
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
  const label = item.choices?.find((c) => c.id === action.choice)?.label;
  return { requestId: item.requestId, decision: { kind: 'answer', answers: label ? [label] : [] } };
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

/** The scope-add revision flow for steps the agent planned that the goal doesn't have yet. */
function addScope(state: State, threadId: string, provider: Provider, added: { item: AgentPlanItem; after?: Step }[]): State {
  const now = state.now;
  const thread = state.threads.find((t) => t.id === threadId)!;
  const revision = thread.revisions.length + 1;
  let steps = thread.steps;
  const created: Step[] = [];
  added.forEach(({ item, after }, k) => {
    const step: Step = {
      id: `${thread.id}-s${steps.length}`,
      title: item.title,
      size: item.size ?? getPrefs().stepSize,
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
      log({ ...t, steps, revisions: [...t.revisions, { n: revision, at: now, label, by: provider }] }, { at: now, who: 'harness', kind: 'event', text: `Goal v${revision}: +${created.length} step${created.length === 1 ? '' : 's'}` }),
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
  if (hasOpenWork(thread) || thread.status === 'review' || thread.status === 'settled') return state;
  if (state.queue.some((q) => q.kind === 'review' && q.threadId === thread.id)) return update((t) => ({ ...t, status: 'review' }));
  const review: QueueItem = { id: `q-review-${thread.id}`, kind: 'review', threadId: thread.id, title: `Review "${thread.title}"`, detail: 'Every step is done. Look over the diff and open a PR.', blocks: { steps: 0, threads: 1 }, createdAt: now };
  return { ...update((t) => ({ ...t, status: 'review' })), queue: [...state.queue, review] };
}

/** Who speaks for a thread right now: its live session, else the owner of the step in flight, else its first provider. */
function actor(thread: Thread): Provider {
  return thread.session?.provider ?? thread.steps.find((s) => s.status === 'running')?.owner ?? thread.providers[0];
}

const NAMES = { claude: 'Claude', codex: 'Codex' } satisfies Record<Provider, string>;

function addUsage(usage: { input: number; output: number; costUsd?: number } | undefined, event: Extract<AgentEvent, { type: 'usage' }>) {
  const costUsd = usage?.costUsd === undefined && event.costUsd === undefined ? undefined : (usage?.costUsd ?? 0) + (event.costUsd ?? 0);
  return { input: (usage?.input ?? 0) + event.inputTokens, output: (usage?.output ?? 0) + event.outputTokens, costUsd };
}
