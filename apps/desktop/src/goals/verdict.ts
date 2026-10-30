import type { Thread } from '../model.ts';
import type { RefTone } from '@mochi/domain/chat/refs';
import { resetLabel } from '../usage/limits.ts';
import { turnReport } from './report.ts';

export type VerdictKind = 'needs-you' | 'stalled' | 'idle';

export interface Verdict {
  kind: VerdictKind;
  /** The sidebar chip: "Question", "Limit". */
  chip: string;
  tone: Extract<RefTone, 'warning' | 'destructive' | 'muted'>;
  /** The one line after the chip. */
  reason: string;
}

export const TONE_CLASS = {
  warning: 'text-warning',
  destructive: 'text-destructive',
  muted: 'text-muted-foreground',
} satisfies Record<Verdict['tone'], string>;

/** Why an idle thread stopped: a usage limit, an error, or a question waiting on you; else just idle. Null while the agent works or once settled. */
export function idleVerdict(thread: Thread): Verdict | null {
  if (thread.live?.isWorking || thread.status === 'settled') return null;
  const limit = thread.live?.limit;
  if (limit)
    return {
      kind: 'stalled',
      chip: 'Limit',
      tone: 'destructive',
      reason: limitReason(limit),
    };
  if (thread.queuePause === 'failed')
    return {
      kind: 'stalled',
      chip: 'Error',
      tone: 'destructive',
      reason: failure(thread) ?? 'The agent stopped with an error',
    };
  const question = asked(thread);
  if (question)
    return {
      kind: 'needs-you',
      chip: question.chip,
      tone: 'warning',
      reason: question.text,
    };
  return { kind: 'idle', chip: 'Idle', tone: 'muted', reason: 'Idle' };
}

/** A question waiting in the tray, else one the agent asked in its report. */
function asked(thread: Thread) {
  if (thread.status === 'needs-you') {
    const blocked = thread.steps.find((s) => s.status === 'blocked');
    return {
      chip: blocked ? 'Approval' : 'Question',
      text: blocked
        ? `Paused before "${blocked.title}"`
        : 'Waiting on your answer',
    };
  }
  const report = turnReport(thread);
  // A question written before the agent read your message isn't asked: your message may have answered it.
  const question = report?.isSuperseded ? undefined : report?.question;
  return question ? { chip: 'Question', text: question } : null;
}

function limitReason(limit: NonNullable<NonNullable<Thread['live']>['limit']>) {
  const window = limit.label ? `${limit.label} limit` : 'Usage limit';
  return limit.resetsAt
    ? `${window} · resumes ${resetLabel(limit.resetsAt)}`
    : window;
}

const FAILED = 'Turn failed: ';

function failure(thread: Thread) {
  return thread.activity
    .findLast((e) => e.who === 'harness' && e.text.startsWith(FAILED))
    ?.text.slice(FAILED.length);
}

/** The card's title. */
export function verdictTitle(verdict: Verdict) {
  if (verdict.kind === 'needs-you') return 'Needs you';
  if (verdict.kind === 'idle') return 'Idle';
  return verdict.chip === 'Limit'
    ? 'Stalled · usage limit'
    : 'Stalled · the agent exited';
}
