import type {
  AgentDecision,
  AgentEvent,
  AgentPlanItem,
} from '../host/types/agent.ts';
import { noteCollisions } from './collisions.ts';
import type {
  ActivityEntry,
  AgentInfo,
  Compaction,
  Provider,
  QueueItem,
  Step,
  Thread,
} from '../model.ts';
import {
  compactionEntry,
  keptContext,
  restoreNote,
} from '../chat/compaction.ts';
import { pinsOf } from '../store/context.ts';
import { pauseQueue } from '../chat/queued.ts';
import { reportItems } from '../goals/ledger.ts';
import type { Action, State } from '../store/types.ts';
import {
  closeCard,
  log,
  mapThread,
  readSteer,
  seePrs,
  turnOf,
  withGeneratedTitle,
} from '../store/threads.ts';
import { createdPr } from '../git/prs.ts';
import { switchDelivered, switchWriting } from '../rewind/switch.ts';
import { withHead } from '../git/workspace.ts';
import { clearLimit, hitLimit, isLimitEnd } from './limits.ts';
import { applySubagent, fromBackground } from './subagents.ts';
import {
  reportLimit,
  reportParent,
  reportReplies,
  reportWaiting,
} from './subThreadReports.ts';
import { undeliver } from './due.ts';
import { applyTask } from './tasks.ts';

const MAIN_EVENTS = new Set<AgentEvent['type']>([
  'worktree',
  'setup',
  'branch',
  'title',
]);

