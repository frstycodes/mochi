import {
  isListed,
  isMochiCard,
  type LiveRun,
  type Provider,
  type QueueItem,
  type Thread,
} from '../model.ts';
import { resetLabel } from '../usage/limits.ts';
import {
  bareStates,
  idleVerdict,
  subThreadVerdicts,
  type Verdict,
  type VerdictKind,
} from '../goals/verdict.ts';
import { parentOf } from '../reorder.ts';

export type NoticeKind =
  | 'needs-you'
  | 'limit'
  | 'step-done'
  | 'ci'
  | 'pr-review'
  | 'run'
  | 'idle';

/** Only main alerts these, as OS notifications for watched threads (`electron/notify/watch.ts`); they never land in the center. */
type WatchKind = 'done' | 'failed';

export type AlertKind = NoticeKind | WatchKind;

export interface Notice {
  id: string;
  kind: NoticeKind;
  threadId: string;
  queueId?: string;
  /** `pr-review`: the PR it's about, for its preview card. */
  prNumber?: number;
  /** `idle`: Mochi's verdict, which Settings › Notifications picks alerts by. */
  verdict?: VerdictKind;
  title: string;
  body: string;
  /** Simulation minutes, same clock as `State.now`. */
  at: number;
  isRead: boolean;
}

export interface QuietHours {
  isOn: boolean;
  /** Local wall-clock hours, 0–23; `start > end` wraps past midnight. */
  start: number;
  end: number;
}

export interface Burst {
  id: string;
  threadId: string;
  notices: Notice[];
}

/** Kinds worth interrupting for: an OS notification or toast, each switchable in Settings › Notifications. Step-done only lands in the center. */
export const ALERT_KINDS = {
  'needs-you': 'Needs you',
  done: 'Turn finished',
  failed: 'Agent failed',
  limit: 'Usage limit',
  ci: 'CI result',
  'pr-review': 'Pull request review',
  run: 'Scheduled run finished',
} satisfies Partial<Record<NoticeKind | WatchKind, string>>;

export const isAlertKind = (
  kind: NoticeKind,
): kind is NoticeKind & keyof typeof ALERT_KINDS => kind in ALERT_KINDS;

/**
 * What you did in a notice's thread, and where it stands now. `thread`/`queue` are absent in main, which only hears view and act
 * signals, so the rules that read them don't fire there.
 */
export interface Addressing {
  /** The thread is on screen in a focused window. */
  isViewed?: boolean;
  /** You sent, answered, rewound, resumed, stopped or settled in the thread since the notice arrived. */
  isActedOn?: boolean;
  thread?: Thread;
  queue?: QueueItem[];
}

type Addressable = {
  kind: AlertKind;
  queueId?: string;
  prNumber?: number;
  verdict?: VerdictKind;
};

/** Per kind, when a notice has been dealt with inside its thread and leaves the center (and the OS notification closes). */
const ADDRESSED = {
  // Looking doesn't answer a question; answering it, or anything else you send, does.
  'needs-you': (_, a) =>
    !!a.isActedOn || (!!a.thread && a.thread.status !== 'needs-you'),
  done: (_, a) => !!a.isViewed || !!a.isActedOn,
  failed: (_, a) => !!a.isActedOn,
  limit: (_, a) => !!a.isViewed || !!a.isActedOn,
  'step-done': (_, a) => !!a.isViewed || !!a.isActedOn,
  idle: (n, a) =>
    !!a.isActedOn ||
    (!!a.isViewed && (n.verdict === 'done' || n.verdict === 'gaps')),
  ci: (n, a) => !!a.isActedOn || isSettled(n, a),
  run: (n, a) => !!a.isViewed || !!a.isActedOn || isSettled(n, a),
  'pr-review': (n, a) =>
    !!a.isViewed ||
    (!!a.thread &&
      !a.thread.prs.some(
        (pr) => pr.number === n.prNumber && pr.state === 'open',
      )),
} satisfies Record<AlertKind, (n: Addressable, a: Addressing) => boolean>;

export const isAddressed = (n: Addressable, a: Addressing) =>
  ADDRESSED[n.kind](n, a);

const isSettled = (n: Addressable, a: Addressing) =>
  !!a.queue && !!n.queueId && !a.queue.some((q) => q.id === n.queueId);

export const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

const BURST_MINUTES = 3;

/**
 * The question or approval a thread is waiting on, newest first, so its needs-you toast opens straight into it.
 * GAP: one that lands in the queue after the status change, in a later action, leaves the notice without it.
 */
function pendingAsk(queue: QueueItem[], threadId: string) {
  const asks = queue.filter(
    (q) =>
      q.threadId === threadId &&
      (q.kind === 'question' || q.kind === 'approval') &&
      !isMochiCard(q),
  );
  return asks.reduce<QueueItem | undefined>(
    (newest, q) => (!newest || q.createdAt > newest.createdAt ? q : newest),
    undefined,
  );
}

