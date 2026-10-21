import type { AgentDecision, AgentEvent, AgentPlanItem } from '../host/types/agent.ts';
import { noteCollisions } from './collisions.ts';
import type { ActivityEntry, AgentInfo, Compaction, Provider, QueueItem, Step, Thread } from '../model.ts';
import { compactionEntry, keptContext, restoreNote } from '../chat/compact.ts';
import { getThreadPins } from '../chat/pins.ts';
import { pauseQueue } from '../chat/outbox.ts';
import { similarity } from '../progress.ts';
import type { Action, State } from '../store/index.tsx';
import { completeStep, log, mapStep, mapThread, readSteer, seePrs, withGeneratedTitle } from '../store/threads.ts';
import { createdPr } from '../git/prs.ts';
import { withHead } from '../git/workspace.ts';
import { clearLimit, hitLimit, isLimitEnd } from './limits.ts';
import { applySubagent, fromBackground } from './subagents.ts';
import { noteParent } from './subThreadNotes.ts';
import { applyTask } from './tasks.ts';

const MAIN_EVENTS = new Set<AgentEvent['type']>(['worktree', 'setup', 'branch', 'title']);

/** Folds one agent event into the store. The goal is Mochi's and yours; the agent's plan is mirrored as its steps, never the goal. */
export function applyAgentEvent(state: State, event: AgentEvent): State {
  // Any word from the agent means it's up; its folder being made, set up and named is main's, not the agent's.
  if (!MAIN_EVENTS.has(event.type) && state.threads.find((t) => t.id === event.threadId)?.live?.starting) {
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
      return update((t) => ({ ...t, repo: t.repo && withHead(t.repo, { branch: event.branch, isDetached: !!event.isDetached }, false) }));
    case 'title':
      return update((t) => withGeneratedTitle(t, event.title));
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
    case 'steer-read':
      return update((t) => readSteer(t, event.id, now));
    case 'reasoning':
      return update((t) => log(t, { at: now, who, kind: 'reasoning', text: event.text }));
    case 'tool':
      if (event.phase === 'start') return update((t) => log(t, { at: now, who, kind: 'tool', text: event.text, toolId: event.id, ...(event.description && { description: event.description }), ...(event.links && { links: event.links }), ...(event.skill && { skill: event.skill }), ...(event.mcp && { mcp: event.mcp }), ...(event.sent && { sent: event.sent }), ...(event.generated && { generated: event.generated }) }));
      state = update((t) => ({ ...t, activity: t.activity.map((e) => (e.toolId === event.id ? { ...e, ...toolEnd(event) } : e)) }));
      state = recordCreatedPr(state, thread, event);
      return event.files?.length && event.patch ? noteCollisions(state, thread.id) : state;
    case 'tool-description':
      return update((t) => ({ ...t, activity: t.activity.map((e) => (e.toolId === event.id ? { ...e, description: event.description } : e)) }));
    case 'plan':
      return applyPlan(state, thread, event.items, event.isFresh);
    case 'subagent':
      return applySubagent(state, thread, event, who);
    case 'task':
      return applyTask(state, thread, event, who);
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
    case 'compaction':
      return update((t) => applyCompaction(t, event, now));
    case 'usage':
      return update((t) => ({
        ...t,
        context: { used: event.contextUsed ?? t.context.used, max: event.contextMax ?? t.context.max },
        session: t.session && event.inputTokens + event.outputTokens > 0 ? { ...t.session, usage: addUsage(t.session.usage, event) } : t.session,
      }));
    case 'limit-notice':
    case 'notice':
      return update((t) => log(t, { at: now, who: 'harness', kind: 'event', text: event.text }));
    case 'limit':
      return update((t) => hitLimit(t, event, now));
    case 'limit-cleared':
      return update((t) => clearLimit(t, now));
    case 'turn-end': {
      // A held turn's end (you stopped it, or it ended past the reset) ends its limit too.
      const ended = thread.live ? update((t) => closeCompaction({ ...stopRunningSteps(t, now), live:{ ...t.live!, isWorking: false, turnEnd: event.status, ...(t.live!.limit?.isTurnHeld && { limit: undefined }) } }, event)) : state;
      if (isLimitEnd(thread)) return ended;
      return noteParent(endTurn(event.status === 'done' ? ended : { ...ended, threads: mapThread(ended.threads, thread.id, (t) => pauseQueue(t, event.status === 'failed' ? 'failed' : 'interrupted')) }, thread, event), thread, event.status);
    }
  }
}

/**
 * A compaction opens one work-log entry (a `/compact` already opened it) and fills it in as the harness reports. Codex takes no
 * instructions, so its end leaves what Mochi would have asked it to keep as a note for the agent's next message.
 */
