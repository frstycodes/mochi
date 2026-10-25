import { useState } from 'react';
import { ChevronRight, Minimize } from '@/icons';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { MessageResponse } from '@/components/ai-elements/message';
import { cn } from '@/lib/utils';
import type { Compaction, Provider } from '../model';
import { clock } from '../progress';
import { TOKENS } from '../summarySections';
import { Expand } from '../WorkLog';

const PINS = new Intl.PluralRules('en');

/** A compaction as one log line like a work group: what it shrank the context to and what Mochi asked it to keep; open, the summary. */
export function CompactionRow({
  compaction,
  at,
  provider,
}: {
  compaction: Compaction;
  at: number;
  provider: Provider;
}) {
  const [isOpen, setOpen] = useState(false);
  const kept = keptLine(compaction);
  const hasBody =
    compaction.status !== 'running' &&
    (!!compaction.summary || !!compaction.focus || !!kept);
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
            aria-label="Compaction details"
            onClick={() => setOpen((o) => !o)}
            className="absolute inset-0 cursor-default rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2"
          />
        )}
        <Minimize aria-hidden className="size-4 shrink-0" />
        <CompactionLine compaction={compaction} kept={kept} />
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
            {compaction.summary ? (
              <MessageResponse
                isAnimating={false}
                className="max-h-[min(50vh,28rem)] overflow-y-auto type-prose text-foreground"
              >
                {compaction.summary}
              </MessageResponse>
            ) : (
              <p className="type-body text-muted-foreground">
                {provider === 'codex'
                  ? 'Codex keeps its summary to itself.'
                  : 'No summary came back.'}
              </p>
            )}
            <p className="type-caption text-subtle-foreground">
              {[
                `${compaction.trigger === 'auto' ? 'Compacted automatically' : 'You compacted'} at ${clock(at)}`,
                compaction.focus && `focus: ${compaction.focus}`,
                kept &&
                  provider === 'codex' &&
                  `${kept}, sent to Codex after it`,
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

function CompactionLine({
  compaction,
  kept,
}: {
  compaction: Compaction;
  kept: string;
}) {
  if (compaction.status === 'running')
    return (
      <Shimmer as="span" className="min-w-0 truncate">
        Compacting the conversation…
      </Shimmer>
    );
  if (compaction.status === 'failed')
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 text-destructive">Compaction failed</span>
        {!!compaction.error && (
          <span className="min-w-0 truncate text-subtle-foreground">
            {compaction.error}
          </span>
        )}
      </span>
    );
  const sizes =
    compaction.preTokens !== undefined && compaction.postTokens !== undefined
      ? `${TOKENS.format(compaction.preTokens)} → ${TOKENS.format(compaction.postTokens)} tokens`
      : '';
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0">Compacted</span>
      {!!sizes && (
        <span className="shrink-0 tabular text-foreground">{sizes}</span>
      )}
      {!!kept && (
        <span className="min-w-0 truncate text-subtle-foreground">{kept}</span>
      )}
    </span>
  );
}

/** "kept 2 pins and the goal". */
function keptLine({ pins, hasGoal }: Compaction) {
  const parts = [
    pins > 0 && `${pins} ${PINS.select(pins) === 'one' ? 'pin' : 'pins'}`,
    hasGoal && 'the goal',
  ].filter(Boolean);
  return parts.length ? `kept ${parts.join(' and ')}` : '';
}