/** Notices for what changed between two store snapshots. Pure: the notifications slice runs it after every action that touches threads or queue. */
export function diffNotices(
  prev: { threads: Thread[]; queue: QueueItem[] },
  next: { threads: Thread[]; queue: QueueItem[] },
  now: number,
): Notice[] {
  const notices: Notice[] = [];
  const add = (n: Omit<Notice, 'at' | 'isRead'>) =>
    notices.push({ ...n, id: `${n.id}-${now}`, at: now, isRead: false });
  const before = new Map(prev.threads.map((t) => [t.id, t]));

  for (const t of next.threads) {
    const p = before.get(t.id);
    if (!p || p === t || !isListed(t)) continue;
    const limit = t.live?.limit;
    const was = p.live?.limit;
    if (limit && !was)
      add({
        id: `limit-${t.id}`,
        kind: 'limit',
        threadId: t.id,
        title: limit.isTurnHeld
          ? `${t.title} is waiting`
          : `${t.title} stopped`,
        body: limitBody(t.providers[0], limit),
      });
    // Going on by itself: Claude Code past the reset, or Codex on the Resume at reset you chose. Not a stop you made, not the API key.
    else if (
      was &&
      !limit &&
      (was.isTurnHeld || was.autoResume) &&
      t.live?.isWorking &&
      !t.live.isOnApiKey
    )
      add({
        id: `limit-resumed-${t.id}`,
        kind: 'limit',
        threadId: t.id,
        title: `${t.title} continued`,
        body: 'Its usage limit reset',
      });
    // A failed turn also lands on needs-you; its idle verdict (Stalled) says why instead.
    if (
      p.status !== 'needs-you' &&
      t.status === 'needs-you' &&
      !limit &&
      t.queuePause !== 'failed'
    ) {
      const blocked = t.steps.find((s) => s.status === 'blocked');
      const ask = pendingAsk(next.queue, t.id);
      add({
        id: `needs-you-${t.id}`,
        kind: 'needs-you',
        threadId: t.id,
        queueId: ask?.id,
        title: `${t.title} needs you`,
        body:
          ask?.title ??
          (blocked
            ? `Paused before "${blocked.title}"`
            : 'Waiting on your answer'),
      });
    }
    // A parent waiting on its sub-threads says nothing; each sub-thread's own notice names the parent it belongs to.
    const verdict =
      p.idle?.isGathering && t.idle && !t.idle.isGathering
        ? idleVerdict(t, bareStates(t), subThreadVerdicts(next.threads, t.id))
        : null;
    const parent = parentOf(next.threads, t);
    if (verdict && isIdleNotice(t, verdict))
      add({
        id: `idle-${t.id}`,
        kind: 'idle',
        verdict: verdict.kind,
        threadId: t.id,
        title: idleTitle(t.title, verdict),
        body: parent
          ? `Sub-thread of “${parent.title}” · ${verdict.reason}`
          : verdict.reason,
      });

    const steps = new Map(p.steps.map((s) => [s.id, s]));
    for (const s of t.steps) {
      const ps = steps.get(s.id);
      if (!ps || ps.status === s.status) continue;
      if (s.status === 'done')
        add({
          id: `step-done-${s.id}`,
          kind: 'step-done',
          threadId: t.id,
          title: `Finished "${s.title}"`,
          body: t.title,
        });
    }

    // GAP: a real review request comes from GitHub (review_requested webhook via host.git); the simulation only ever opens PRs.
    const prs = new Set(p.prs.map((pr) => pr.number));
    for (const pr of t.prs) {
      if (pr.state === 'open' && !prs.has(pr.number))
        add({
          id: `pr-review-${t.id}-${pr.number}`,
          kind: 'pr-review',
          threadId: t.id,
          prNumber: pr.number,
          title: `Review requested on #${pr.number}`,
          body: pr.title,
        });
    }
  }

  const queued = new Set(prev.queue.map((q) => q.id));
  for (const q of next.queue) {
    if (queued.has(q.id)) continue;
    if (q.kind === 'ci')
      add({
        id: `ci-${q.id}`,
        kind: 'ci',
        threadId: q.threadId,
        queueId: q.id,
        title: q.title,
        body: q.detail,
      });
    if (q.kind === 'run')
      add({
        id: `run-${q.id}`,
        kind: 'run',
        threadId: q.threadId,
        queueId: q.id,
        title: q.title,
        body: q.detail,
      });
  }
  return notices;
}

/** Folds runs of notices from one thread that land within a few minutes of each other, newest first. */
export function groupBursts(notices: Notice[]): Burst[] {
  const bursts: Burst[] = [];
  for (const n of [...notices].sort((a, b) => b.at - a.at)) {
    const last = bursts[bursts.length - 1];
    const head = last?.notices[last.notices.length - 1];
    if (last && last.threadId === n.threadId && head.at - n.at <= BURST_MINUTES)
      last.notices.push(n);
    else bursts.push({ id: n.id, threadId: n.threadId, notices: [n] });
  }
  return bursts;
}

export function isQuiet(quiet: QuietHours, date: Date) {
  if (!quiet.isOn || quiet.start === quiet.end) return false;
  const h = date.getHours();
  return quiet.start < quiet.end
    ? h >= quiet.start && h < quiet.end
    : h >= quiet.start || h < quiet.end;
}

/** What the other notices don't already say: a tray question and a usage limit have their own. */
function isIdleNotice(t: Thread, v: Verdict) {
  if (v.kind === 'needs-you') return t.status !== 'needs-you';
  if (v.kind === 'stalled') return v.chip !== 'Limit';
  return v.kind === 'gaps' || v.kind === 'done';
}

function idleTitle(title: string, v: Verdict) {
  if (v.kind === 'gaps') return `${v.chip} in “${title}”`;
  if (v.kind === 'needs-you') return `“${title}” needs you`;
  if (v.kind === 'stalled') return `“${title}” stalled`;
  return `“${title}” is done`;
}

function limitBody(provider: Provider, limit: NonNullable<LiveRun['limit']>) {
  const name = provider === 'claude' ? 'Claude' : 'Codex';
  const window = limit.label ? `${limit.label.toLowerCase()} ` : '';
  const reset = limit.resetsAt ? ` at ${resetLabel(limit.resetsAt)}` : '';
  return limit.isTurnHeld
    ? `${name} hit the ${window}usage limit and continues after the reset${reset}`
    : `${name} hit the ${window}usage limit; resets${reset || ' later'}`;
}
