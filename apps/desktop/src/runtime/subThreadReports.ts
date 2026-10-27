import { AUTOFIX_ATTEMPTS, type AutofixEvent } from '../git/autofix.ts';
import type { AgentEvent } from '../host/types/agent.ts';
import type { ParentReport, PullRequest, SubReport, Thread } from '../model.ts';
import { URGENT_STATUSES } from '@mochi/domain/runtime/toolTable';
import { undeliveredReports } from './due.ts';
import type { State } from '../store/types.ts';
import { log, mapThread } from '../store/threads.ts';

const EXCERPT_CHARS = 800;
const FILES_SHOWN = 10;

/** What a wake asks of the agent, after the reports it delivers. */
export const WAKE_PROMPT =
  'Those are your sub-threads’ reports since your last turn; any still working reports again when it ends a turn. Carry on with your work.';

/**
 * A sub-thread's turn end, logged in its parent's transcript (`addReport`) and delivered to the parent's agent with its next
 * message (`withReports`) or by `dueWakes`. A turn that called `report_to_parent` was logged then (`reportTyped`): its end adds
 * only a status other than done. A turn an Auto-fix event started and that ended normally stays with the sub-thread: it owns
 * its PR, and the parent hears only `reportPr`'s escalations.
 */
export function reportParent(
  state: State,
  sub: Thread,
  status: Extract<AgentEvent, { type: 'turn-end' }>['status'],
  error?: string,
): State {
  if (status === 'done' && isAutofixTurn(sub)) return state;
  const ended = state.threads.find((t) => t.id === sub.id) ?? sub;
  const isReported = isThisTurns(ended, ended.parentReport);
  if (isReported && status === 'done') return state;
  // A failure is news the parent acts on now, not when the others are done; the error says why.
  const text = [error && `Error: ${error}`, isReported ? '' : excerptOf(ended)]
    .filter(Boolean)
    .join('\n');
  return addReport(
    state,
    ended,
    { status, ...(status === 'failed' && { isUrgent: true }) },
    text,
  );
}

/** A Codex sub-thread's turn ended at its usage limit: the parent hears now, and when it resets, since nothing goes on until then. */
export function reportLimit(state: State, sub: Thread): State {
  const limit = state.threads.find((t) => t.id === sub.id)?.live?.limit;
  const window = limit?.label ? `${limit.label.toLowerCase()} ` : '';
  const reset = limit?.resetsAt ? `; resets ${limit.resetsAt}` : '';
  return addReport(
    state,
    sub,
    { status: `stopped at the ${window}usage limit${reset}`, isUrgent: true },
    '',
  );
}

/** A sub-thread waits on your approval or answer: its parent hears once, so it can tell you what is holding the work. */
export function reportWaiting(
  state: State,
  sub: Thread,
  kind: 'approval' | 'question',
  what: string,
): State {
  return addReport(
    state,
    sub,
    { status: `is waiting on you: ${kind}`, isUrgent: true },
    what,
  );
}

/** A working sub-thread or background agent with no agent event for this long is taken as stuck. */
export const STALL_MINUTES = 10;

/**
 * The stall watchdog, run on each minute's tick: a working sub-thread with no agent event for `STALL_MINUTES` reports to its
 * parent once and stops holding the parent's batched wake (`dueWakes`). Its next event clears it (`applyAgentEvent`).
 */
export function reportStalls(state: State): State {
  return state.threads.reduce((s, t) => {
    // Or since the message that started the turn, logged after the last turn's events.
    const quietSince = Math.max(
      t.live?.lastEventAt ?? -Infinity,
      t.activity.at(-1)?.at ?? -Infinity,
    );
    if (
      !t.parent ||
      !t.live?.isWorking ||
      t.live.isStalled ||
      state.now - quietSince < STALL_MINUTES
    )
      return s;
    const stalled = {
      ...s,
      threads: mapThread(s.threads, t.id, (u) => ({
        ...u,
        live: { ...u.live!, isStalled: true },
      })),
    };
    return addReport(
      stalled,
      t,
      {
        status: `has had no activity for ${STALL_MINUTES} min; it may be stuck`,
        isUrgent: true,
      },
      '',
    );
  }, state);
}

