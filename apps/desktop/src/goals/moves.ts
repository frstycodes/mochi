import type { RefStatus } from '@mochi/domain/chat/refs';
import type { Thread, TurnReport } from '../model.ts';
import { parentOf, subThreadsOf } from '../reorder.ts';
import { nextStep } from './report.ts';
import { YOUR_CALL, type Gap, type Verdict } from './verdict.ts';
import { plural } from '@mochi/domain/lib/format';

export type MoveKind =
  | 'confirm'
  | 'close-gaps'
  | 'continue'
  | 'commit'
  | 'open-pr'
  | 'hand-back'
  | 'merge-subs'
  | 'settle';

export interface Move {
  kind: MoveKind;
  label: string;
  /** The sub-thread it acts on, when not the card's own thread. */
  threadId?: string;
}

/** What a move needs from around the thread: its parent (a sub-thread), and its handed-back sub-threads' open PRs (a parent). */
export interface MoveContext {
  parent?: Pick<Thread, 'title' | 'repo'>;
  subPrs?: number[];
}

/** A thread's parent, and the open PRs of the sub-threads it got back, from the store. */
export function moveContext(threads: Thread[], thread: Thread): MoveContext {
  const parent = parentOf(threads, thread);
  const subPrs = subThreadsOf(threads, thread.id)
    .filter((t) => t.parent?.handedBackAt && t.status !== 'settled')
    .flatMap((t) =>
      t.prs
        .filter((p) => p.state === 'open' || p.state === 'draft')
        .map((p) => p.number),
    );
  return { ...(parent && { parent }), ...(subPrs.length && { subPrs }) };
}

/**
 * The one thing that moves this goal forward from here, in order: confirm what only you can check, close the gaps, continue a stopped
 * plan, commit, open the pull request, settle. Null when it waits on your answer, the clock or GitHub. A proposed goal waits on
 * the proposal card's own Accept, so the end-of-turn card only asks.
 */
export function moveFor(
  thread: Thread,
  verdict: Verdict,
  prStates: RefStatus[],
  context: MoveContext = {},
): Move | null {
  const open = verdict.gaps.filter((g) => !g.isAccepted).length;
  if (verdict.subThread) return subMove(verdict.subThread);
  if (verdict.chip === YOUR_CALL) {
    if (thread.repo && thread.idle?.uncommitted)
      return { kind: 'commit', label: 'Commit' };
    if (thread.repo && nextStep(prStates) === 'open-pr')
      return { kind: 'open-pr', label: 'Open pull request' };
    return { kind: 'confirm', label: 'Verify outcome' };
  }
  if (verdict.kind === 'needs-you') return null;
  if (verdict.kind === 'gaps') return closeGaps(open);
  if (verdict.kind === 'stalled')
    return verdict.chip === 'Stopped'
      ? { kind: 'continue', label: 'Continue' }
      : null;
  if (verdict.kind !== 'done') return null;
  if (!thread.repo) {
    if (!thread.idle?.isConfirmed && thread.criteria?.some((c) => !c.command))
      return { kind: 'confirm', label: 'Verify outcome' };
    return { kind: 'settle', label: 'Settle thread' };
  }
  if (thread.idle?.uncommitted) return { kind: 'commit', label: 'Commit' };
  const subPrs = context.subPrs ?? [];
  if (subPrs.length)
    return {
      kind: 'merge-subs',
      label: `Merge ${subPrs.length} ${plural(subPrs.length, 'PR', 'PRs')}`,
    };
  const step = nextStep(prStates);
  if (step === 'open-pr')
    return { kind: 'open-pr', label: 'Open pull request' };
  // A sub-thread's PR goes into its parent's branch; once it's open, the result goes back and the parent merges it.
  if (thread.parent && step === 'review')
    return thread.parent.handedBackAt
      ? null
      : { kind: 'hand-back', label: 'Hand back' };
  return step === 'settle' ? { kind: 'settle', label: 'Settle thread' } : null;
}

