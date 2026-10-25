import { useState } from 'react';
import { ChevronRight, Transfer } from '@/icons';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { MessageResponse } from '@/components/ai-elements/message';
import { cn } from '@/lib/utils';
import type { Handoff } from '../model';
import { clock } from '../progress';
import { PROVIDER_NAME } from '../rewind/handoff';
import { DRAFT_TIMEOUT_MS } from '../rewind/runHandoff';
import { Expand } from '../WorkLog';

const FALLBACK_NOTE = {
  timeout: `drafting took over ${DRAFT_TIMEOUT_MS / 1000}s, so this is Mochi’s own summary`,
  error: 'drafting failed, so this is Mochi’s own summary',
} satisfies Record<NonNullable<Handoff['fallback']>, string>;

/** A handoff as one log line like a compaction: drafting while a model writes the prompt, then who took over; open, the prompt they started from. */
export function HandoffRow({ handoff, at }: { handoff: Handoff; at: number }) {
  const [isOpen, setOpen] = useState(false);
  const hasBody = handoff.status === 'started' && !!handoff.prompt;
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
            aria-label="Handoff prompt"
            onClick={() => setOpen((o) => !o)}
            className="absolute inset-0 cursor-default rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2"
          />
        )}
        <Transfer aria-hidden className="size-4 shrink-0" />
        <HandoffLine handoff={handoff} />
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
          <div className="mx-2 mt-1 flex flex-col gap-2 rounded-xl border px-3 py-2.5">
            <MessageResponse
              isAnimating={false}
              className="max-h-[min(50vh,28rem)] overflow-y-auto type-prose text-foreground"
            >
              {handoff.prompt}
            </MessageResponse>
            <p className="type-caption text-subtle-foreground">
              {[
                `${PROVIDER_NAME[handoff.to]} started from this at ${clock(at)}`,
                handoff.fallback && FALLBACK_NOTE[handoff.fallback],
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </Expand>
      )}
    </div>
  );
}

function HandoffLine({ handoff }: { handoff: Handoff }) {
  const names = `from ${PROVIDER_NAME[handoff.from]} to ${PROVIDER_NAME[handoff.to]}`;
  if (handoff.status === 'drafting')
    return (
      <Shimmer as="span" className="min-w-0 truncate">
        {`Handing off ${names}, drafting the prompt…`}
      </Shimmer>
    );
  if (handoff.status === 'failed')
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 text-destructive">
          Could not hand off {names}
        </span>
        {!!handoff.error && (
          <span className="min-w-0 truncate text-subtle-foreground">
            {handoff.error}
          </span>
        )}
      </span>
    );
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0">Handed off {names}</span>
      {!!handoff.fallback && (
        <span className="min-w-0 truncate text-subtle-foreground">
          with Mochi’s own summary
        </span>
      )}
    </span>
  );
}
