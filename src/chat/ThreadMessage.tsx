import { useState, type ReactNode } from 'react';
import { ChevronRight, DirectboxReceive, DirectboxSend } from 'reicon-react';
import { MessageResponse } from '@/components/ai-elements/message';
import { cn } from '@/lib/utils';
import type { ActivityEntry, ThreadRef } from '../model';
import { clock } from '../progress';
import { oneLine } from '../runtime/subagents';
import { useHarness } from '../store';
import { Expand } from '../WorkLog';

type Direction = 'from' | 'to';

/** A message another thread's agent sent this one, as a line in the log like a work group: open, it shows the whole message. */
export function ReceivedMessageRow({ entry, from, index }: { entry: ActivityEntry; from: ThreadRef; index: number }) {
  const [isOpen, setOpen] = useState(false);
  const { title } = usePeer(from);
  return (
    <div data-activity-index={index} className="-mx-2 flex flex-col">
      <div className="group/log relative isolate flex h-7 w-fit max-w-full min-w-0 items-center gap-2 rounded-lg px-2 type-meta text-muted-foreground hover:bg-accent/60 hover:text-foreground">
        <button type="button" aria-expanded={isOpen} aria-label={`Message from ${title}`} onClick={() => setOpen((o) => !o)} className="absolute inset-0 cursor-default rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2" />
        <ThreadMessageIcon direction="from" />
        <ThreadMessageLine direction="from" peer={from} text={entry.text} />
        <ChevronRight aria-hidden className={cn('size-3 shrink-0 text-subtle-foreground transition-transform duration-150 motion-reduce:transition-none', isOpen && 'rotate-90')} />
      </div>
      <Expand isOpen={isOpen}>
        <ThreadMessageBody text={entry.text} className="mx-2 mt-1">
          Received {clock(entry.at)}
        </ThreadMessageBody>
      </Expand>
    </div>
  );
}

export function ThreadMessageIcon({ direction }: { direction: Direction }) {
  const Icon = direction === 'from' ? DirectboxReceive : DirectboxSend;
  return <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />;
}

/** "Message from <thread>" or "Messaging <thread>", then the message's first line, muted. The thread's name opens it. */
export function ThreadMessageLine({ direction, peer, text }: { direction: Direction; peer?: ThreadRef; text?: string }) {
  const preview = oneLine(text);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0">{direction === 'from' ? 'Message from' : 'Messaging'}</span>
      {peer ? <ThreadName peer={peer} /> : <span className="shrink-0">another thread</span>}
      {!!preview && <span className="min-w-0 truncate text-subtle-foreground">{preview}</span>}
    </span>
  );
}

/** The whole message as markdown, with a caption under it (when it came, how it went). */
export function ThreadMessageBody({ text, className, children }: { text: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn('flex flex-col gap-2 rounded-xl border px-3 py-2.5', className)}>
      <MessageResponse isAnimating={false} className="type-prose text-foreground">
        {text}
      </MessageResponse>
      <p className="type-caption text-subtle-foreground">{children}</p>
    </div>
  );
}

/** Above the row's own toggle (`z-10`), so the name opens the thread and the rest of the row opens the message. */
export function ThreadName({ peer }: { peer: ThreadRef }) {
  const { state, dispatch } = useHarness();
  const { thread, title } = usePeer(peer);
  if (!thread) return <span className="max-w-[50%] shrink-0 truncate text-foreground">{title}</span>;
  const open = () => {
    if (thread.spaceId !== state.spaceId) dispatch({ type: 'space', id: thread.spaceId });
    dispatch({ type: 'go', view: { kind: 'thread', id: thread.id } });
  };
  return (
    <button type="button" title={`Open “${title}”`} onClick={open} className="relative z-10 max-w-[50%] shrink-0 cursor-pointer truncate text-foreground underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none">
      {title}
    </button>
  );
}

/** The other thread, and its name now or as it was when the message went (renamed, deleted). */
export function usePeer(peer: ThreadRef) {
  const { state } = useHarness();
  const thread = peer.threadId ? state.threads.find((t) => t.id === peer.threadId) : undefined;
  return { thread, title: thread?.title ?? peer.title };
}