/** Folds one agent event into the store. The agent's plan is mirrored as its steps. */
export function applyAgentEvent(state: State, event: AgentEvent): State {
  state = heard(state, event);
  const thread = state.threads.find((t) => t.id === event.threadId);
  if (!thread) return fromBackground(state, event, applyAgentEvent) ?? state;
  const now = state.now;
  const who = actor(thread);
  const update = (fn: (t: Thread) => Thread): State => ({
    ...state,
    threads: mapThread(state.threads, thread.id, fn),
  });

  switch (event.type) {
    case 'worktree':
      return update((t) => ({
        ...t,
        live: t.live && { ...t.live, cwd: event.path },
      }));
    case 'setup':
      // A failed step waits on you like an approval does; Retry or Skip setup puts it back to running.
      return update((t) => ({
        ...t,
        setup: event.setup,
        status:
          event.setup.status === 'failed'
            ? 'needs-you'
            : t.setup?.status === 'failed' && t.status === 'needs-you'
              ? 'running'
              : t.status,
      }));
    case 'branch':
      return update((t) => ({
        ...t,
        repo:
          t.repo &&
          withHead(
            t.repo,
            { branch: event.branch, isDetached: !!event.isDetached },
            false,
          ),
      }));
    case 'title':
      return update((t) => withGeneratedTitle(t, event.title));
    case 'session':
      return update((t) => ({
        ...t,
        session: {
          ...t.session,
          provider: event.provider,
          id: event.sessionId,
        },
        agent: {},
      }));
    case 'info':
      return update((t) => ({ ...t, agent: mergeInfo(t.agent, event.info) }));
    case 'message':
      return update((t) => {
        // A delta continues the block the agent is streaming, even when your message (a steer) or an event landed after it.
        const i = event.isDelta
          ? t.activity.findLastIndex(
              (e) => e.kind === 'message' && e.who === who,
            )
          : -1;
        if (i < 0)
          return log(t, { at: now, who, kind: 'message', text: event.text });
        return {
          ...t,
          activity: t.activity.map((e, j) =>
            j === i ? { ...e, text: e.text + event.text } : e,
          ),
        };
      });
    case 'steer-read':
      return update((t) => readSteer(t, event.id));
    case 'reasoning':
      return update((t) =>
        log(t, { at: now, who, kind: 'reasoning', text: event.text }),
      );
    case 'tool':
      if (event.phase === 'start')
        return update((t) =>
          log(t, {
            at: now,
            who,
            kind: 'tool',
            text: event.text,
            toolId: event.id,
            ...(event.description && { description: event.description }),
            ...(event.input && { input: event.input }),
            ...(event.links && { links: event.links }),
            ...(event.skill && { skill: event.skill }),
            ...(event.mcp && { mcp: event.mcp }),
            ...(event.sent && { sent: event.sent }),
            ...(event.generated && { generated: event.generated }),
          }),
        );
      state = update((t) => ({
        ...t,
        activity: t.activity.map((e) =>
          e.toolId === event.id ? { ...e, ...toolEnd(event) } : e,
        ),
      }));
      state = recordCreatedPr(state, thread, event);
      return event.files?.length && event.patch
        ? noteCollisions(state, thread.id)
        : state;
    case 'tool-files':
      return update((t) => ({
        ...t,
        activity: t.activity.map((e) =>
          e.toolId === event.id ? { ...e, files: event.files } : e,
        ),
      }));
    case 'plan':
      return applyPlan(state, thread, event.items, event.isFresh);
    case 'subagent':
      return applySubagent(state, thread, event, who);
    case 'task':
      return applyTask(state, thread, event, who);
    case 'approval':
      return waitOnYou(
        state,
        thread,
        {
          id: `q-${event.requestId}`,
          kind: 'approval',
          title: event.title,
          detail: event.detail,
          code: event.code,
          requestId: event.requestId,
        },
        'Paused for your approval',
      );
    case 'question': {
      const { questions } = event;
      if (!questions.length) return state;
      const title =
        questions.length === 1
          ? questions[0].text
          : `Answer ${questions.length} questions`;
      return waitOnYou(
        state,
        thread,
        {
          id: `q-${event.requestId}`,
          kind: 'question',
          title,
          detail: '',
          questions,
          requestId: event.requestId,
        },
        'Waiting on your answer',
      );
    }
    case 'resolved':
      return withdraw(state, thread, `q-${event.requestId}`);
    case 'compaction':
      return update((t) => applyCompaction(t, event, now));
    case 'context':
      return update((t) => switchDelivered(t, event, now));
    case 'context-writing':
      return update(switchWriting);
    case 'usage':
      return update((t) => ({
        ...t,
        context: {
          used: event.contextUsed ?? t.context.used,
          max: event.contextMax ?? t.context.max,
        },
        session:
          t.session && event.inputTokens + event.outputTokens > 0
            ? { ...t.session, usage: addUsage(t.session.usage, event) }
            : t.session,
      }));
    case 'limit-notice':
    case 'notice':
      return update((t) =>
        log(t, { at: now, who: 'harness', kind: 'event', text: event.text }),
      );
    case 'limit':
      return update((t) => hitLimit(t, event, now));
    case 'limit-cleared':
      return update((t) => clearLimit(t, now));
    case 'turn-end': {
      // A held turn's end (you stopped it, or it ended past the reset) ends its limit too.
      const ended = thread.live
        ? update((t) =>
            closeCompaction(
              {
                ...endSendNow(
                  withPlanRecord(
                    stopRunningSteps(
                      event.status === 'failed' ? undeliverSent(t) : t,
                      now,
                    ),
                    now,
                  ),
                ),
                live: {
                  ...t.live!,
                  isWorking: false,
                  turnEnd: event.status,
                  ...(t.live!.limit?.isTurnHeld && { limit: undefined }),
                  ...(event.status === 'failed' && { sentReports: undefined }),
                },
              },
              event,
            ),
          )
        : state;
      if (isLimitEnd(thread)) return reportLimit(ended, thread);
      const isPaused =
        event.status === 'failed' ||
        (event.status === 'interrupted' && !thread.isInterruptedToSend);
      const reported = reportParent(
        endTurn(
          isPaused
            ? {
                ...ended,
                threads: mapThread(ended.threads, thread.id, (t) =>
                  pauseQueue(
                    t,
                    event.status === 'failed' ? 'failed' : 'interrupted',
                  ),
                ),
              }
            : ended,
          thread,
          event,
        ),
        thread,
        event.status,
        event.error,
      );
      return reportReplies(reported, thread, event.status);
    }
  }
}

/**
 * Any word from the agent means it's up; its folder being made, set up and named is main's, not the agent's. It also shows the
 * agent got the message its reports rode with (`sentReports`), and resets the stall watchdog (`reportStalls`).
 */
