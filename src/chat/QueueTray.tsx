import { useState } from 'react';
import { motion, Reorder, useReducedMotionConfig } from 'motion/react';
import { ChevronDown, ChevronUp, Edit, MentionCircle, Paperclip, Trash3 } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { QueuedMessage, Thread } from '../model';
import { useHarness } from '../store';
import { TooltipIconButton } from '../ui';
import { moveQueued, PAUSE_REASONS } from './outbox';

/** Messages waiting for the agent's turn to end, docked in the composer above the text like the question tray. */
export function QueueTray({ thread, onSendNow, onEdit }: { thread: Thread; onSendNow: (message: QueuedMessage) => void; onEdit: (message: QueuedMessage) => void }) {
  const { dispatch } = useHarness();
  const reduce = useReducedMotionConfig();
  const [isOpen, setOpen] = useState(true);
  const queued = thread.queued ?? [];
  if (queued.length === 0) return null;
  const ids = queued.map((m) => m.id);
  const order = (next: string[]) => dispatch({ type: 'queued-order', threadId: thread.id, ids: next });

  return (
    <section aria-label="Queued messages">
      <div className="flex h-9 items-center gap-2 pr-2 type-meta">
        <button type="button" aria-expanded={isOpen} onClick={() => setOpen((o) => !o)} className="flex h-full min-w-0 flex-1 cursor-default items-center gap-2 pl-4 text-left">
          <span className="shrink-0 font-medium">{queued.length} queued</span>
          <QueueStatus thread={thread} preview={isOpen ? undefined : queued[0].draft} />
          <span className="ml-auto shrink-0 text-subtle-foreground">{isOpen ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}</span>
        </button>
        {!!thread.queuePause && thread.queuePause !== 'limit' && (
          <Button variant="outline" size="xs" className="rounded-full" onClick={() => dispatch({ type: 'queued-resume', threadId: thread.id })}>
            Resume
          </Button>
        )}
      </div>
      {isOpen && (
        <motion.div initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
          <ScrollArea className="[&>[data-slot=scroll-area-viewport]]:max-h-[min(30vh,14rem)]">
            <Reorder.Group as="ol" axis="y" values={ids} onReorder={order} className="flex flex-col gap-0.5 px-1 pb-1 select-none">
              {queued.map((message) => (
                <QueueRow key={message.id} message={message} onSendNow={onSendNow} onEdit={onEdit} onRemove={() => dispatch({ type: 'queued-remove', threadId: thread.id, id: message.id })} onMove={(step) => order(moveQueued(ids, message.id, step))} />
              ))}
            </Reorder.Group>
          </ScrollArea>
        </motion.div>
      )}
    </section>
  );
}

function QueueStatus({ thread, preview }: { thread: Thread; preview?: string }) {
  if (thread.queuePause) return <span className="min-w-0 truncate text-warning">Paused: {PAUSE_REASONS[thread.queuePause]}{thread.queuePause === 'limit' && ', sends when the thread resumes'}</span>;
  return <span className="min-w-0 truncate text-muted-foreground">{preview ?? 'Sends when this turn ends'}</span>;
}

function QueueRow({ message, onSendNow, onEdit, onRemove, onMove }: { message: QueuedMessage; onSendNow: (m: QueuedMessage) => void; onEdit: (m: QueuedMessage) => void; onRemove: () => void; onMove: (step: -1 | 1) => void }) {
  return (
    <Reorder.Item
      as="li"
      value={message.id}
      tabIndex={0}
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        onMove(e.key === 'ArrowUp' ? -1 : 1);
      }}
      whileDrag={{ scale: 1.01 }}
      className="group/queued relative flex h-9 cursor-grab items-center gap-2 rounded-lg pr-1 pl-3 outline-none hover:bg-accent/60 focus-visible:bg-accent/60 active:cursor-grabbing data-[dragging]:z-10"
    >
      <span className={cn('min-w-0 flex-1 truncate type-meta', !message.draft && 'text-muted-foreground')}>{message.draft || 'No text'}</span>
      <ExtraCount icon={Paperclip} count={message.images?.length ?? 0} label="attached" />
      <ExtraCount icon={MentionCircle} count={message.mentions.length} label="referenced" />
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 group-focus-within/queued:opacity-100 group-hover/queued:opacity-100 pointer-coarse:opacity-100">
        <Button variant="ghost" size="xs" className="rounded-full" onClick={() => onSendNow(message)}>
          Send now
        </Button>
        <TooltipIconButton label="Edit" hint="Moves it back into the message box" onClick={() => onEdit(message)}>
          <Edit className="size-3.5" />
        </TooltipIconButton>
        <TooltipIconButton label="Remove" hint="Takes it out of the queue" onClick={onRemove}>
          <Trash3 className="size-3.5" />
        </TooltipIconButton>
      </span>
    </Reorder.Item>
  );
}

function ExtraCount({ icon: Icon, count, label }: { icon: typeof Paperclip; count: number; label: string }) {
  if (count === 0) return null;
  return (
    <span aria-label={`${count} ${label}`} className="flex shrink-0 items-center gap-0.5 type-caption text-subtle-foreground tabular">
      <Icon aria-hidden className="size-3.5" />
      {count}
    </span>
  );
}