function applyCompaction(t: Thread, event: Extract<AgentEvent, { type: 'compaction' }>, now: number): Thread {
  const i = t.activity.findLastIndex((e) => e.compaction);
  const open = i >= 0 && t.activity[i].compaction!.status === 'running' ? i : -1;
  if (event.phase === 'start') return open >= 0 ? t : log(t, compactionEntry(t, now, event.trigger ?? 'auto'));
  if (event.phase === 'summary') return i < 0 ? t : patchCompaction(t, i, { summary: event.summary });
  const at = open >= 0 ? open : t.activity.length;
  const opened = open >= 0 ? t : log(t, compactionEntry(t, now, event.trigger ?? 'auto'));
  const before = opened.activity[at].compaction!;
  const ended = patchCompaction(opened, at, {
    status: event.error ? 'failed' : 'done',
    ...(event.trigger && { trigger: event.trigger }),
    ...(event.preTokens !== undefined && { preTokens: event.preTokens }),
    ...(event.postTokens !== undefined && { postTokens: event.postTokens }),
    ...(event.error && { error: event.error }),
  });
  const withContext = event.postTokens !== undefined ? { ...ended, context: { ...ended.context, used: event.postTokens } } : ended;
  if (event.error || actor(t) !== 'codex' || !withContext.live) return withContext;
  const note = restoreNote(keptContext(t, getThreadPins(t.id)), before.focus);
  return note ? { ...withContext, live: { ...withContext.live, notes: [...(withContext.live.notes ?? []), note] } } : withContext;
}

function patchCompaction(t: Thread, index: number, patch: Partial<Compaction>): Thread {
  return { ...t, activity: t.activity.map((e, j) => (j === index ? { ...e, text: patch.status === 'failed' ? 'Compaction failed' : patch.status === 'done' ? 'Compacted the conversation' : e.text, compaction: { ...e.compaction!, ...patch } } : e)) };
}

/** A turn that ends with its compaction still open never got its end (a failed `/compact`, an interrupt). */
function closeCompaction(t: Thread, event: Extract<AgentEvent, { type: 'turn-end' }>): Thread {
  const i = t.activity.findLastIndex((e) => e.compaction);
  if (i < 0 || t.activity[i].compaction!.status !== 'running') return t;
  return patchCompaction(t, i, event.status === 'done' ? { status: 'done' } : { status: 'failed', error: event.error ?? 'Interrupted' });
}

/** What a tool call's end adds to the entry its start logged. */
function toolEnd(event: Extract<AgentEvent, { type: 'tool' }>): Partial<ActivityEntry> {
  const { text, links, output, exitCode, patch, images, generated, widget } = event;
  return { ...(links && { text, links }), ...(output !== undefined && { output }), ...(exitCode !== undefined && { exitCode }), ...(patch && { patch }), ...(images?.length && { images }), ...(generated && { generated }), ...(widget && { widget }) };
}

/** A `gh pr create` the agent ran puts its PR on the thread right away; one already recorded keeps the state gh gave it. */
function recordCreatedPr(state: State, thread: Thread, event: Extract<AgentEvent, { type: 'tool' }>): State {
  const command = thread.activity.find((e) => e.toolId === event.id)?.text;
  const pr = command && createdPr(command, event.output);
  if (!pr || thread.prs.some((p) => p.number === pr.number)) return state;
  return seePrs(state, thread.id, [pr]);
}

export function applyAgentEvents(state: State, events: AgentEvent[]): State {
  return events.reduce(applyAgentEvent, state);
}

type Resolution = { threadId: string; title: string; requestId: string; decision: AgentDecision };

/** What answering a queue item tells the agent that asked. Demo threads have no session and resolve in the store alone. */
export function resolution(state: State, action: Action): Resolution | null {
  if (action.type !== 'answer') return null;
  const item = state.queue.find((q) => q.id === action.queueId);
  if (!item?.requestId) return null;
  if (!state.threads.find((t) => t.id === item.threadId)?.session) return null;
  const { threadId, title, requestId } = item;
  if (item.kind !== 'question') return { threadId, title, requestId, decision: { kind: 'allow' } };
  return { threadId, title, requestId, decision: { kind: 'answer', answers: action.answers ?? [] } };
}

/** The transcript line for an answer main couldn't deliver; the card is already gone, so it keeps what you answered. */
export function undelivered({ title, decision }: Resolution, error: unknown): Omit<ActivityEntry, 'at'> {
  const why = error instanceof Error ? error.message : String(error);
  if (decision.kind !== 'answer') return { who: 'harness', kind: 'event', text: `Your approval of "${title}" didn't reach the agent: ${why}.` };
  const answers = decision.answers.map((a) => a.join(', ')).filter(Boolean).join('; ');
  return { who: 'harness', kind: 'event', text: `Your answer to "${title}" didn't reach the agent: ${why}. Send it as a message if it still applies: ${answers}` };
}

const MATCH = 0.6;