function heard(state: State, event: AgentEvent): State {
  if (MAIN_EVENTS.has(event.type)) return state;
  const live = state.threads.find((t) => t.id === event.threadId)?.live;
  const isSendFailed = event.type === 'turn-end' && event.status === 'failed';
  if (
    !live ||
    (!live.starting &&
      !live.isStalled &&
      live.lastEventAt === state.now &&
      (!live.sentReports || isSendFailed))
  )
    return state;
  return {
    ...state,
    threads: mapThread(state.threads, event.threadId, (t) => ({
      ...t,
      live: {
        ...t.live!,
        starting: undefined,
        isStalled: undefined,
        lastEventAt: state.now,
        ...(!isSendFailed && { sentReports: undefined }),
      },
    })),
  };
}

/** A failed turn the agent never answered in: the reports its message carried go back to undelivered, for the next one. */
function undeliverSent(t: Thread): Thread {
  const sent = t.live?.sentReports;
  return sent
    ? { ...undeliver(t, sent), live: { ...t.live!, sentReports: undefined } }
    : t;
}

/**
 * A compaction opens one work-log entry (a `/compact` already opened it) and fills it in as the harness reports. Codex takes no
 * instructions, so its end leaves what Mochi would have asked it to keep as a note for the agent's next message.
 */
function applyCompaction(
  t: Thread,
  event: Extract<AgentEvent, { type: 'compaction' }>,
  now: number,
): Thread {
  const i = t.activity.findLastIndex((e) => e.compaction);
  const open =
    i >= 0 && t.activity[i].compaction!.status === 'running' ? i : -1;
  if (event.phase === 'start')
    return open >= 0
      ? t
      : log(t, compactionEntry(t, now, event.trigger ?? 'auto'));
  if (event.phase === 'summary')
    return i < 0 ? t : patchCompaction(t, i, { summary: event.summary });
  const at = open >= 0 ? open : t.activity.length;
  const opened =
    open >= 0 ? t : log(t, compactionEntry(t, now, event.trigger ?? 'auto'));
  const before = opened.activity[at].compaction!;
  const ended = patchCompaction(opened, at, {
    status: event.error ? 'failed' : 'done',
    ...(event.trigger && { trigger: event.trigger }),
    ...(event.preTokens !== undefined && { preTokens: event.preTokens }),
    ...(event.postTokens !== undefined && { postTokens: event.postTokens }),
    ...(event.error && { error: event.error }),
  });
  const withContext =
    event.postTokens !== undefined
      ? { ...ended, context: { ...ended.context, used: event.postTokens } }
      : ended;
  if (event.error || actor(t) !== 'codex' || !withContext.live)
    return withContext;
  const note = restoreNote(keptContext(t, pinsOf(t.id)), before.focus);
  return note
    ? {
        ...withContext,
        live: {
          ...withContext.live,
          notes: [...(withContext.live.notes ?? []), note],
        },
      }
    : withContext;
}

function patchCompaction(
  t: Thread,
  index: number,
  patch: Partial<Compaction>,
): Thread {
  return {
    ...t,
    activity: t.activity.map((e, j) =>
      j === index
        ? {
            ...e,
            text:
              patch.status === 'failed'
                ? 'Compaction failed'
                : patch.status === 'done'
                  ? 'Compacted the conversation'
                  : e.text,
            compaction: { ...e.compaction!, ...patch },
          }
        : e,
    ),
  };
}

/** A turn that ends with its compaction still open never got its end (a failed `/compact`, an interrupt). */
function closeCompaction(
  t: Thread,
  event: Extract<AgentEvent, { type: 'turn-end' }>,
): Thread {
  const i = t.activity.findLastIndex((e) => e.compaction);
  if (i < 0 || t.activity[i].compaction!.status !== 'running') return t;
  return patchCompaction(
    t,
    i,
    event.status === 'done'
      ? { status: 'done' }
      : { status: 'failed', error: event.error ?? 'Interrupted' },
  );
}

