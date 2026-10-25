import {
  isMochiCard,
  type QueueItem,
  type Thread,
  type ThreadStatus,
} from '../model.ts';
import { isQuiet, type QuietHours } from './model.ts';

/**
 * What this computer last saw of another one's threads, kept per machine across launches. Alerts come from the difference
 * with it, never from the stream's actions, so a snapshot after a reconnect (or the same actions replayed) adds nothing new.
 */
export interface RemoteBaseline {
  /** Open approvals and questions, by queue id. */
  asks: string[];
  threads: Record<string, { status: ThreadStatus; isWorking: boolean }>;
}

export interface RemoteAlert {
  /** Stable for the occurrence, so a notification's click finds it. */
  id: string;
  kind: 'needs-you' | 'review' | 'done' | 'failed';
  threadId: string;
  queueId?: string;
  title: string;
  body: string;
}

const UNSEEN = {
  status: 'running',
  isWorking: false,
} satisfies RemoteBaseline['threads'][string];

export function baselineOf({
  threads,
  queue,
}: {
  threads: Thread[];
  queue: QueueItem[];
}): RemoteBaseline {
  return {
    asks: openAsks(queue).map((q) => q.id),
    threads: Object.fromEntries(
      threads.map((t) => [
        t.id,
        { status: t.status, isWorking: !!t.live?.isWorking },
      ]),
    ),
  };
}

/** What started needing you since `prev`; none on the first look at a machine, which only sets the baseline. */
export function remoteAlerts(
  prev: RemoteBaseline | undefined,
  next: { threads: Thread[]; queue: QueueItem[] },
): RemoteAlert[] {
  if (!prev) return [];
  const alerts: RemoteAlert[] = [];
  const asks = openAsks(next.queue);
  const asked = new Set(prev.asks);
  for (const q of asks) {
    if (asked.has(q.id)) continue;
    const t = next.threads.find((x) => x.id === q.threadId);
    if (t)
      alerts.push({
        id: `ask-${q.id}`,
        kind: 'needs-you',
        threadId: t.id,
        queueId: q.id,
        title: `${t.title} needs you`,
        body: q.title,
      });
  }
  for (const t of next.threads) {
    if (t.status === 'settled') continue;
    const was = prev.threads[t.id] ?? UNSEEN;
    // A turn that stopped since: how it ended, as the machine recorded it. A limit has its own card; a stop you made, none.
    const ended =
      was.isWorking && !t.live?.isWorking && !t.live?.limit
        ? t.live?.turnEnd
        : undefined;
    const add = (kind: RemoteAlert['kind'], title: string, body: string) =>
      alerts.push({
        id: `${kind}-${t.id}-${t.activity.length}`,
        kind,
        threadId: t.id,
        title,
        body,
      });
    if (ended === 'failed')
      add('failed', `${t.title} failed`, 'The agent stopped with an error');
    else if (t.status === 'review' && was.status !== 'review')
      add('review', `${t.title} is ready for review`, 'Every step is done');
    else if (
      t.status === 'needs-you' &&
      was.status !== 'needs-you' &&
      !t.live?.limit &&
      !asks.some((q) => q.threadId === t.id)
    )
      add('needs-you', `${t.title} needs you`, 'Waiting on your answer');
    else if (ended === 'done' && t.status !== 'needs-you')
      add('done', t.title, 'Turn finished');
  }
  return alerts;
}

function openAsks(queue: QueueItem[]) {
  return queue.filter(
    (q) => (q.kind === 'approval' || q.kind === 'question') && !isMochiCard(q),
  );
}

/** Settings › Notifications decides, as for this computer's own: each kind's switch, and nothing during quiet hours. */
export function alertsToShow(
  alerts: RemoteAlert[],
  { kinds, quiet }: { kinds: string[]; quiet: QuietHours },
  date: Date,
) {
  return isQuiet(quiet, date)
    ? []
    : alerts.filter((a) => kinds.includes(a.kind));
}
