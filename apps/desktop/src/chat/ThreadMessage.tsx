import { useState, type ReactNode } from 'react';
import {
  ChevronRight,
  DiagramTree,
  InboxIn,
  InboxOut,
  Sparkles,
} from '@/icons';
import { MessageResponse } from '@/components/ai-elements/message';
import { cn } from '@/lib/utils';
import type { ActivityEntry, SubReport, ThreadRef } from '../model';
import { clock } from '../progress';
import { oneLine } from '../runtime/subagents';
import { useHarness } from '../store';
import { Expand } from '../WorkLog';

type Direction = 'from' | 'to';

/** A message another thread's agent sent this one, as a line in the log like a work group: open, it shows the whole message. */
export function ReceivedMessageRow({
  entry,
  from,
  index,
}: {
  entry: ActivityEntry;
  from: ThreadRef;
  index: number;
}) {
  const [isOpen, setOpen] = useState(false);
  const { title } = usePeer(from);
  return (
    <div data-activity-index={index} className="-mx-2 flex flex-col">
      <div className="group/log relative isolate flex h-7 w-fit max-w-full min-w-0 items-center gap-2 rounded-lg px-2 type-meta text-muted-foreground hover:bg-accent/60 hover:text-foreground">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-label={`Message from ${title}`}
          onClick={() => setOpen((o) => !o)}
          className="absolute inset-0 cursor-default rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2"
        />
        <ThreadMessageIcon direction="from" />
        <ThreadMessageLine direction="from" peer={from} text={entry.text} />
        <ChevronRight
          aria-hidden
          className={cn(
            'size-3 shrink-0 text-subtle-foreground transition-transform duration-150 motion-reduce:transition-none',
            isOpen && 'rotate-90',
          )}
        />
      </div>
      <Expand isOpen={isOpen}>
        <ThreadMessageBody text={entry.text} className="mx-2 mt-1">
          Received {clock(entry.at)}
        </ThreadMessageBody>
      </Expand>
    </div>
  );
}

/** An Auto-fix event Mochi sent the agent, as the same kind of line: "CI failed on #12 · fixing"; open, the whole event. */
export function AutofixEventRow({
  entry,
  event,
  index,
}: {
  entry: ActivityEntry;
  event: NonNullable<ActivityEntry['autofix']>;
  index: number;
}) {
  const [isOpen, setOpen] = useState(false);
  return (
    <div data-activity-index={index} className="-mx-2 flex flex-col">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 w-fit max-w-full min-w-0 cursor-default items-center gap-2 rounded-lg px-2 type-meta text-muted-foreground hover:bg-accent/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <Sparkles
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 truncate">
          {event.kind === 'enabled' ? 'Received a CI event' : event.title}
        </span>
        {event.kind === 'enabled' && (
          <span className="min-w-0 truncate text-subtle-foreground">
            {event.title}
          </span>
        )}
        <ChevronRight
          aria-hidden
          className={cn(
            'size-3 shrink-0 text-subtle-foreground transition-transform duration-150 motion-reduce:transition-none',
            isOpen && 'rotate-90',
          )}
        />
      </button>
      <Expand isOpen={isOpen}>
        <ThreadMessageBody text={entry.text} className="mx-2 mt-1">
          Sent by Auto-fix {clock(entry.at)}
        </ThreadMessageBody>
      </Expand>
    </div>
  );
}