/** What a tool call's end adds to the entry its start logged. */
function toolEnd(
  event: Extract<AgentEvent, { type: 'tool' }>,
): Partial<ActivityEntry> {
  const {
    text,
    links,
    output,
    exitCode,
    patch,
    images,
    generated,
    widget,
    isError,
  } = event;
  return {
    ...(links && { text, links }),
    ...(isError && { isError }),
    ...(output !== undefined && { output }),
    ...(exitCode !== undefined && { exitCode }),
    ...(patch && { patch }),
    ...(images?.length && { images }),
    ...(generated && { generated }),
    ...(widget && { widget }),
  };
}

/** A `gh pr create` the agent ran puts its PR on the thread right away; one already recorded keeps the state gh gave it. */
function recordCreatedPr(
  state: State,
  thread: Thread,
  event: Extract<AgentEvent, { type: 'tool' }>,
): State {
  const command = thread.activity.find((e) => e.toolId === event.id)?.text;
  const pr = command && createdPr(command, event.output);
  if (!pr || thread.prs.some((p) => p.number === pr.number)) return state;
  return seePrs(state, thread.id, [pr]);
}

export function applyAgentEvents(state: State, events: AgentEvent[]): State {
  return events.reduce(applyAgentEvent, state);
}

type Resolution = {
  threadId: string;
  title: string;
  requestId: string;
  decision: AgentDecision;
};

/** What answering a queue item tells the agent that asked. Demo threads have no session and resolve in the store alone. */
export function resolution(state: State, action: Action): Resolution | null {
  if (action.type !== 'answer') return null;
  const item = state.queue.find((q) => q.id === action.queueId);
  if (!item?.requestId) return null;
  if (!state.threads.find((t) => t.id === item.threadId)?.session) return null;
  const { threadId, title, requestId } = item;
  if (item.kind !== 'question')
    return { threadId, title, requestId, decision: { kind: 'allow' } };
  return {
    threadId,
    title,
    requestId,
    decision: { kind: 'answer', answers: action.answers ?? [] },
  };
}

/** The transcript line for an answer main couldn't deliver; the card is already gone, so it keeps what you answered. */
export function undelivered(
  { title, decision }: Resolution,
  error: unknown,
): Omit<ActivityEntry, 'at'> {
  const why = error instanceof Error ? error.message : String(error);
  if (decision.kind !== 'answer')
    return {
      who: 'harness',
      kind: 'event',
      text: `Your approval of "${title}" didn't reach the agent: ${why}.`,
    };
  const answers = decision.answers
    .map((a) => a.join(', '))
    .filter(Boolean)
    .join('; ');
  return {
    who: 'harness',
    kind: 'event',
    text: `Your answer to "${title}" didn't reach the agent: ${why}. Send it as a message if it still applies: ${answers}`,
  };
}

/**
 * The agent's to-do list, as sent: `items` replace the plan (order, titles, statuses). A step resent with the same title in the
 * same turn keeps its clock; a later turn's plan, or a fresh one (`first_task`, `new_task`), starts every clock over.
 */
function applyPlan(
  state: State,
  thread: Thread,
  items: AgentPlanItem[],
  isFresh = false,
): State {
  const now = state.now;
  const turn = turnOf(thread);
  // GAP: a plan saved before plans had a turn (and the demo's) counts as this turn's, so its first resend keeps its clocks.
  const isOtherTurn = thread.planTurn !== undefined && thread.planTurn !== turn;
  const kept =
    isFresh || isOtherTurn
      ? []
      : thread.steps.filter((s) => s.status !== 'dropped');
  const claimed = new Set<string>();
  let n = nextStepNumber(thread.steps);
  const steps = items.map((item) => {
    const step = kept.find((s) => s.title === item.title && !claimed.has(s.id));
    if (step) claimed.add(step.id);
    return withItemStatus(
      step ?? {
        id: `${thread.id}-s${n++}`,
        title: item.title,
        status: 'ready',
        addedAt: now,
        addedBy: actor(thread),
      },
      item.status,
      now,
    );
  });
  const added = steps.filter((s) => !claimed.has(s.id));
  // Only a revision says what it added: a new plan is all new.
  const isRevision = kept.length > 0 && added.length > 0;
  return {
    ...state,
    threads: mapThread(state.threads, thread.id, (t) => ({
      ...(isRevision ? log(t, addedEntry(actor(thread), added, now)) : t),
      steps,
      planTurn: turn,
      status:
        t.status !== 'needs-you' && steps.some((s) => s.status === 'running')
          ? 'running'
          : t.status,
    })),
  };
}