/**
 * The agent's to-do list, mirrored the way Claude Code shows its todos: `items` is the whole plan, shown as sent (order, titles,
 * statuses). An item keeps its step (and when it started) by title or a close one; a step it no longer lists is dropped, done
 * or not. A fresh plan matches nothing, so the previous plan's steps all drop.
 */
function applyPlan(state: State, thread: Thread, items: AgentPlanItem[], isFresh = false): State {
  const now = state.now;
  const provider = actor(thread);
  const claimed = new Set<string>();
  const matches = items.map((item) => {
    if (isFresh) return undefined;
    const open = thread.steps.filter((s) => s.status !== 'dropped' && !claimed.has(s.id));
    const step = open.find((s) => s.title === item.title) ?? bestMatch(open, item.title);
    if (step) claimed.add(step.id);
    return step;
  });

  let threads = state.threads;
  items.forEach((item, i) => {
    const step = matches[i];
    if (!step) return;
    if (step.title !== item.title) threads = mapThread(threads, thread.id, (t) => mapStep(t, step.id, (s) => ({ ...s, title: item.title })));
    if (item.status === 'done') {
      if (step.status !== 'done') threads = completeStep(threads, thread.id, step.id, now);
      return;
    }
    // A blocked step waits on you; the harness, not the plan, unblocks it.
    if (step.status === 'blocked') return;
    if (item.status === 'pending') {
      threads = mapThread(threads, thread.id, (t) => mapStep(t, step.id, (s) => ({ ...s, status: 'ready', doneAt: undefined, doneMs: undefined, stoppedAt: undefined, stoppedMs: undefined })));
      return;
    }
    threads = mapThread(threads, thread.id, (t) => ({
      ...mapStep(t, step.id, (s) => ({ ...s, status: 'running', startedAt: s.startedAt ?? now, doneAt: undefined, doneMs: undefined, stoppedAt: undefined, stoppedMs: undefined })),
      status: t.status === 'needs-you' ? t.status : 'running',
    }));
  });

  const dropped = thread.steps.filter((s) => !claimed.has(s.id) && s.status !== 'dropped');
  for (const step of dropped) {
    const drop = (t: Thread) => mapStep(t, step.id, (s) => ({ ...s, status: 'dropped', droppedAt: now, note: isFresh ? 'Earlier plan' : `Dropped by ${NAMES[provider]}` }));
    threads = mapThread(threads, thread.id, (t) => (isFresh ? drop(t) : log(drop(t), { at: now, who: 'harness', kind: 'event', text: `${NAMES[provider]} dropped "${step.title}"` })));
  }

  const added = items.filter((_, i) => !matches[i]);
  if (added.length) threads = addSteps(threads, thread.id, provider, added, now);
  let k = thread.steps.length;
  const order = matches.map((m) => m?.id ?? `${thread.id}-s${k++}`);
  return { ...state, threads: mapThread(threads, thread.id, (t) => ({ ...t, steps: inPlanOrder(t.steps, order) })) };
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

/** Items the agent planned that the mirror doesn't have yet, appended and logged as plan changes. */
function addSteps(threads: Thread[], threadId: string, provider: Provider, added: AgentPlanItem[], now: number): Thread[] {
  return mapThread(threads, threadId, (t) => {
    const created = added.map(
      (item, k): Step => ({
        id: `${t.id}-s${t.steps.length + k}`,
        title: item.title,
        status: item.status === 'pending' ? 'ready' : item.status,
        addedAt: now,
        addedBy: provider,
        ...(item.status !== 'pending' && { startedAt: now }),
        ...(item.status === 'done' && { doneAt: now }),
      }),
    );
    const label = created.length === 1 ? `${NAMES[provider]} added "${created[0].title}"` : `${NAMES[provider]} found ${created.length} more steps`;
    return log({ ...t, steps: [...t.steps, ...created] }, { at: now, who: 'harness', kind: 'event', text: `Plan: ${label}` });
  });
}

/** The plan's steps in the order the agent listed them, then the dropped ones as they were. */
function inPlanOrder(steps: Step[], order: string[]): Step[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const planned = new Set(order);
  return [...order.map((id) => byId.get(id)!), ...steps.filter((s) => !planned.has(s.id))];
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
  // Whether the goal is met is the idle verdict's to say (`src/goals/verdict.ts`), once Mochi has checked the turn.
  return state;
}

/** A step still running when the turn ends stops its clock; whether it's done is the agent's to say, not the turn end's. */
function stopRunningSteps(t: Thread, now: number): Thread {
  return { ...t, steps: t.steps.map((s) => (s.status === 'running' && s.stoppedAt === undefined ? { ...s, stoppedAt: now } : s)) };
}

/** Who speaks for a thread right now: its live session, else its first provider. */
function actor(thread: Thread): Provider {
  return thread.session?.provider ?? thread.providers[0];
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
