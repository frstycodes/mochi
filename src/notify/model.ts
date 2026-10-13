import type { LiveRun, Provider, QueueItem, Thread } from '../model.ts';
import { resetLabel } from '../usage/limits.ts';

export type NoticeKind = 'needs-you' | 'limit' | 'step-done' | 'review' | 'ci' | 'pr-review' | 'overlap' | 'race-lost' | 'run';

/** Only main alerts these, as OS notifications for watched threads (`electron/notify/watch.ts`); they never land in the center. */
type WatchKind = 'done' | 'failed';

export interface Notice {
  id: string;
  kind: NoticeKind;
  threadId: string;
  queueId?: string;
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
  review: 'Ready for review',
  done: 'Turn finished',
  failed: 'Agent failed',
  limit: 'Usage limit',
  ci: 'CI result',
  'pr-review': 'Pull request review',
  overlap: 'File overlap',
  'race-lost': 'Race lost',
  run: 'Scheduled run finished',
} satisfies Partial<Record<NoticeKind | WatchKind, string>>;

export const isAlertKind = (kind: NoticeKind): kind is NoticeKind & keyof typeof ALERT_KINDS => kind in ALERT_KINDS;

export const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

const BURST_MINUTES = 3;

/** Notices for what changed between two store snapshots. Pure: the notifications slice runs it after every action that touches threads or queue. */
export function diffNotices(prev: { threads: Thread[]; queue: QueueItem[] }, next: { threads: Thread[]; queue: QueueItem[] }, now: number): Notice[] {
  const notices: Notice[] = [];
  const add = (n: Omit<Notice, 'at' | 'isRead'>) => notices.push({ ...n, id: `${n.id}-${now}`, at: now, isRead: false });
  const before = new Map(prev.threads.map((t) => [t.id, t]));

  for (const t of next.threads) {
    const p = before.get(t.id);
    if (!p || p === t) continue;
    const limit = t.live?.limit;
    if (limit && !p.live?.limit) add({ id: `limit-${t.id}`, kind: 'limit', threadId: t.id, title: `${t.title} paused`, body: limitBody(t.providers[0], limit) });
    else if (p.live?.limit?.autoResume && !limit && !t.live?.isOnApiKey) add({ id: `limit-resumed-${t.id}`, kind: 'limit', threadId: t.id, title: `${t.title} resumed`, body: 'Its usage limit reset' });
    if (p.status !== 'needs-you' && t.status === 'needs-you' && !limit) {
      const blocked = t.steps.find((s) => s.status === 'blocked');
      add({ id: `needs-you-${t.id}`, kind: 'needs-you', threadId: t.id, title: `${t.title} needs you`, body: blocked ? `Paused before "${blocked.title}"` : 'Waiting on your answer' });
    }
    if (p.status !== 'review' && t.status === 'review') add({ id: `review-${t.id}`, kind: 'review', threadId: t.id, title: `${t.title} is ready for review`, body: 'Every step is done' });

    const steps = new Map(p.steps.map((s) => [s.id, s]));
    for (const s of t.steps) {
      const ps = steps.get(s.id);
      if (!ps || ps.status === s.status) continue;
      if (s.status === 'done') add({ id: `step-done-${s.id}`, kind: 'step-done', threadId: t.id, title: `Finished "${s.title}"`, body: t.title });
      if (s.status === 'dropped' && s.link?.mode === 'race') add({ id: `race-lost-${s.id}`, kind: 'race-lost', threadId: t.id, title: `Race lost: "${s.title}"`, body: s.note ?? t.title });
    }

    // GAP: a real review request comes from GitHub (review_requested webhook via host.git); the simulation only ever opens PRs.
    const prs = new Set(p.prs.map((pr) => pr.number));
    for (const pr of t.prs) {
      if (pr.state === 'open' && !prs.has(pr.number)) add({ id: `pr-review-${t.id}-${pr.number}`, kind: 'pr-review', threadId: t.id, title: `Review requested on #${pr.number}`, body: pr.title });
    }
  }

  const queued = new Set(prev.queue.map((q) => q.id));
  for (const q of next.queue) {
    if (queued.has(q.id)) continue;
    if (q.kind === 'ci') add({ id: `ci-${q.id}`, kind: 'ci', threadId: q.threadId, queueId: q.id, title: q.title, body: q.detail });
    if (q.kind === 'run') add({ id: `run-${q.id}`, kind: 'run', threadId: q.threadId, queueId: q.id, title: q.title, body: q.detail });
    if (q.kind === 'overlap') add({ id: `overlap-${q.id}`, kind: 'overlap', threadId: q.threadId, queueId: q.id, title: q.title, body: q.detail });
  }
  return notices;
}

/** Folds runs of notices from one thread that land within a few minutes of each other, newest first. */
export function groupBursts(notices: Notice[]): Burst[] {
  const bursts: Burst[] = [];
  for (const n of [...notices].sort((a, b) => b.at - a.at)) {
    const last = bursts[bursts.length - 1];
    const head = last?.notices[last.notices.length - 1];
    if (last && last.threadId === n.threadId && head.at - n.at <= BURST_MINUTES) last.notices.push(n);
    else bursts.push({ id: n.id, threadId: n.threadId, notices: [n] });
  }
  return bursts;
}

export function isQuiet(quiet: QuietHours, date: Date) {
  if (!quiet.isOn || quiet.start === quiet.end) return false;
  const h = date.getHours();
  return quiet.start < quiet.end ? h >= quiet.start && h < quiet.end : h >= quiet.start || h < quiet.end;
}

function limitBody(provider: Provider, limit: NonNullable<LiveRun['limit']>) {
  const name = provider === 'claude' ? 'Claude' : 'Codex';
  const window = limit.label ? `${limit.label.toLowerCase()} ` : '';
  return `${name} hit the ${window}usage limit${limit.resetsAt ? `; resets ${resetLabel(limit.resetsAt)}` : ''}`;
}
