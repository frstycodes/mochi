import type { RefStatus } from '../chat/refs.ts';
import type { Thread, TurnReport } from '../model.ts';
import { parentOf, subThreadsOf } from '../reorder.ts';
import { nextStep } from './report.ts';
import { YOUR_CALL, type Verdict } from './verdict.ts';

export type MoveKind = 'confirm' | 'close-gaps' | 'continue' | 'commit' | 'open-pr' | 'hand-back' | 'merge-subs' | 'settle';

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
    .flatMap((t) => t.prs.filter((p) => p.state === 'open' || p.state === 'draft').map((p) => p.number));
  return { ...(parent && { parent }), ...(subPrs.length && { subPrs }) };
}

/**
 * The one thing that moves this goal forward from here, in order: confirm what only you can check, close the gaps, continue a stopped
 * plan, commit, open the pull request, settle. Null when it waits on your answer, the clock or GitHub. A proposed goal waits on
 * the proposal card's own Accept, so the end-of-turn card only asks.
 */
export function moveFor(thread: Thread, verdict: Verdict, prStates: RefStatus[], context: MoveContext = {}): Move | null {
  const open = verdict.gaps.filter((g) => !g.isAccepted).length;
  if (verdict.subThread) return subMove(verdict.subThread);
  if (verdict.chip === YOUR_CALL) {
    if (thread.repo && thread.idle?.uncommitted) return { kind: 'commit', label: 'Commit' };
    if (thread.repo && nextStep(prStates) === 'open-pr') return { kind: 'open-pr', label: 'Open pull request' };
    return { kind: 'confirm', label: 'Verify outcome' };
  }
  if (verdict.kind === 'needs-you') return null;
  if (verdict.kind === 'gaps') return { kind: 'close-gaps', label: `Close ${open} ${open === 1 ? 'gap' : 'gaps'}` };
  if (verdict.kind === 'stalled') return verdict.chip === 'Stopped' ? { kind: 'continue', label: 'Continue' } : null;
  if (verdict.kind !== 'done') return null;
  if (!thread.repo) {
    if (!thread.idle?.isConfirmed && thread.criteria?.some((c) => !c.command)) return { kind: 'confirm', label: 'Verify outcome' };
    return { kind: 'settle', label: 'Settle thread' };
  }
  if (thread.idle?.uncommitted) return { kind: 'commit', label: 'Commit' };
  const subPrs = context.subPrs ?? [];
  if (subPrs.length) return { kind: 'merge-subs', label: `Merge ${subPrs.length} ${subPrs.length === 1 ? 'PR' : 'PRs'}` };
  const step = nextStep(prStates);
  if (step === 'open-pr') return { kind: 'open-pr', label: 'Open pull request' };
  // A sub-thread's PR goes into its parent's branch; once it's open, the result goes back and the parent merges it.
  if (thread.parent && step === 'review') return thread.parent.handedBackAt ? null : { kind: 'hand-back', label: 'Hand back' };
  return step === 'settle' ? { kind: 'settle', label: 'Settle thread' } : null;
}

/** A parent's move for the sub-thread that holds it up: its gaps go to its own agent, a finished one is handed back. */
function subMove(sub: NonNullable<Verdict['subThread']>): Move | null {
  if (sub.kind === 'gaps') return { kind: 'close-gaps', label: `Close ${sub.openGaps} ${sub.openGaps === 1 ? 'gap' : 'gaps'}`, threadId: sub.id };
  if (sub.kind === 'done' || sub.kind === 'idle') return { kind: 'hand-back', label: 'Hand back', threadId: sub.id };
  return null;
}

/** The question matches the action; only Continue uses the agent's proposed next move. */
export function questionFor(verdict: Verdict, move: Move | null, report: TurnReport | undefined, agent: string, context: MoveContext = {}): string | null {
  if (!move) return verdict.kind === 'needs-you' ? verdict.reason : null;
  const open = verdict.gaps.filter((g) => !g.isAccepted).length;
  const sub = verdict.subThread;
  if (sub && move.kind === 'close-gaps') return `${sub.title} has ${sub.openGaps === 1 ? 'a gap' : `${sub.openGaps} gaps`}: hand ${sub.openGaps === 1 ? 'it' : 'them'} back to its agent?`;
  if (sub && move.kind === 'hand-back') return `${sub.title} is finished. Hand its result back to this thread?`;
  switch (move.kind) {
    case 'confirm':
      return verdict.kind === 'done' ? 'Verify the completed work against the goal criteria?' : verdict.reason;
    case 'close-gaps':
      return `Hand the ${open === 1 ? 'gap' : `${open} gaps`} back to ${agent}?`;
    case 'continue':
      return report?.next ?? `Pick up where ${agent} stopped?`;
    case 'commit':
      return 'Commit these changes?';
    case 'open-pr':
      return context.parent?.repo ? `Open a pull request into ${context.parent.repo.branch}?` : 'Open a pull request for this?';
    case 'hand-back':
      return `Hand the result back to ${context.parent?.title ?? 'its parent thread'}?`;
    case 'merge-subs':
      return `Merge the ${context.subPrs?.length === 1 ? 'sub-thread PR' : `${context.subPrs?.length} sub-thread PRs`} into this branch?`;
    case 'settle':
      return 'Settle this thread?';
  }
}