/**
 * Sub-threads that were mid-turn when Mochi quit: each reports to its parent that it stopped, since none will end its turn now.
 * The reports are quiet and marked `isRestart`: they go with your next message and wake the parent only while its orchestration
 * grant is usable (`dueWakes`), since then you let it run phases without you.
 */
export function reportStoppedAtQuit<S extends Pick<State, 'threads' | 'now'>>(
  state: S,
  stopped: ReadonlyArray<Thread>,
): S {
  return stopped.reduce(
    (s, sub) =>
      addReport(
        s,
        sub,
        {
          status: 'stopped mid-turn when Mochi quit',
          isQuiet: true,
          isRestart: true,
        },
        'send_to_thread restarts it.',
      ),
    state,
  );
}

/** A `report_to_parent` call, logged in the parent's transcript as it's made: blocked, needs_input and failed are urgent, no_change quiet. */
export function reportTyped(
  state: State,
  sub: Thread,
  report: ParentReport,
): State {
  return addReport(
    state,
    sub,
    {
      status: report.status,
      report,
      ...(isUrgentStatus(report.status) && { isUrgent: true }),
      ...(report.status === 'no_change' && { isQuiet: true }),
    },
    reportBody(report),
  );
}

/** A sub-thread's PR needs its parent: `prEscalation` or `prEnded` said what. The same news not yet delivered never stacks. */
export function reportPr(
  state: State,
  sub: Thread,
  pr: number,
  what: string,
): State {
  return addReport(state, sub, { status: `PR #${pr}: ${what}` }, '');
}

/**
 * The Auto-fix events a parent hears of: CI Auto-fix gave up on, or a conflict back after the sub-thread's fix. Merged and closed
 * come from `prEnded` instead, which also sees PRs without Auto-fix. CI failures, first conflicts and reviews stay with the sub-thread.
 */
export function prEscalation(sub: Thread, event: AutofixEvent): string | null {
  if (event.kind === 'stopped')
    return event.reason === 'cap'
      ? `CI still failing after ${AUTOFIX_ATTEMPTS} Auto-fix attempts; Auto-fix stopped and the PR needs a decision`
      : null;
  if (event.kind !== 'conflict') return null;
  const last = sub.activity.findLast(
    (e) => e.autofix?.pr === event.pr,
  )?.autofix;
  return last?.kind === 'conflict'
    ? "merge conflict still there after the sub-thread's fix; it may need a decision"
    : null;
}

/** `before` is the sub-thread as it was: each of its PRs `state` now records as merged or closed tells the parent, however Mochi learned of it. */
export function reportPrsEnded(state: State, before: Thread): State {
  const after = state.threads.find((t) => t.id === before.id);
  return after
    ? prEnded(before.prs, after.prs).reduce(
        (s, pr) => reportPr(s, after, pr.number, pr.state),
        state,
      )
    : state;
}

/** The PRs `next` records as merged or closed that `prev` didn't. */
export function prEnded(
  prev: PullRequest[],
  next: PullRequest[],
): PullRequest[] {
  const isEnded = (p?: PullRequest) =>
    p?.state === 'merged' || p?.state === 'closed';
  return next.filter(
    (p) => isEnded(p) && !isEnded(prev.find((q) => q.number === p.number)),
  );
}

/** A turn end of a thread messaged with `expectReply` goes to each sender as a reply, once: `replyTo` clears. */
export function reportReplies(
  state: State,
  thread: Thread,
  status: string,
): State {
  const ended = state.threads.find((t) => t.id === thread.id);
  if (!ended?.replyTo?.length) return state;
  const cleared = {
    ...state,
    threads: mapThread(state.threads, ended.id, (t) => ({
      ...t,
      replyTo: undefined,
    })),
  };
  return ended.replyTo.reduce(
    (s, r) =>
      logReport(
        s,
        r.threadId,
        { threadId: ended.id, title: ended.title, status, isReply: true },
        excerptOf(ended),
      ),
    cleared,
  );
}