/** The log row for steps a revised plan added. */
function addedEntry(
  provider: Provider,
  added: Step[],
  now: number,
): ActivityEntry {
  const label =
    added.length === 1
      ? `${NAMES[provider]} added "${added[0].title}"`
      : `${NAMES[provider]} found ${added.length} more steps`;
  return { at: now, who: 'harness', kind: 'event', text: `Plan: ${label}` };
}

const NAMES = { claude: 'Claude', codex: 'Codex' } satisfies Record<
  Provider,
  string
>;

/** A step at the status the plan gives it. A blocked step waits on you: the harness, not the plan, unblocks it. */
function withItemStatus(
  s: Step,
  status: AgentPlanItem['status'],
  now: number,
): Step {
  if (s.status === 'blocked' && status !== 'done') return s;
  if (status === 'done')
    return s.status === 'done'
      ? s
      : {
          ...s,
          ...UNSTOPPED,
          status: 'done',
          startedAt: s.startedAt ?? now,
          doneAt: now,
        };
  if (status === 'pending')
    return { ...s, ...UNSTOPPED, ...UNDONE, status: 'ready' };
  return {
    ...s,
    ...UNSTOPPED,
    ...UNDONE,
    status: 'running',
    startedAt: s.startedAt ?? now,
  };
}

const UNDONE = { doneAt: undefined, doneMs: undefined };
const UNSTOPPED = { stoppedAt: undefined, stoppedMs: undefined };

/** Past every step id the thread has, so a new step never takes the id of one it replaces in the same update (`stampNew`). */
function nextStepNumber(steps: Step[]) {
  const used = steps.map((s) => Number(/-s(\d+)$/.exec(s.id)?.[1] ?? -1));
  return Math.max(steps.length - 1, ...used) + 1;
}

/**
 * The turn's plan, kept where the turn ended as one folded row: its steps as they stood, and the decisions and assumptions its
 * wrap_up placed on them. Nothing when the turn neither planned nor reported any.
 */
function withPlanRecord(t: Thread, now: number): Thread {
  const turn = turnOf(t);
  const steps =
    t.planTurn === turn ? t.steps.filter((s) => s.status !== 'dropped') : [];
  const report = t.report?.turn === turn ? t.report : undefined;
  const decisions = reportItems(report?.decisions);
  const assumptionIds = (t.assumptions ?? [])
    .filter((a) => a.turn === turn)
    .map((a) => a.id);
  if (!steps.length && !decisions.length && !assumptionIds.length) return t;
  return log(t, {
    at: now,
    who: 'harness',
    kind: 'event',
    text: 'Plan',
    planRecord: { steps, decisions, assumptionIds },
  });
}

function waitOnYou(
  state: State,
  thread: Thread,
  item: Omit<QueueItem, 'threadId' | 'blocks' | 'createdAt'>,
  note: string,
): State {
  if (state.queue.some((q) => q.id === item.id)) return state;
  const now = state.now;
  const ready = thread.steps.filter((s) => s.status === 'ready').length;
  const reported = reportWaiting(
    state,
    thread,
    item.kind === 'question' ? 'question' : 'approval',
    item.title,
  );
  return {
    ...reported,
    ...state,
    queue: [
      ...state.queue,
      {
        ...item,
        threadId: thread.id,
        blocks: { steps: ready + 1, threads: 1 },
        createdAt: now,
      },
    ],
    threads: mapThread(reported.threads, thread.id, (t) =>
      log(
        {
          ...t,
          status: 'needs-you',
          steps: t.steps.map((s) =>
            s.status === 'running' ? { ...s, status: 'blocked', note } : s,
          ),
        },
        // A question is answered where the agent asked it: the entry is its card, live until answered or withdrawn.
        item.kind === 'question'
          ? {
              at: now,
              who: 'harness',
              kind: 'event',
              text: item.title,
              card: { id: item.id, isOpen: true },
            }
          : {
              at: now,
              who: 'harness',
              kind: 'event',
              text: `Waiting on you: ${item.title}`,
            },
      ),
    ),
  };
}

