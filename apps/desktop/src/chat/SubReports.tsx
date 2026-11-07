import { useState, type ReactNode } from 'react';
import { Chat } from '@/icons';
import { Expand, FoldChevron } from '@/Fold';
import { cn } from '@/lib/utils';
import { plural } from '@mochi/domain/lib/format';
import type { ActivityEntry, SubReport } from '../model';
import { clock } from '../progress';
import { oneLine } from '../runtime/subagents';
import { ProviderMark, StatusMark, type StatusMarkKind } from '../ui';
import { FramedCard, FramedItem } from './FramedCard';
import { ThreadMessageBody, ThreadName, usePeer } from './ThreadMessage';

/**
 * Messages from sub-threads (their reports, and replies from messaged threads) logged back to back, as one card: what needs you first, each with its
 * agent's mark, its name (opens the thread), its status and first line, which opens to the whole report. Past `SHOWN_OPEN` the
 * card folds into one counted line that opens to it.
 */
export function SubReports({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length > SHOWN_OPEN) return <FoldedReports entries={entries} />;
  return (
    <ReportsCard
      entries={entries}
      header={
        <>
          <Chat aria-hidden className="size-4 shrink-0" />
          {countLabel(entries)}
        </>
      }
    />
  );
}

const SHOWN_OPEN = 4;

function FoldedReports({ entries }: { entries: ActivityEntry[] }) {
  const [isOpen, setOpen] = useState(false);
  const needYou = entries.filter((e) => !!toneOf(e.subReport!)).length;
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setOpen((o) => !o)}
        className="-mx-2 flex h-7 w-fit max-w-full min-w-0 cursor-default items-center gap-2 rounded-lg px-2 type-meta text-muted-foreground hover:bg-accent/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <Chat aria-hidden className="size-4 shrink-0" />
        <span className="truncate">{countLabel(entries)}</span>
        {needYou > 0 && (
          <span className="shrink-0 text-warning">· {needYou} need you</span>
        )}
        <FoldChevron isOpen={isOpen} className="text-subtle-foreground" />
      </button>
      <Expand isOpen={isOpen}>
        <ReportsCard entries={entries} className="mt-1.5" />
      </Expand>
    </div>
  );
}

function ReportsCard({
  entries,
  header,
  className,
}: {
  entries: ActivityEntry[];
  header?: ReactNode;
  className?: string;
}) {
  return (
    <FramedCard header={header} className={className}>
      {needYouFirst(entries).map((entry) => (
        <ReportItem
          key={`${entry.at}-${entry.subReport!.threadId}`}
          entry={entry}
          report={entry.subReport!}
        />
      ))}
    </FramedCard>
  );
}

function ReportItem({
  entry,
  report,
}: {
  entry: ActivityEntry;
  report: SubReport;
}) {
  const [isOpen, setOpen] = useState(false);
  const { thread } = usePeer(report);
  const preview = oneLine(entry.text);
  const status = statusLabel(report.status);
  return (
    <FramedItem className="gap-1 py-2.5">
      <div className="flex min-w-0 items-center gap-2 type-body">
        <StatusMark status={markOf(report)} label={status} />
        {!!thread && (
          <ProviderMark
            provider={thread.providers[0]}
            size={14}
            className="shrink-0"
          />
        )}
        <ThreadName
          peer={report}
          className="max-w-none min-w-0 shrink font-medium"
        />
        <span
          title={status}
          className={cn(
            'ms-auto max-w-[50%] min-w-0 truncate type-meta',
            toneOf(report) ?? 'text-subtle-foreground',
          )}
        >
          {status}
        </span>
      </div>
      {!!preview && (
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => setOpen((o) => !o)}
          className="flex cursor-default items-start gap-1 ps-3.5 text-left type-meta text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <span
            className={cn(
              'min-w-0 [overflow-wrap:anywhere]',
              !isOpen && 'line-clamp-2',
            )}
          >
            {preview}
          </span>
          <FoldChevron
            isOpen={isOpen}
            className="mt-0.5 text-subtle-foreground"
          />
        </button>
      )}
      {!!preview && (
        <Expand isOpen={isOpen}>
          <ThreadMessageBody text={entry.text} className="ms-3.5 mt-1">
            Received {clock(entry.at)} ·{' '}
            {report.isDelivered
              ? 'Delivered to the agent'
              : 'Waiting for the agent'}
          </ThreadMessageBody>
        </Expand>
      )}
    </FramedItem>
  );
}

/** Messages like any other between agents: "Message from a sub-thread", "3 messages from sub-threads", or "from threads" when every one is a messaged thread's reply. */
export function countLabel(entries: Pick<ActivityEntry, 'subReport'>[]) {
  const n = entries.length;
  const from = entries.every((e) => e.subReport!.isReply)
    ? plural(n, 'a thread', 'threads')
    : plural(n, 'a sub-thread', 'sub-threads');
  return n === 1 ? `Message from ${from}` : `${n} messages from ${from}`;
}

/** Stable: what needs you (failed, blocked, waiting) first, otherwise in the order they came. */
const needYouFirst = (entries: ActivityEntry[]) =>
  [...entries].sort((a, b) => +!toneOf(a.subReport!) - +!toneOf(b.subReport!));

function markOf(report: SubReport): StatusMarkKind {
  if (report.status === 'failed') return 'failed';
  if (report.isUrgent) return 'needs-you';
  if (report.status === 'interrupted') return 'dropped';
  return 'settled';
}

function toneOf(report: SubReport) {
  if (report.status === 'failed') return 'text-destructive';
  if (report.isUrgent) return 'text-warning';
}

function statusLabel(status: string) {
  const words =
    status === 'needs_input' || status === 'no_change'
      ? status.replace('_', ' ')
      : status;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