/** A sub-thread's report (or a messaged thread's reply) as the same kind of line: "Report from <thread> done", its first line muted; open, the whole report. */
export function SubReportRow({
  entry,
  report,
}: {
  entry: ActivityEntry;
  report: SubReport;
}) {
  const [isOpen, setOpen] = useState(false);
  const hasBody = !!entry.text.trim();
  const preview = oneLine(entry.text);
  const kind = report.isReply ? 'Reply' : 'Report';
  const Icon = report.isReply ? InboxIn : DiagramTree;
  return (
    <div className="-mx-2 flex flex-col">
      <div
        className={cn(
          'group/log relative isolate flex h-7 w-fit max-w-full min-w-0 items-center gap-2 rounded-lg px-2 type-meta text-muted-foreground',
          hasBody && 'hover:bg-accent/60 hover:text-foreground',
        )}
      >
        {hasBody && (
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={`${kind} from ${report.title}`}
            onClick={() => setOpen((o) => !o)}
            className="absolute inset-0 cursor-default rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2"
          />
        )}
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0">{kind} from</span>
          <ThreadName
            peer={{ threadId: report.threadId, title: report.title }}
          />
          <span
            className={cn(
              report.status.length > STATUS_FITS
                ? 'min-w-0 truncate'
                : 'shrink-0 whitespace-nowrap',
              subReportTone(report),
            )}
            title={subReportStatus(report.status)}
          >
            {subReportStatus(report.status)}
          </span>
          {!!preview && (
            <span className="min-w-0 shrink-[4] truncate text-subtle-foreground">
              {preview}
            </span>
          )}
        </span>
        {hasBody && (
          <ChevronRight
            aria-hidden
            className={cn(
              'size-3 shrink-0 text-subtle-foreground transition-transform duration-150 motion-reduce:transition-none',
              isOpen && 'rotate-90',
            )}
          />
        )}
      </div>
      {hasBody && (
        <Expand isOpen={isOpen}>
          <ThreadMessageBody text={entry.text} className="mx-2 mt-1">
            Reported {clock(entry.at)} ·{' '}
            {report.isDelivered
              ? 'Delivered to the agent'
              : 'Waiting for the agent'}
          </ThreadMessageBody>
        </Expand>
      )}
    </div>
  );
}

// A status this short (done, blocked, PR #12: merged) always shows whole; a longer one (a stall) truncates with the preview.
const STATUS_FITS = 24;

function subReportStatus(status: string) {
  return status === 'needs_input' || status === 'no_change'
    ? status.replace('_', ' ')
    : status;
}

function subReportTone(report: SubReport) {
  if (report.status === 'failed') return 'text-destructive';
  if (report.isUrgent) return 'text-warning';
  return undefined;
}

export function ThreadMessageIcon({ direction }: { direction: Direction }) {
  const Icon = direction === 'from' ? InboxIn : InboxOut;
  return <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />;
}

/** "Message from <thread>" or "Messaging <thread>", then the message's first line, muted. The thread's name opens it. */
export function ThreadMessageLine({
  direction,
  peer,
  text,
}: {
  direction: Direction;
  peer?: ThreadRef;
  text?: string;
}) {
  const preview = oneLine(text);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0">
        {direction === 'from' ? 'Message from' : 'Messaging'}
      </span>
      {peer ? (
        <ThreadName peer={peer} />
      ) : (
        <span className="shrink-0">another thread</span>
      )}
      {!!preview && (
        <span className="min-w-0 truncate text-subtle-foreground">
          {preview}
        </span>
      )}
    </span>
  );
}

/** The whole message as markdown, with a caption under it (when it came, how it went). */
export function ThreadMessageBody({
  text,
  className,
  children,
}: {
  text: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-xl border px-3 py-2.5',
        className,
      )}
    >
      <MessageResponse
        isAnimating={false}
        className="type-prose text-foreground"
      >
        {text}
      </MessageResponse>
      <p className="type-caption text-subtle-foreground">{children}</p>
    </div>
  );
}

/** Above the row's own toggle (`z-10`), so the name opens the thread and the rest of the row opens the message. */
export function ThreadName({
  peer,
  className,
}: {
  peer: ThreadRef;
  className?: string;
}) {
  const { state, dispatch } = useHarness();
  const { thread, title } = usePeer(peer);
  if (!thread)
    return (
      <span
        className={cn(
          'max-w-[50%] shrink-0 truncate text-foreground',
          className,
        )}
      >
        {title}
      </span>
    );
  const open = () => {
    if (thread.spaceId !== state.spaceId)
      dispatch({ type: 'space', id: thread.spaceId });
    dispatch({ type: 'go', view: { kind: 'thread', id: thread.id } });
  };
  return (
    <button
      type="button"
      title={`Open “${title}”`}
      onClick={open}
      className={cn(
        'relative z-10 max-w-[50%] shrink-0 cursor-pointer truncate text-foreground underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none',
        className,
      )}
    >
      {title}
    </button>
  );
}

/** The other thread, and its name now or as it was when the message went (renamed, deleted). */
export function usePeer(peer: ThreadRef) {
  const { state } = useHarness();
  const thread = peer.threadId
    ? state.threads.find((t) => t.id === peer.threadId)
    : undefined;
  return { thread, title: thread?.title ?? peer.title };
}