/** The agent took a request back; the step it blocked resumes, as when you answer it. */
function withdraw(state: State, thread: Thread, queueId: string): State {
  const item = state.queue.find((q) => q.id === queueId);
  if (!item) return state;
  const now = state.now;
  const isWaiting = state.queue.some(
    (q) =>
      q.id !== queueId &&
      q.threadId === thread.id &&
      (q.kind === 'approval' || q.kind === 'question'),
  );
  return {
    ...state,
    queue: state.queue.filter((q) => q.id !== queueId),
    threads: mapThread(state.threads, thread.id, (t) =>
      log(
        isWaiting
          ? closeCard(t, queueId)
          : {
              ...t,
              status: 'running',
              steps: t.steps.map((s) =>
                s.status === 'blocked'
                  ? { ...s, status: 'running', note: undefined }
                  : s,
              ),
              activity: closeCard(t, queueId).activity,
            },
        {
          at: now,
          who: 'harness',
          kind: 'event',
          text: `Withdrawn by the agent: ${item.title}`,
        },
      ),
    ),
  };
}

function endTurn(
  state: State,
  thread: Thread,
  event: Extract<AgentEvent, { type: 'turn-end' }>,
): State {
  const now = state.now;
  const update = (fn: (t: Thread) => Thread): State => ({
    ...state,
    threads: mapThread(state.threads, thread.id, fn),
  });
  if (event.status === 'interrupted')
    return update((t) =>
      log(t, {
        at: now,
        who: 'harness',
        kind: 'event',
        text: 'Turn interrupted',
        turnEnd: 'interrupted',
      }),
    );
  if (event.status === 'failed')
    return update((t) =>
      log(
        { ...t, status: 'needs-you' },
        {
          at: now,
          who: 'harness',
          kind: 'event',
          text: `Turn failed${event.error ? `: ${event.error}` : ''}`,
          turnEnd: 'failed',
        },
      ),
    );
  return state;
}

/** A Send now still taking its message back no longer stops anything: the turn it was clicked in is over (`interruptsToSend`). */
function endSendNow(t: Thread): Thread {
  const steering = t.steering?.map((s) =>
    s.sendNow ? { ...s, sendNow: 'turn-ended' as const } : s,
  );
  return t.isInterruptedToSend || steering
    ? { ...t, isInterruptedToSend: undefined, steering }
    : t;
}

/** A step still running when the turn ends stops its clock; whether it's done is the agent's to say, not the turn end's. */
function stopRunningSteps(t: Thread, now: number): Thread {
  return {
    ...t,
    steps: t.steps.map((s) =>
      s.status === 'running' && s.stoppedAt === undefined
        ? { ...s, stoppedAt: now }
        : s,
    ),
  };
}

/** Who speaks for a thread right now: its live session, else its first provider. */
function actor(thread: Thread): Provider {
  return thread.session?.provider ?? thread.providers[0];
}

function mergeInfo(info: AgentInfo = {}, update: AgentInfo): AgentInfo {
  if (!update.mcpServers) return { ...info, ...update };
  const servers = new Map((info.mcpServers ?? []).map((s) => [s.name, s]));
  for (const s of update.mcpServers)
    servers.set(s.name, { ...servers.get(s.name), ...s });
  return { ...info, ...update, mcpServers: [...servers.values()] };
}

function addUsage(
  usage:
    | { input: number; output: number; cached?: number; costUsd?: number }
    | undefined,
  event: Extract<AgentEvent, { type: 'usage' }>,
) {
  const costUsd =
    usage?.costUsd === undefined && event.costUsd === undefined
      ? undefined
      : (usage?.costUsd ?? 0) + (event.costUsd ?? 0);
  const cached =
    usage?.cached === undefined && event.cachedTokens === undefined
      ? undefined
      : (usage?.cached ?? 0) + (event.cachedTokens ?? 0);
  return {
    input: (usage?.input ?? 0) + event.inputTokens,
    output: (usage?.output ?? 0) + event.outputTokens,
    cached,
    costUsd,
  };
}