/**
 * The message a thread's agent gets: its undelivered reports ahead of `text`, each with who sent it and its status.
 * A `/command` only runs from the very start of the message, so reports go after it.
 */
export function withReports(thread: Thread, text: string) {
  const reports = undeliveredReports(thread).map((e) =>
    reportPrompt(e.subReport, e.text),
  );
  if (!reports.length) return text;
  const all = reports.join('\n\n');
  return text.startsWith('/') ? `${text}\n\n${all}` : `${all}\n\n${text}`;
}

/** One report as the agent reads it: the same entry the transcript shows. */
export function reportPrompt(report: SubReport, text: string) {
  const from = report.isReply
    ? `Reply from thread "${report.title}" (${report.threadId}), which ended a turn`
    : `Report from sub-thread "${report.title}" (${report.threadId})`;
  return `${from}: ${report.status}${text && `\n${text}`}`;
}

/** The typed report under its status: the summary, then a line each for where the work is, the files and the checks. */
export function reportBody(report: ParentReport) {
  const files = report.changedFiles ?? [];
  const where = [
    report.branch && `Branch ${report.branch}`,
    report.pr && `PR #${report.pr}`,
  ].filter(Boolean);
  const more = files.length - FILES_SHOWN;
  const lines = [
    report.summary,
    where.length && where.join(' · '),
    files.length &&
      `Changed: ${files.slice(0, FILES_SHOWN).join(', ')}${more > 0 ? ` (+${more} more)` : ''}`,
    report.checks?.length &&
      `Checks: ${report.checks.map((c) => `${c.command} ${c.result}`).join('; ')}`,
  ];
  return lines.filter(Boolean).join('\n');
}

/** A turn an Auto-fix event started: its own PR's business, which stays with the sub-thread unless it needs the parent. */
export const isAutofixTurn = (thread: Thread) =>
  !!thread.turn && !!thread.activity[thread.turn.start]?.autofix;

const isUrgentStatus = (status: string) =>
  (URGENT_STATUSES as readonly string[]).includes(status);

/** A report made in the thread's current turn: past the message that began it. */
const isThisTurns = (thread: Thread, report?: ParentReport) =>
  !!report && report.index > (thread.turn?.start ?? -1);

/**
 * Logs news from `sub` in its parent's transcript, for its agent: every report goes through here. `isUrgent` wakes the parent at
 * once (stalls, waits on you, failures); otherwise it waits until every sub-thread is idle. `text` is the body under the status.
 */
export function addReport<S extends Pick<State, 'threads' | 'now'>>(
  state: S,
  sub: Thread,
  report: Omit<SubReport, 'threadId' | 'title'>,
  text: string,
): S {
  const parentId = sub.parent?.threadId;
  if (!parentId) return state;
  return logReport(
    state,
    parentId,
    { threadId: sub.id, title: sub.title, ...report },
    text,
  );
}

/** Logs `report` in `threadId`'s transcript; the same news its agent hasn't had yet never stacks. */
function logReport<S extends Pick<State, 'threads' | 'now'>>(
  state: S,
  threadId: string,
  report: SubReport,
  text: string,
): S {
  return {
    ...state,
    threads: mapThread(state.threads, threadId, (t) =>
      t.status === 'settled' ||
      undeliveredReports(t).some(
        (e) =>
          e.subReport.threadId === report.threadId &&
          e.subReport.status === report.status &&
          e.text === text,
      )
        ? t
        : log(t, {
            at: state.now,
            who: 'harness',
            kind: 'event',
            text,
            subReport: report,
          }),
    ),
  };
}

function excerptOf(thread: Thread) {
  const said =
    thread.activity.findLast(
      (e) => e.kind === 'message' && (e.who === 'claude' || e.who === 'codex'),
    )?.text ?? '';
  return said.length > EXCERPT_CHARS
    ? `${said.slice(0, EXCERPT_CHARS)}… (get_thread reads more)`
    : said;
}