/** A parent's move for the sub-thread that holds it up: its gaps go to its own agent, a finished one is handed back. */
function subMove(sub: NonNullable<Verdict['subThread']>): Move | null {
  if (sub.kind === 'gaps')
    return {
      kind: 'close-gaps',
      label: `Close ${sub.openGaps} ${plural(sub.openGaps, 'gap', 'gaps')}`,
      threadId: sub.id,
    };
  if (sub.kind === 'done' || sub.kind === 'idle')
    return { kind: 'hand-back', label: 'Hand back', threadId: sub.id };
  return null;
}

const closeGaps = (count: number): Move => ({
  kind: 'close-gaps',
  label: `Close ${count} ${plural(count, 'gap', 'gaps')}`,
});

/**
 * The agent's own answers, plus Close gaps for open gaps its report predates: first when one is critical, last when all are unverified.
 * The agent wrote its options before Mochi saw these, so they can't cover them.
 */
export function withUnseenGaps<T>(
  options: T[],
  thread: Thread,
  verdict: Verdict,
  report: TurnReport | undefined,
  toChoice: (move: Move) => T,
): T[] {
  const unseen = verdict.gaps.filter(
    (g) => !g.isAccepted && isUnseen(thread, g, report),
  );
  if (!unseen.length) return options;
  const close = toChoice(
    closeGaps(verdict.gaps.filter((g) => !g.isAccepted).length),
  );
  return unseen.some((g) => g.severity === 'critical')
    ? [close, ...options]
    : [...options, close];
}

/** CI, conflicts and Mochi's transcript audit come after the report; a criterion's gap counts when its check failed after it. */
function isUnseen(thread: Thread, gap: Gap, report: TurnReport | undefined) {
  if (!report || !gap.criterionId) return true;
  const check = thread.criteria?.find((c) => c.id === gap.criterionId)?.check;
  return !!check && check.at >= report.at;
}

/** The agent's own question and buttons for this turn, which replace Mochi's move; null when it wrote none (a limit, an error, no report). */
export function agentAsk(report: TurnReport | undefined) {
  if (!report?.next || !report.options?.length) return null;
  return { question: report.next, options: report.options };
}

/** Continue answers the agent's own next-move question with yes, so the agent gets the move the card showed; without one, it resumes. */
export function continuePrompt(
  report: TurnReport | undefined,
  hasPlan: boolean,
) {
  if (report?.next) return `Yes: ${report.next}`;
  return hasPlan
    ? 'Continue the plan from where you stopped.'
    : 'Continue where you left off.';
}

/** The question matches the action; only Continue uses the agent's proposed next move. */
export function questionFor(
  verdict: Verdict,
  move: Move | null,
  report: TurnReport | undefined,
  agent: string,
  context: MoveContext = {},
): string | null {
  if (!move) return verdict.kind === 'needs-you' ? verdict.reason : null;
  const open = verdict.gaps.filter((g) => !g.isAccepted).length;
  const sub = verdict.subThread;
  if (sub && move.kind === 'close-gaps')
    return `${sub.title} has ${plural(sub.openGaps, 'a gap', `${sub.openGaps} gaps`)}: hand ${plural(sub.openGaps, 'it', 'them')} back to its agent?`;
  if (sub && move.kind === 'hand-back')
    return `${sub.title} is finished. Hand its result back to this thread?`;
  switch (move.kind) {
    case 'confirm':
      return verdict.kind === 'done'
        ? 'Verify the completed work against the goal criteria?'
        : verdict.reason;
    case 'close-gaps':
      return `Hand the ${plural(open, 'gap', `${open} gaps`)} back to ${agent}?`;
    case 'continue':
      return report?.next ?? `Pick up where ${agent} stopped?`;
    case 'commit':
      return 'Commit these changes?';
    case 'open-pr':
      return context.parent?.repo
        ? `Open a pull request into ${context.parent.repo.branch}?`
        : 'Open a pull request for this?';
    case 'hand-back':
      return `Hand the result back to ${context.parent?.title ?? 'its parent thread'}?`;
    case 'merge-subs':
      return `Merge the ${context.subPrs?.length === 1 ? 'sub-thread PR' : `${context.subPrs?.length} sub-thread PRs`} into this branch?`;
    case 'settle':
      return 'Settle this thread?';
  }
}
