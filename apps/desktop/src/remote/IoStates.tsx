import { Lock, Plug } from '@/icons';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import type { ThreadIo } from './threadIo';

/** A pane another computer's thread can't open here: that computer hasn't let this one read it. */
export function IoDenied({ title, reason }: { title: string; reason: string }) {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Lock />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{reason}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** Over a pane reading from another computer while it's offline: what shows is its last answer. */
export function OfflineNote({ io }: { io: ThreadIo }) {
  if (io.kind !== 'remote' || io.machine.status === 'online') return null;
  return (
    <p
      role="status"
      className="mx-2 mb-2 flex items-center gap-2 rounded-lg bg-card px-2.5 py-1.5 type-meta text-muted-foreground shadow-[0_0_0_1px_var(--border)]"
    >
      <Plug aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {io.machine.name} is offline; this is what it last showed
      </span>
    </p>
  );
}
